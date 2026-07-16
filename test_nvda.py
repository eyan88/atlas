from thetadata import ThetaClient
import os
import datetime
from dotenv import load_dotenv

load_dotenv("backend/.env")

client = ThetaClient(email=os.getenv("THETADATA_USERNAME"), password=os.getenv("THETADATA_PASSWORD"), dataframe_type="pandas")

try:
    df = client.stock_history_eod(symbol="NVDA", start_date=datetime.date(2026, 7, 10), end_date=datetime.date(2026, 7, 13))
    print(df)
except Exception as e:
    print(f"Error: {e}")
