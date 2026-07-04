import os
import sys
from datetime import datetime, timedelta, date as py_date, timezone
import pandas as pd
import numpy as np

# Ensure app is in path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.db.base import Base
from app.db.session import engine, SessionLocal
from app.models.metric import DealerMetricSnapshot
from app.models.underlying import UnderlyingPriceSnapshot

# Create tables
print("Creating tables in database...")
Base.metadata.create_all(bind=engine)
print("Tables created successfully.")

db = SessionLocal()

try:
    # Clear existing data
    print("Clearing existing data...")
    db.query(DealerMetricSnapshot).delete()
    db.query(UnderlyingPriceSnapshot).delete()
    db.commit()
    print("Database cleared.")

    # Parameters
    tickers = ["SPY", "QQQ", "IWM"]
    # Generate data for a single day: 2026-07-02
    target_date = py_date(2026, 7, 2)
    start_time = datetime(2026, 7, 2, 13, 30, 0, tzinfo=timezone.utc)
    
    # 20 steps, 5 minutes interval (100 minutes of data)
    steps = 20
    interval = timedelta(minutes=5)
    
    ticker_base_prices = {
        "SPY": 542.0,
        "QQQ": 478.0,
        "IWM": 218.0
    }
    
    expirations = [
        target_date,
        target_date + timedelta(days=1),
        target_date + timedelta(days=5),
        target_date + timedelta(days=7),
        target_date + timedelta(days=14)
    ]
    
    print("Seeding database snapshots...")
    spot_id_counter = 1
    metric_id_counter = 1
    
    for ticker in tickers:
        base_price = ticker_base_prices[ticker]
        spot = base_price
        
        # Strikes: e.g. 20 strikes around base price
        strikes = np.arange(int(base_price - 10), int(base_price + 11), 1.0)
        
        for step in range(steps):
            ts = start_time + step * interval
            
            # Evolve spot price slightly
            spot += (np.random.random() - 0.45) * 0.4
            
            # Save spot price snapshot
            spot_snapshot = UnderlyingPriceSnapshot(
                id=spot_id_counter,
                timestamp=ts,
                ticker=ticker,
                price=float(spot)
            )
            spot_id_counter += 1
            db.add(spot_snapshot)
            
            # Save dealer metrics snapshots for each strike & expiration
            for strike in strikes:
                for exp_idx, exp in enumerate(expirations):
                    # Call Wall: base_price + 2 for even exp_idx, base_price + 4 for odd exp_idx
                    # Put Wall: base_price - 3 for even exp_idx, base_price - 5 for odd exp_idx
                    call_offset = 2 if exp_idx % 2 == 0 else 4
                    put_offset = -3 if exp_idx % 2 == 0 else -5
                    
                    # Smooth Gaussian decay model around the dynamic Call and Put Walls
                    pos_gex = 1.8e9 * np.exp(-((strike - (spot + call_offset)) / 3.5) ** 2) * (1 + 0.02 * step)
                    neg_gex = -1.6e9 * np.exp(-((strike - (spot + put_offset)) / 4.5) ** 2) * (1 + 0.01 * step)
                    gex = pos_gex + neg_gex
                    
                    # Compute delta exposure (DEX) proportionally
                    dex = gex * 0.025
                        
                    metric_snap = DealerMetricSnapshot(
                        id=metric_id_counter,
                        timestamp=ts,
                        ticker=ticker,
                        strike=float(strike),
                        expiration=exp,
                        net_gex=float(gex),
                        net_dex=float(dex),
                        net_vanna=float(gex * 0.001),
                        net_charm=float(-dex * 0.0005),
                        call_oi=1500 + int(np.random.randint(100, 1000)),
                        put_oi=1200 + int(np.random.randint(100, 1000)),
                        call_volume=int(np.random.randint(10, 200)),
                        put_volume=int(np.random.randint(10, 200)),
                        call_iv=float(0.22 + np.random.random() * 0.05),
                        put_iv=float(0.24 + np.random.random() * 0.05)
                    )
                    metric_id_counter += 1
                    db.add(metric_snap)
                    
        print(f"Seeded ticker {ticker} completed.")
        
    db.commit()
    print("Database seeding completed successfully.")

except Exception as e:
    db.rollback()
    print(f"Seeding failed: {e}")
    raise e
finally:
    db.close()
