import os
import sys
from datetime import datetime

# Add the current directory to python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.db.session import SessionLocal
from app.models.metric import DealerMetricSnapshot
from app.models.underlying import UnderlyingPriceSnapshot

def clean_database():
    db = SessionLocal()
    try:
        print("Cleaning mock simulation data from database...")
        # Keep only the real backfilled closing snapshot at 4:00 PM ET (16:00:00)
        target_timestamp = datetime(2026, 7, 2, 16, 0, 0)
        
        deleted_prices = db.query(UnderlyingPriceSnapshot).filter(
            UnderlyingPriceSnapshot.timestamp != target_timestamp
        ).delete()
        
        deleted_metrics = db.query(DealerMetricSnapshot).filter(
            DealerMetricSnapshot.timestamp != target_timestamp
        ).delete()
        
        db.commit()
        print(f"✅ Success! Deleted {deleted_prices} mock underlying price snapshots and {deleted_metrics} mock metric snapshots.")
    except Exception as e:
        db.rollback()
        print(f"❌ Error cleaning database: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    clean_database()
