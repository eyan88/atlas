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
                price=spot
            )
            spot_id_counter += 1
            db.add(spot_snapshot)
            
            # Save dealer metrics snapshots for each strike & expiration
            for strike in strikes:
                for exp in expirations:
                    # GEX Call Wall seed (around spot + 3)
                    # GEX Put Wall seed (around spot - 4)
                    # Use a model mimicking actual exposure profile
                    dist = strike - spot
                    if abs(strike - (base_price + 3)) < 0.5:
                        gex = 1.8e9 * (1 + 0.02 * step)
                        dex = 5e7
                    elif abs(strike - (base_price - 4)) < 0.5:
                        gex = -1.5e9 * (1 + 0.01 * step)
                        dex = -3e7
                    else:
                        # Standard decay profile
                        gex = np.sin(strike) * 1e8 - (dist * 1e7)
                        dex = dist * 2e6
                        
                    metric_snap = DealerMetricSnapshot(
                        id=metric_id_counter,
                        timestamp=ts,
                        ticker=ticker,
                        strike=strike,
                        expiration=exp,
                        net_gex=gex,
                        net_dex=dex,
                        net_vanna=gex * 0.001,
                        net_charm=-dex * 0.0005,
                        call_oi=1500 + int(np.random.randint(100, 1000)),
                        put_oi=1200 + int(np.random.randint(100, 1000)),
                        call_volume=int(np.random.randint(10, 200)),
                        put_volume=int(np.random.randint(10, 200)),
                        call_iv=0.22 + np.random.random() * 0.05,
                        put_iv=0.24 + np.random.random() * 0.05
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
