import asyncio
import random
import json
import redis.asyncio as aioredis
from datetime import datetime, timezone
from app.core.config import settings

async def redis_mock_publisher():
    """
    Background loop simulating data ingestion pipeline.
    Periodically publishes cell diff updates to Redis Pub/Sub channels (atlas:realtime:{ticker})
    and updates the latest cache key (atlas:heatmap:{ticker}:latest).
    """
    # Initialize connection
    r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    tickers = ["SPY", "QQQ", "IWM"]
    
    # Starting base spots for indexes
    spot_levels = {
        "SPY": 542.00,
        "QQQ": 475.00,
        "IWM": 210.00
    }
    
    print("Starting background Redis mock publisher task...")
    try:
        # Verify connection first
        await r.ping()
        print("Connected to Redis for background Pub/Sub publishing.")
    except Exception as e:
        print(f"Notice: Redis is unreachable. Mock Pub/Sub background task won't publish. Error: {e}")
        await r.close()
        return

    try:
        while True:
            await asyncio.sleep(5.0)
            for ticker in tickers:
                # Evolve spot price slightly
                spot_levels[ticker] = round(spot_levels[ticker] + random.uniform(-0.15, 0.15), 2)
                spot = spot_levels[ticker]
                
                # Dynamic levels close to spot
                call_wall = round(spot + 3.0 + random.choice([-0.5, 0.0, 0.5]), 2)
                put_wall = round(spot - 4.0 + random.choice([-0.5, 0.0, 0.5]), 2)
                gamma_flip = round(spot + random.choice([-0.25, 0.0, 0.25]), 2)
                
                # Generate cell diff patches for 3 random cells
                diffs = []
                columns = ["2026-07-03", "2026-07-10", "2026-07-17"]
                rows = [round(spot + i) for i in range(-5, 6)]
                
                if rows and columns:
                    sampled_strikes = random.sample(rows, min(len(rows), 3))
                    sampled_exps = random.sample(columns, min(len(columns), 3))
                    
                    for k in sampled_strikes:
                        for e in sampled_exps:
                            is_call = k > spot
                            gex_base = 5e8 if is_call else -5e8
                            gex_val = gex_base * random.uniform(0.5, 1.5)
                            
                            diffs.append({
                                "k": float(k),
                                "e": str(e),
                                "g": float(gex_val),
                                "oi": int(random.randint(1000, 3000)),
                                "v": int(random.randint(50, 500))
                            })
                
                payload = {
                    "ticker": ticker,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "spot_price": spot,
                    "gamma_flip": gamma_flip,
                    "call_wall": call_wall,
                    "put_wall": put_wall,
                    "diffs": diffs
                }
                
                try:
                    # Publish JSON frame payload to Redis channel
                    channel = f"atlas:realtime:{ticker}"
                    await r.publish(channel, json.dumps(payload))
                except Exception as e:
                    print(f"Failed to publish cell diff to Redis: {e}")
                    
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"Background Redis mock publisher encountered error: {e}")
    finally:
        await r.aclose()
        print("Redis mock publisher closed.")

async def thetadata_live_publisher():
    """
    Background loop that polls ThetaData every 60 seconds (Value tier safe) 
    for the options chain, calculates Greeks, and streams the diffs.
    """
    try:
        from app.services.data_providers.thetadata import ThetaDataProvider
        from app.services.analytics import DealerExposureEngine
        import pandas as pd
        provider = ThetaDataProvider()
        engine = DealerExposureEngine()
    except Exception as e:
        print(f"Failed to initialize ThetaData live publisher: {e}")
        print("Ensure THETADATA_USERNAME and THETADATA_PASSWORD are set. Falling back to mock publisher.")
        await redis_mock_publisher()
        return

    r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    tickers = ["SPY", "QQQ", "IWM"]
    
    print("Starting background ThetaData live publisher task (polling every 60s)...")
    try:
        await r.ping()
        print("Connected to Redis for live Pub/Sub publishing.")
    except Exception as e:
        print(f"Redis unreachable. {e}")
        await r.close()
        return

    try:
        while True:
            # Poll every 60 seconds (Value tier safe)
            await asyncio.sleep(60.0) 
            for ticker in tickers:
                try:
                    await asyncio.sleep(1.0) # stagger requests
                    
                    option_quotes = await asyncio.to_thread(provider.get_option_chain, ticker)
                    spot_price = (await asyncio.to_thread(provider.get_underlying_quote, ticker)).price
                    
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
                        c["oi"] += q.open_interest
                        c["v"] += q.volume
                        if q.option_type == "C":
                            if q.gamma: c["g"] += q.gamma * gex_factor
                            if q.delta: c["d"] += q.delta * dex_factor
                            if q.vanna: c["va"] += q.vanna * vanna_factor
                            if q.charm: c["ch"] += q.charm * charm_factor
                            c["coi"] += q.open_interest
                        else:
                            if q.gamma: c["g"] += q.gamma * gex_factor * -1.0
                            if q.delta: c["d"] += q.delta * dex_factor * -1.0
                            if q.vanna: c["va"] += q.vanna * vanna_factor * -1.0
                            if q.charm: c["ch"] += q.charm * charm_factor * -1.0
                            c["poi"] += q.open_interest
                    
                    diffs = []
                    strike_agg = {}
                    for (strike, exp), c in cells.items():
                        diffs.append({
                            "k": float(strike),
                            "e": exp.isoformat() if hasattr(exp, 'isoformat') else str(exp),
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
                    
                    payload = {
                        "ticker": ticker,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "spot_price": spot_price,
                        "gamma_flip": gamma_flip,
                        "call_wall": call_wall,
                        "put_wall": put_wall,
                        "diffs": diffs
                    }
                    
                    await r.publish(f"atlas:realtime:{ticker}", json.dumps(payload))
                except Exception as e:
                    print(f"ThetaData live publisher loop error for {ticker}: {e}")
                    
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"Background ThetaData live publisher encountered error: {e}")
    finally:
        await r.aclose()
        print("ThetaData live publisher closed.")
