from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Dict, Any

from app.api.deps import get_db
from app.core.config import settings
from app.models.metric import DealerMetricSnapshot

router = APIRouter()

TICKER_NAMES = {
    "SPY": "SPDR S&P 500 ETF Trust",
    "QQQ": "Invesco QQQ Trust",
    "IWM": "iShares Russell 2000 ETF"
}

@router.get("")
def get_tickers(db: Session = Depends(get_db)) -> Dict[str, List[Dict[str, Any]]]:
    """
    Returns a list of all supported options underlying symbols and their historical date bounds.
    """
    tickers_info = []
    for ticker in settings.SUPPORTED_TICKERS:
        name = TICKER_NAMES.get(ticker, f"{ticker} ETF")
        
        # Query min and max dates
        bounds = db.query(
            func.min(DealerMetricSnapshot.timestamp),
            func.max(DealerMetricSnapshot.timestamp)
        ).filter(DealerMetricSnapshot.ticker == ticker).first()
        
        min_date = bounds[0].date().isoformat() if bounds and bounds[0] else None
        max_date = bounds[1].date().isoformat() if bounds and bounds[1] else None
        
        tickers_info.append({
            "symbol": ticker,
            "name": name,
            "min_date": min_date,
            "max_date": max_date
        })
        
    return {"tickers": tickers_info}
