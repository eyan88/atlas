import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
import pandas as pd
import numpy as np

# Ensure the parent folders are in the Python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.db.session import SessionLocal
from app.models.metric import DealerMetricSnapshot
from app.models.underlying import UnderlyingPriceSnapshot

def run_backfill(ticker="SPY", backfill_date=date(2026, 7, 3), db=None):
    """
    Downloads EOD quotes and volume for the target date from ThetaData
    using the thetadatadx SDK (Rust-based, no Java required),
    runs local Black-Scholes Greeks calculations, and saves them to
    the database under the EOD timestamp (4:00 PM ET).
    """
    is_external_db = db is not None
    if not is_external_db:
        db = SessionLocal()

    # Load credentials
    username = os.getenv("THETADATA_USERNAME") or os.getenv("THETADATA_EMAIL")
    password = os.getenv("THETADATA_PASSWORD")

    if not username or not password:
        print("Error: ThetaData credentials not found in env. Please ensure THETADATA_USERNAME and THETADATA_PASSWORD are set.")
        return

    try:
        from thetadatadx import Credentials, Config, ThetaDataDxClient, all_greeks
    except ImportError as e:
        print(f"Error: The 'thetadatadx' library is not installed or failed to load. Details: {e}")
        return

    print(f"==================================================")
    print(f"Starting EOD GEX Backfill: {ticker} on {backfill_date}")
    print(f"==================================================")

    try:
        # Initialize ThetaDataDx client (REST-based, no Java Terminal needed)
        creds = Credentials(username, password)
        client = ThetaDataDxClient(creds, Config.production())

        # Format date as YYYYMMDD string for the thetadatadx API
        date_str = backfill_date.strftime("%Y%m%d")

        # 1. Retrieve the closing stock price
        print("Fetching underlying close price...")
        eod_ticks = client.stock_history_eod(ticker, date_str, date_str)
        eod_list = list(eod_ticks)
        if not eod_list:
            print(f"No pricing data found for {ticker} on {backfill_date}. Is the market closed?")
            return

        spot_price = float(eod_list[-1].close)
        print(f"Spot Close Price: ${spot_price:.2f}")

        # 2. Get active option expirations on that day
        print("Fetching option expirations...")
        exp_list = list(client.option_list_expirations(ticker))
        
        # Filter expirations on or after the target date
        expirations = []
        for exp in exp_list:
            # exp is typically a date string like "20260710" or a date object
            if hasattr(exp, 'date'):
                exp_date = exp.date if isinstance(exp.date, date) else date.fromisoformat(str(exp.date))
            elif isinstance(exp, str):
                exp_date = date(int(exp[:4]), int(exp[4:6]), int(exp[6:8]))
            elif isinstance(exp, date):
                exp_date = exp
            else:
                # Try converting to string first
                exp_str = str(exp)
                if len(exp_str) == 8 and exp_str.isdigit():
                    exp_date = date(int(exp_str[:4]), int(exp_str[4:6]), int(exp_str[6:8]))
                else:
                    continue
            if exp_date >= backfill_date:
                expirations.append(exp_date)
        
        expirations.sort()
        print(f"Found {len(expirations)} total active expirations.")

        # Define snapshot timestamp as 4:00 PM ET (20:00 UTC) on the target date
        ts = datetime(backfill_date.year, backfill_date.month, backfill_date.day, 16, 0, 0, tzinfo=timezone.utc)

        # 3. Clean up existing records for this day
        print("Pruning old database entries for this timestamp...")
        db.query(UnderlyingPriceSnapshot).filter(
            UnderlyingPriceSnapshot.ticker == ticker,
            UnderlyingPriceSnapshot.timestamp == ts
        ).delete()
        db.query(DealerMetricSnapshot).filter(
            DealerMetricSnapshot.ticker == ticker,
            DealerMetricSnapshot.timestamp == ts
        ).delete()
        db.commit()

        # Get maximum IDs in database to prevent IntegrityErrors
        max_spot_id = db.query(UnderlyingPriceSnapshot.id).order_by(UnderlyingPriceSnapshot.id.desc()).first()
        spot_id_counter = (max_spot_id[0] + 1) if max_spot_id else 1

        max_metric_id = db.query(DealerMetricSnapshot.id).order_by(DealerMetricSnapshot.id.desc()).first()
        metric_id_counter = (max_metric_id[0] + 1) if max_metric_id else 1

        # Save EOD spot price snapshot
        spot_snap = UnderlyingPriceSnapshot(
            id=spot_id_counter,
            timestamp=ts,
            ticker=ticker,
            price=spot_price
        )
        db.add(spot_snap)

        # 4. Ingest the nearest 10 expirations (Value/Free tier limits)
        count = 0
        for exp in expirations[:10]:
            exp_str = exp.strftime("%Y%m%d")
            print(f"Processing expiration: {exp}...")
            try:
                opt_ticks = client.option_history_eod(
                    symbol=ticker,
                    start_date=date_str,
                    end_date=date_str,
                    expiration=exp_str
                )
                opt_list = list(opt_ticks)
                if not opt_list:
                    continue

                # Build a DataFrame from the ticks for easier processing
                rows = []
                for tick in opt_list:
                    rows.append({
                        "strike": float(tick.strike) if hasattr(tick, 'strike') else float(getattr(tick, 'strike_price', 0)),
                        "right": str(getattr(tick, 'right', getattr(tick, 'contract_type', ''))).upper(),
                        "bid": float(getattr(tick, 'bid', 0)),
                        "ask": float(getattr(tick, 'ask', 0)),
                        "volume": int(getattr(tick, 'volume', 0)),
                    })
                df_opt = pd.DataFrame(rows)
                if df_opt.empty:
                    continue

                # Compute time-to-expiration in years
                tte = max(0.0001, (exp - backfill_date).days) / 365.25

                # Group by strike
                strikes = df_opt["strike"].unique()
                for strike in strikes:
                    strike_df = df_opt[df_opt["strike"] == strike]
                    
                    # Split Call/Put contracts
                    call_row = strike_df[strike_df["right"].str.contains("C|CALL")]
                    put_row = strike_df[strike_df["right"].str.contains("P|PUT")]
                    
                    # Greeks parameters
                    multiplier = 100.0
                    gex_factor = multiplier * (spot_price ** 2) * 0.01
                    dex_factor = multiplier * spot_price
                    vanna_factor = multiplier * spot_price * 0.01
                    charm_factor = multiplier * spot_price

                    call_gex, call_dex, call_vanna, call_charm, call_vol, call_iv = 0.0, 0.0, 0.0, 0.0, 0, None
                    put_gex, put_dex, put_vanna, put_charm, put_vol, put_iv = 0.0, 0.0, 0.0, 0.0, 0, None

                    # Calls
                    if not call_row.empty:
                        bid = float(call_row["bid"].iloc[0])
                        ask = float(call_row["ask"].iloc[0])
                        mid = (bid + ask) / 2.0
                        vol = int(call_row["volume"].iloc[0])
                        call_vol = vol
                        try:
                            g = all_greeks(
                                spot=spot_price,
                                strike=float(strike),
                                rate=0.05,
                                div_yield=0.015,
                                tte=tte,
                                option_price=max(0.01, mid),
                                right="C"
                            )
                            call_iv = float(g.iv)
                            call_gex = float(vol * g.gamma * gex_factor)
                            call_dex = float(vol * g.delta * dex_factor)
                            call_vanna = float(vol * g.vanna * vanna_factor)
                            call_charm = float(vol * g.charm * charm_factor)
                        except Exception:
                            pass

                    # Puts
                    if not put_row.empty:
                        bid = float(put_row["bid"].iloc[0])
                        ask = float(put_row["ask"].iloc[0])
                        mid = (bid + ask) / 2.0
                        vol = int(put_row["volume"].iloc[0])
                        put_vol = vol
                        try:
                            g = all_greeks(
                                spot=spot_price,
                                strike=float(strike),
                                rate=0.05,
                                div_yield=0.015,
                                tte=tte,
                                option_price=max(0.01, mid),
                                right="P"
                            )
                            put_iv = float(g.iv)
                            put_gex = float(-1.0 * vol * g.gamma * gex_factor)
                            put_dex = float(-1.0 * vol * g.delta * dex_factor)
                            put_vanna = float(-1.0 * vol * g.vanna * vanna_factor)
                            put_charm = float(-1.0 * vol * g.charm * charm_factor)
                        except Exception:
                            pass

                    # Add metric row to db
                    metric_snap = DealerMetricSnapshot(
                        id=metric_id_counter,
                        timestamp=ts,
                        ticker=ticker,
                        strike=float(strike),
                        expiration=exp,
                        net_gex=call_gex + put_gex,
                        net_dex=call_dex + put_dex,
                        net_vanna=call_vanna + put_vanna,
                        net_charm=call_charm + put_charm,
                        call_oi=call_vol,
                        put_oi=put_vol,
                        call_volume=call_vol,
                        put_volume=put_vol,
                        call_iv=call_iv,
                        put_iv=put_iv
                    )
                    db.add(metric_snap)
                    metric_id_counter += 1
                    count += 1

                db.commit()
            except Exception as e:
                print(f"Warning: Expiration {exp} failed: {e}")
                db.rollback()
                continue

        print(f"\n✅ Backfilled {count} options contracts GEX snapshot for {ticker} on {backfill_date}!")
        
    except Exception as e:
        db.rollback()
        print(f"Backfill error: {e}")
    finally:
        if not is_external_db:
            db.close()

if __name__ == "__main__":
    # Default: Backfill July 2, 2026 (July 3rd was closed for Independence Day holiday)
    run_backfill("SPY", date(2026, 7, 2))
