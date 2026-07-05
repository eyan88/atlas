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

def run_backfill(ticker="SPY", backfill_date=date(2026, 7, 3)):
    """
    Downloads EOD quotes and volume for the target date from ThetaData,
    runs local Rust Greeks calculations (Method B), and saves them to
    the database under the EOD timestamp (4:00 PM ET).
    """
    db = SessionLocal()

    # Load credentials
    username = os.getenv("THETADATA_USERNAME") or os.getenv("THETADATA_EMAIL")
    password = os.getenv("THETADATA_PASSWORD")

    if not username or not password:
        print("Error: ThetaData credentials not found in env. Please ensure THETADATA_USERNAME and THETADATA_PASSWORD are set.")
        return

    try:
        from thetadata import ThetaClient
        client = ThetaClient(email=username, password=password, dataframe_type="pandas")
    except ImportError:
        print("Error: The 'thetadata' library is not installed.")
        return

    try:
        from thetadatadx import all_greeks
    except ImportError:
        print("Error: The 'thetadatadx' library is required for Method B calculations.")
        return

    print(f"==================================================")
    print(f"Starting EOD GEX Backfill: {ticker} on {backfill_date}")
    print(f"==================================================")

    try:
        # 1. Retrieve the closing stock price
        print("Fetching underlying close price...")
        df_stock = client.stock_history_eod(
            symbol=ticker,
            start_date=backfill_date,
            end_date=backfill_date
        )
        if df_stock.empty:
            print(f"No pricing data found for {ticker} on {backfill_date}. Is the market closed?")
            return

        spot_price = float(df_stock["close"].iloc[-1])
        print(f"Spot Close Price: ${spot_price:.2f}")

        # 2. Get active option expirations on that day
        print("Fetching option expirations...")
        df_exp = client.option_list_expirations(symbol=ticker)
        df_exp['exp_date'] = pd.to_datetime(df_exp['expiration']).dt.date
        
        # Sort expirations expiring on or after the target date
        expirations = df_exp[df_exp['exp_date'] >= backfill_date]['exp_date'].sort_values().tolist()
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
            print(f"Processing expiration: {exp}...")
            try:
                df_opt = client.option_history_eod(
                    start_date=backfill_date,
                    end_date=backfill_date,
                    symbol=ticker,
                    expiration=exp
                )
                if df_opt.empty:
                    continue

                # Compute time-to-expiration in years
                tte = max(0.0001, (exp - backfill_date).days) / 365.25

                # Group by strike
                strikes = df_opt["strike"].unique()
                for strike in strikes:
                    strike_df = df_opt[df_opt["strike"] == strike]
                    
                    # Split Call/Put contracts
                    call_row = strike_df[strike_df["right"].astype(str).str.upper().str.contains("C|CALL")]
                    put_row = strike_df[strike_df["right"].astype(str).str.upper().str.contains("P|PUT")]
                    
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
                            # Free tier: we use daily volume as a proxy for positioning
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
        db.close()

if __name__ == "__main__":
    # Default: Backfill July 2, 2026 (July 3rd was closed for Independence Day holiday)
    run_backfill("SPY", date(2026, 7, 2))
