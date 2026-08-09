import os
import sys
from datetime import date, timedelta

# Ensure parent directory is in path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.db.session import SessionLocal
from app.models.metric import DealerMetricSnapshot
from app.models.underlying import UnderlyingPriceSnapshot
from app.db.backfill_eod import run_backfill

def reset_and_backfill():
    print("==========================================================")
    print("Resetting Database & Re-fetching ThetaData Backfills")
    print("==========================================================")
    
    db = SessionLocal()
    try:
        print("1. Wiping all existing database snapshots...")
        deleted_metrics = db.query(DealerMetricSnapshot).delete()
        deleted_prices = db.query(UnderlyingPriceSnapshot).delete()
        db.commit()
        print(f"✅ Cleared {deleted_metrics} metric records and {deleted_prices} price records.")
    except Exception as e:
        db.rollback()
        print(f"Error wiping database: {e}")
        db.close()
        return
    finally:
        db.close()

    # 2. Backfill recent trading days for active tickers
    tickers = ["QQQ", "SPY", "IWM"]
    
    # Target recent business days (Friday Aug 7th, Thursday Aug 6th, etc.)
    today = date.today()
    target_dates = []
    
    # Collect last 5 weekdays
    for i in range(1, 10):
        d = today - timedelta(days=i)
        if d.weekday() < 5: # Monday - Friday
            target_dates.append(d)
            if len(target_dates) >= 4:
                break
                
    print(f"2. Backfilling clean ThetaData snapshots for dates: {target_dates}")
    
    for b_date in target_dates:
        for ticker in tickers:
            try:
                db_session = SessionLocal()
                run_backfill(ticker=ticker, backfill_date=b_date, db=db_session)
                db_session.close()
            except Exception as err:
                print(f"Backfill error for {ticker} on {b_date}: {err}")

    print("==========================================================")
    print("✅ Complete! Database has been reset and backfilled with fresh ThetaData!")
    print("==========================================================")

if __name__ == "__main__":
    reset_and_backfill()
