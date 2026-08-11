import asyncio
import random
import json
import redis.asyncio as aioredis
from datetime import datetime, timezone
from app.core.config import settings


async def realtime_live_publisher():
    """
    Background loop that polls the configured data provider every 60 seconds
    for the options chain, calculates Greeks, and streams the diffs.
    """
    from app.services.analytics import DealerExposureEngine
    import pandas as pd
    
    provider_name = settings.DATA_PROVIDER.lower()
    provider = None
    
    try:
        if provider_name == "thetadata":
            from app.services.data_providers.thetadata import ThetaDataProvider
            provider = ThetaDataProvider()
        elif provider_name == "polygon":
            from app.services.data_providers.polygon import PolygonDataProvider
            provider = PolygonDataProvider()
        else:
            print(f"Provider '{provider_name}' not supported for live streaming. Halting live feed.")
            return
    except Exception as e:
        print(f"Failed to initialize {provider_name} live publisher: {e}")
        print("Halting live feed.")
        return

    engine = DealerExposureEngine()
    r = None
    try:
        r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        await r.ping()
        print("Connected to Redis for live Pub/Sub publishing.")
    except Exception as e:
        print(f"Notice: Redis Pub/Sub unreachable ({e}). Live publisher operating in direct database persistence mode.")
        r = None

    default_tickers = ["QQQ", "SPY", "IWM"]

    try:
        while True:
            # Poll live market data every 15 seconds
            await asyncio.sleep(15.0)
            
            target_tickers = list(default_tickers)
            if r:
                try:
                    active_channels = await r.pubsub_channels("atlas:realtime:*")
                    if active_channels:
                        extra_tickers = [ch.split(":")[-1] for ch in active_channels]
                        target_tickers = list(set(target_tickers + extra_tickers))
                except Exception:
                    pass
            
            for ticker in target_tickers:
                try:
                    await asyncio.sleep(1.0) # stagger requests
                    
                    spot_quote = await asyncio.to_thread(provider.get_underlying_quote, ticker)
                    spot_price = spot_quote.price
                    option_quotes = await asyncio.to_thread(provider.get_option_chain, ticker, spot_price)
                    
                    if not option_quotes:
                        continue
                        
                    multiplier = 100.0
                    gex_factor = multiplier * (spot_price ** 2) * 0.01
                    dex_factor = multiplier * spot_price
                    vanna_factor = multiplier * spot_price * 0.01
                    charm_factor = multiplier * spot_price

                    cells = {}
                    for q in option_quotes:
                        # Only process nearest 60 strikes to spot price to save bandwidth
                        if abs(q.strike - spot_price) > (spot_price * 0.15):
                            continue
                            
                        key = (q.strike, q.expiration)
                        if key not in cells:
                            cells[key] = {"g":0.0, "d":0.0, "va":0.0, "ch":0.0, "coi":0, "poi":0, "oi":0, "v":0}
                        
                        c = cells[key]
                        oi_val = q.open_interest if q.open_interest > 0 else (q.volume if q.volume > 0 else 10)
                        c["oi"] += oi_val
                        c["v"] += q.volume
                        if q.option_type == "C":
                            if q.gamma: c["g"] += q.gamma * oi_val * gex_factor
                            if q.delta: c["d"] += q.delta * oi_val * dex_factor
                            if q.vanna: c["va"] += q.vanna * oi_val * vanna_factor
                            if q.charm: c["ch"] += q.charm * oi_val * charm_factor
                            c["coi"] += oi_val
                        else:
                            if q.gamma: c["g"] += -1.0 * q.gamma * oi_val * gex_factor
                            if q.delta: c["d"] += -1.0 * q.delta * oi_val * dex_factor
                            if q.vanna: c["va"] += -1.0 * q.vanna * oi_val * vanna_factor
                            if q.charm: c["ch"] += -1.0 * q.charm * oi_val * charm_factor
                            c["poi"] += oi_val
                    
                    diffs = []
                    strike_agg = {}
                    for (strike, exp), c in cells.items():
                        exp_str = str(exp).split('T')[0].split(' ')[0]
                        diffs.append({
                            "k": float(strike),
                            "e": exp_str,
                            "g": float(c["g"]),
                            "d": float(c["d"]),
                            "va": float(c["va"]),
                            "ch": float(c["ch"]),
                            "coi": int(c["coi"]),
                            "poi": int(c["poi"]),
                            "oi": int(c["oi"]),
                            "v": int(c["v"])
                        })
                        if strike not in strike_agg:
                            strike_agg[strike] = {"net_gex": 0.0, "net_dex": 0.0}
                        strike_agg[strike]["net_gex"] += c["g"]
                        strike_agg[strike]["net_dex"] += c["d"]
                        
                    df_grouped = pd.DataFrame([
                        {"strike": s, "net_gex": agg["net_gex"], "net_dex": agg["net_dex"]}
                        for s, agg in strike_agg.items()
                    ])
                    
                    call_wall, put_wall = engine.find_walls(df_grouped)
                    gamma_flip = engine.find_gamma_flip_strike(df_grouped, spot=spot_price)
                    net_gamma = float(df_grouped["net_gex"].sum()) if not df_grouped.empty else 0.0
                    
                    payload = {
                        "ticker": ticker,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "spot_price": spot_price,
                        "gamma_flip": gamma_flip,
                        "net_gamma": net_gamma,
                        "call_wall": call_wall,
                        "put_wall": put_wall,
                        "diffs": diffs
                    }

                    # If off-hours polling returns zeroed-out quotes, skip publishing to preserve active heatmap
                    has_gex_data = any(d["g"] != 0.0 or d["d"] != 0.0 or d["v"] > 0 for d in diffs)
                    if not has_gex_data:
                        print(f"Off-hours polling for {ticker}: market exchanges closed. Preserving active heatmap.")
                        continue

                    if r:
                        try:
                            await r.publish(f"atlas:realtime:{ticker}", json.dumps(payload))
                        except Exception as pub_err:
                            print(f"Redis publish notice for {ticker}: {pub_err}")

                    # Persist live 60-second snapshot to DB for historical evolution & timeline tracking
                    try:
                        from app.db.session import SessionLocal
                        from app.models.metric import DealerMetricSnapshot
                        from app.models.underlying import UnderlyingPriceSnapshot
                        from datetime import date as py_date
                        
                        db = SessionLocal()
                        now_dt = datetime.now(timezone.utc)
                        
                        db.add(UnderlyingPriceSnapshot(
                            ticker=ticker,
                            price=spot_price,
                            timestamp=now_dt
                        ))
                        
                        db_records = []
                        for (strike, exp), c in cells.items():
                            exp_date = exp if isinstance(exp, (py_date, datetime)) else py_date.fromisoformat(str(exp))
                            db_records.append(DealerMetricSnapshot(
                                ticker=ticker,
                                timestamp=now_dt,
                                strike=strike,
                                expiration=exp_date,
                                net_gex=c["g"],
                                net_dex=c["d"],
                                net_vanna=c["va"],
                                net_charm=c["ch"],
                                call_oi=c["coi"],
                                put_oi=c["poi"],
                                call_volume=c["v"],
                                put_volume=0
                            ))
                        
                        if db_records:
                            db.add_all(db_records)
                            db.commit()
                        db.close()
                    except Exception as db_err:
                        print(f"Database persistence warning in publisher for {ticker}: {db_err}")
                except Exception as e:
                    print(f"{provider_name.upper()} live publisher loop error for {ticker}: {e}")
                    
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"Background {provider_name.upper()} live publisher encountered error: {e}")
    finally:
        await r.aclose()
        print(f"{provider_name.upper()} live publisher closed.")
