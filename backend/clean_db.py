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
        print("Cleaning all old mock simulation data from database...")
        # Delete all mock seed data prior to August 2026
        cutoff_date = datetime(2026, 8, 1)
        
        deleted_prices = db.query(UnderlyingPriceSnapshot).filter(
            UnderlyingPriceSnapshot.timestamp < cutoff_date
        ).delete()
        
        deleted_metrics = db.query(DealerMetricSnapshot).filter(
            DealerMetricSnapshot.timestamp < cutoff_date
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
