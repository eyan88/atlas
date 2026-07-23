from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, date as py_date, timezone
import pandas as pd
import numpy as np
import json
from typing import Optional, List, Dict, Any

from app.api.deps import get_db, get_redis
from app.models.metric import DealerMetricSnapshot
from app.models.underlying import UnderlyingPriceSnapshot
from app.services.analytics import DealerExposureEngine

router = APIRouter()
engine = DealerExposureEngine()

@router.get("/heatmap/{ticker}")
def get_heatmap(
    ticker: str,
    metric: str = Query("net_gex"),
    timestamp: Optional[str] = Query(None),
    strikeCount: int = Query(20),
    db: Session = Depends(get_db),
    redis_conn: Any = Depends(get_redis)
) -> Dict[str, Any]:
    """
    Retrieves the option dealer positioning heatmap snapshot matrix for the ticker.
    """
    ticker = ticker.upper()
    metric = metric.lower()
    
    # Cache key format: atlas:heatmap:v2:{ticker}:{metric}:{timestamp_str or 'latest'}:{strikeCount}
    timestamp_key_part = timestamp if timestamp else "latest"
    cache_key = f"atlas:heatmap:v2:{ticker}:{metric}:{timestamp_key_part}:{strikeCount}"
    
    # Check if redis_conn is an active Redis client (avoiding Depends wrapper during direct function calls)
    is_redis_active = redis_conn is not None and type(redis_conn).__name__ != "Depends"
    
    if is_redis_active:
        try:
            cached_data = redis_conn.get(cache_key)
            if cached_data:
                return json.loads(cached_data)
        except Exception as e:
            print(f"Redis cache lookup error: {e}")
    
    # 1. Determine target timestamp
    if timestamp:
        try:
            # Parse ISO 8601 string safely
            # Replace 'Z' with +00:00 to support standard python isoformat parsing
            ts_str = timestamp.replace("Z", "+00:00")
            target_ts = datetime.fromisoformat(ts_str)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid timestamp format. Use ISO 8601.")
    else:
        # Fetch latest timestamp from database for this ticker
        target_ts = db.query(func.max(DealerMetricSnapshot.timestamp)).filter(DealerMetricSnapshot.ticker == ticker).scalar()
        if not target_ts:
            raise HTTPException(status_code=404, detail=f"No metrics data found for ticker {ticker}.")
            
    # 2. Fetch metrics records at this exact timestamp
    records = db.query(DealerMetricSnapshot).filter(
        DealerMetricSnapshot.ticker == ticker,
        DealerMetricSnapshot.timestamp == target_ts
    ).all()
    
    if not records:
        raise HTTPException(status_code=404, detail=f"No metrics snapshot found at {timestamp or target_ts.isoformat()}.")

    # Convert to pandas DataFrame for calculations
    df = pd.DataFrame([{
        "strike": float(r.strike),
        "expiration": r.expiration.isoformat() if isinstance(r.expiration, (py_date, datetime)) else str(r.expiration),
        "net_gex": float(r.net_gex),
        "net_dex": float(r.net_dex),
        "net_vanna": float(r.net_vanna),
        "net_charm": float(r.net_charm),
        "call_oi": int(r.call_oi),
        "put_oi": int(r.put_oi),
        "call_volume": int(r.call_volume),
        "put_volume": int(r.put_volume),
        "call_iv": float(r.call_iv) if r.call_iv else None,
        "put_iv": float(r.put_iv) if r.put_iv else None
    } for r in records])

    # 3. Fetch underlying spot price closest to target timestamp
    spot_price = None
    spot_record = db.query(UnderlyingPriceSnapshot).filter(
        UnderlyingPriceSnapshot.ticker == ticker,
        UnderlyingPriceSnapshot.timestamp <= target_ts
    ).order_by(UnderlyingPriceSnapshot.timestamp.desc()).first()
    
    if spot_record:
        spot_price = float(spot_record.price)
    else:
        # Fallback to closest forward in time (first snapshot after target_ts)
        spot_record = db.query(UnderlyingPriceSnapshot).filter(
            UnderlyingPriceSnapshot.ticker == ticker,
            UnderlyingPriceSnapshot.timestamp >= target_ts
        ).order_by(UnderlyingPriceSnapshot.timestamp.asc()).first()
        if spot_record:
            spot_price = float(spot_record.price)

    # 4. Group metrics by strike to compute key levels (Walls, Gamma Flip)
    # Call/Put Wall calculations are based on all strikes in the full chain snapshot
    grouped_full = df.groupby("strike", as_index=False).agg({
        "net_gex": "sum",
        "net_dex": "sum"
    })
    
    call_wall, put_wall = engine.find_walls(grouped_full)
    gamma_flip = engine.find_gamma_flip_strike(grouped_full, spot=spot_price)
    net_gamma = float(df["net_gex"].sum()) if not df.empty else 0.0

    # 5. Filter strikes based on strikeCount (closest strikes to spot)
    unique_strikes = df["strike"].unique()
    if len(unique_strikes) > strikeCount and spot_price is not None:
        # Sort strikes by absolute distance to spot price
        sorted_by_dist = sorted(unique_strikes, key=lambda s: abs(s - spot_price))
        target_strikes = set(sorted_by_dist[:strikeCount])
        df = df[df["strike"].isin(target_strikes)]
    
    # 6. Extract unique strikes (descending) and expirations (ascending)
    rows = sorted(list(df["strike"].unique()), reverse=True)
    columns = sorted(list(df["expiration"].unique()))

    # Create coordinate maps
    row_map = {strike: i for i, strike in enumerate(rows)}
    col_map = {exp: j for j, exp in enumerate(columns)}

    # Initialize 2D grid
    data_matrix = [[0.0 for _ in range(len(columns))] for _ in range(len(rows))]

    # Map requested metric to columns
    # Support 'net_gex', 'net_dex', 'vanna', 'charm', 'call_oi', 'put_oi', 'volume'
    metric = metric.lower()
    
    for _, row in df.iterrows():
        s = row["strike"]
        e = row["expiration"]
        if s in row_map and e in col_map:
            r_idx = row_map[s]
            c_idx = col_map[e]
            
            if metric == "net_gex":
                val = row["net_gex"]
            elif metric == "net_dex":
                val = row["net_dex"]
            elif metric == "vanna":
                val = row["net_vanna"]
            elif metric == "charm":
                val = row["net_charm"]
            elif metric == "call_oi":
                val = row["call_oi"]
            elif metric == "put_oi":
                val = row["put_oi"]
            elif metric == "volume":
                val = row["call_volume"] + row["put_volume"]
            else:
                val = row["net_gex"] # Default
                
            data_matrix[r_idx][c_idx] = float(val)

    result = {
        "ticker": ticker,
        "timestamp": target_ts.isoformat(),
        "spot_price": float(spot_price) if spot_price is not None else None,
        "gamma_flip": float(gamma_flip) if (gamma_flip is not None and not np.isnan(gamma_flip)) else None,
        "net_gamma": net_gamma,
        "call_wall": float(call_wall) if (call_wall is not None and not np.isnan(call_wall)) else None,
        "put_wall": float(put_wall) if (put_wall is not None and not np.isnan(put_wall)) else None,
        "columns": columns,
        "rows": [float(r) for r in rows],
        "data": [[float(x) for x in row] for row in data_matrix]
    }

    if is_redis_active:
        try:
            redis_conn.set(cache_key, json.dumps(result), ex=86400)
            if not timestamp:
                latest_cache_key = f"atlas:heatmap:v2:{ticker}:{metric}:latest:{strikeCount}"
                redis_conn.set(latest_cache_key, json.dumps(result), ex=86400)
                # Base key from architecture doc
                redis_conn.set(f"atlas:heatmap:v2:{ticker}:latest", json.dumps(result), ex=86400)
        except Exception as e:
            print(f"Redis cache write error: {e}")

    return result

@router.get("/replay/timeline/{ticker}")
def get_replay_timeline(
    ticker: str,
    date: str = Query(...), # YYYY-MM-DD
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Returns list of all Unix timestamps available for a ticker on a specific date.
    """
    ticker = ticker.upper()
    try:
        query_date = py_date.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    # Fetch unique timestamps for this ticker on this date
    start_dt = datetime.combine(query_date, datetime.min.time())
    end_dt = datetime.combine(query_date, datetime.max.time())
    
    timestamps = db.query(DealerMetricSnapshot.timestamp).filter(
        DealerMetricSnapshot.ticker == ticker,
        DealerMetricSnapshot.timestamp >= start_dt,
        DealerMetricSnapshot.timestamp <= end_dt
    ).distinct().order_by(DealerMetricSnapshot.timestamp.asc()).all()

    # If no snapshots exist for this ticker on this date, trigger on-the-fly backfill
    # Only do this for historical dates strictly before Eastern Time today
    import zoneinfo
    eastern_today = datetime.now(timezone.utc).astimezone(zoneinfo.ZoneInfo("America/New_York")).date()
    if not timestamps and query_date < eastern_today:
        from app.core.config import settings
        if settings.DATA_PROVIDER == "thetadata":
            try:
                from app.db.backfill_eod import run_backfill
                run_backfill(ticker=ticker, backfill_date=query_date, db=db)
                # Re-query timestamps
                timestamps = db.query(DealerMetricSnapshot.timestamp).filter(
                    DealerMetricSnapshot.ticker == ticker,
                    DealerMetricSnapshot.timestamp >= start_dt,
                    DealerMetricSnapshot.timestamp <= end_dt
                ).distinct().order_by(DealerMetricSnapshot.timestamp.asc()).all()
            except Exception as e:
                print(f"On-the-fly backfill failed for {ticker} date {date}: {e}")

    # Convert timestamps to unix epoch seconds, forcing UTC timezone for naive values
    unix_timestamps = []
    for ts in timestamps:
        dt = ts[0]
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        unix_timestamps.append(int(dt.timestamp()))

    return {
        "ticker": ticker,
        "date": date,
        "timestamps": unix_timestamps
    }

@router.get("/heatmap/{ticker}/history")
def get_heatmap_history(
    ticker: str,
    date: str = Query(...), # YYYY-MM-DD
    metric: str = Query("net_gex"),
    strikeCount: int = Query(20),
    db: Session = Depends(get_db),
    redis_conn: Any = Depends(get_redis)
) -> Dict[str, Any]:
    """
    Returns the complete dictionary of heatmap snapshots mapping unix timestamps to HeatmapSnapshots for the date.
    """
    ticker = ticker.upper()
    metric = metric.lower()
    
    # Cache key format: atlas:heatmap:history:v2:{ticker}:{date}:{metric}:{strikeCount}
    cache_key = f"atlas:heatmap:history:v2:{ticker}:{date}:{metric}:{strikeCount}"
    
    is_redis_active = redis_conn is not None and type(redis_conn).__name__ != "Depends"
    
    if is_redis_active:
        try:
            cached_data = redis_conn.get(cache_key)
            if cached_data:
                return json.loads(cached_data)
        except Exception as e:
            print(f"Redis cache lookup error for history: {e}")
            
    try:
        query_date = py_date.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    # 1. Fetch all snapshots and price quotes for this ticker on this date
    start_dt = datetime.combine(query_date, datetime.min.time())
    end_dt = datetime.combine(query_date, datetime.max.time())

    records = db.query(DealerMetricSnapshot).filter(
        DealerMetricSnapshot.ticker == ticker,
        DealerMetricSnapshot.timestamp >= start_dt,
        DealerMetricSnapshot.timestamp <= end_dt
    ).order_by(DealerMetricSnapshot.timestamp.asc()).all()

    if not records:
        return {"ticker": ticker, "date": date, "history": {}}

    prices = db.query(UnderlyingPriceSnapshot).filter(
        UnderlyingPriceSnapshot.ticker == ticker,
        UnderlyingPriceSnapshot.timestamp >= start_dt,
        UnderlyingPriceSnapshot.timestamp <= end_dt
    ).order_by(UnderlyingPriceSnapshot.timestamp.asc()).all()

    # Convert prices to a timestamp -> price mapping
    price_df = pd.DataFrame([{
        "timestamp": p.timestamp,
        "price": float(p.price)
    } for p in prices])

    # Convert records to DataFrame
    df = pd.DataFrame([{
        "timestamp": r.timestamp,
        "strike": float(r.strike),
        "expiration": r.expiration.isoformat() if isinstance(r.expiration, (py_date, datetime)) else str(r.expiration),
        "net_gex": float(r.net_gex),
        "net_dex": float(r.net_dex),
        "net_vanna": float(r.net_vanna),
        "net_charm": float(r.net_charm),
        "call_oi": int(r.call_oi),
        "put_oi": int(r.put_oi),
        "call_volume": int(r.call_volume),
        "put_volume": int(r.put_volume)
    } for r in records])

    # Group by timestamp
    grouped_time = df.groupby("timestamp")
    history = {}

    for ts, ts_df in grouped_time:
        # Convert timestamp to unix seconds
        dt = ts
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        ts_unix = int(dt.timestamp())

        # Find spot price closest to ts
        spot_price = None
        if not price_df.empty:
            # Absolute difference in seconds
            diffs = (price_df["timestamp"] - ts).dt.total_seconds().abs()
            closest_idx = diffs.idxmin()
            spot_price = price_df.loc[closest_idx, "price"]

        # Call/Put Wall calculations (based on full chain)
        grouped_full = ts_df.groupby("strike", as_index=False).agg({
            "net_gex": ["sum"],
            "net_dex": ["sum"]
        })
        grouped_full.columns = ["strike", "net_gex", "net_dex"]
        
        call_wall, put_wall = engine.find_walls(grouped_full)
        gamma_flip = engine.find_gamma_flip_strike(grouped_full, spot=spot_price)
        net_gamma = float(ts_df["net_gex"].sum()) if not ts_df.empty else 0.0

        # Filter strikes based on strikeCount
        ts_df_filtered = ts_df
        unique_strikes = ts_df["strike"].unique()
        if len(unique_strikes) > strikeCount and spot_price is not None:
            sorted_by_dist = sorted(unique_strikes, key=lambda s: abs(s - spot_price))
            target_strikes = set(sorted_by_dist[:strikeCount])
            ts_df_filtered = ts_df[ts_df["strike"].isin(target_strikes)]

        # Extract unique strikes (descending) and expirations (ascending)
        rows = sorted([float(x) for x in ts_df_filtered["strike"].unique()], reverse=True)
        columns = sorted(list(ts_df_filtered["expiration"].unique()))

        row_map = {strike: i for i, strike in enumerate(rows)}
        col_map = {exp: j for j, exp in enumerate(columns)}

        data_matrix = [[0.0 for _ in range(len(columns))] for _ in range(len(rows))]

        metric = metric.lower()
        for _, row in ts_df_filtered.iterrows():
            s = row["strike"]
            e = row["expiration"]
            if s in row_map and e in col_map:
                r_idx = row_map[s]
                c_idx = col_map[e]

                if metric == "net_gex":
                    val = row["net_gex"]
                elif metric == "net_dex":
                    val = row["net_dex"]
                elif metric == "vanna":
                    val = row["net_vanna"]
                elif metric == "charm":
                    val = row["net_charm"]
                elif metric == "call_oi":
                    val = row["call_oi"]
                elif metric == "put_oi":
                    val = row["put_oi"]
                elif metric == "volume":
                    val = row["call_volume"] + row["put_volume"]
                else:
                    val = row["net_gex"]

                data_matrix[r_idx][c_idx] = float(val)

        history[str(ts_unix)] = {
            "ticker": ticker,
            "timestamp": dt.isoformat(),
            "spot_price": float(spot_price) if spot_price is not None else None,
            "gamma_flip": float(gamma_flip) if (gamma_flip is not None and not np.isnan(gamma_flip)) else None,
            "net_gamma": net_gamma,
            "call_wall": float(call_wall) if (call_wall is not None and not np.isnan(call_wall)) else None,
            "put_wall": float(put_wall) if (put_wall is not None and not np.isnan(put_wall)) else None,
            "columns": columns,
            "rows": rows,
            "data": data_matrix
        }

    result = {
        "ticker": ticker,
        "date": date,
        "history": history
    }

    if is_redis_active:
        try:
            redis_conn.set(cache_key, json.dumps(result), ex=86400)
        except Exception as e:
            print(f"Redis cache write error for history: {e}")

    return result

@router.get("/stock/{ticker}/candles")
def get_stock_candles(
    ticker: str,
    date: str = Query(...), # YYYY-MM-DD
    db: Session = Depends(get_db)
):
    """
    Returns actual intraday 5-minute price candles for the ticker on the target date.
    Fetches from Yahoo Finance and returns the OHLC data.
    """
    import requests
    from datetime import datetime, time as py_time, timezone
    
    ticker = ticker.upper()
    try:
        dt = datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    # Convert date to UTC boundaries
    start_ts = int(datetime.combine(dt, py_time.min).replace(tzinfo=timezone.utc).timestamp())
    end_ts = int(datetime.combine(dt, py_time.max).replace(tzinfo=timezone.utc).timestamp())

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?period1={start_ts}&period2={end_ts}&interval=5m"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    
    try:
        res = requests.get(url, headers=headers, timeout=5)
        if res.status_code != 200:
            return []
            
        data = res.json()
        result = data.get("chart", {}).get("result", [])
        if not result:
            return []
            
        chart_data = result[0]
        timestamps = chart_data.get("timestamp", [])
        indicators = chart_data.get("indicators", {}).get("quote", [{}])[0]
        
        opens = indicators.get("open", [])
        highs = indicators.get("high", [])
        lows = indicators.get("low", [])
        closes = indicators.get("close", [])
        
        candles = []
        for i in range(len(timestamps)):
            if (i < len(opens) and opens[i] is not None and
                i < len(highs) and highs[i] is not None and
                i < len(lows) and lows[i] is not None and
                i < len(closes) and closes[i] is not None):
                
                candles.append({
                    "time": int(timestamps[i]),
                    "open": float(opens[i]),
                    "high": float(highs[i]),
                    "low": float(lows[i]),
                    "close": float(closes[i])
                })
        return candles
    except Exception as e:
        print(f"Error fetching Yahoo Finance candles for {ticker} on {date}: {e}")
        return []
