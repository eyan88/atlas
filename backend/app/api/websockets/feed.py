from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Depends
from sqlalchemy.orm import Session
import asyncio
import json
import random
from datetime import datetime, timezone
import numpy as np

from app.api.deps import get_db
from app.models.metric import DealerMetricSnapshot
from app.models.underlying import UnderlyingPriceSnapshot
from app.api.endpoints.heatmap import get_heatmap

router = APIRouter()
from app.db.session import SessionLocal

@router.websocket("/{ticker}")
async def websocket_endpoint(websocket: WebSocket, ticker: str, strikeCount: int = 40):
    await websocket.accept()
    ticker = ticker.upper()
    
    # 1. Fetch and send the initial full snapshot (INIT)
    db = None
    try:
        db = SessionLocal()
        init_data = get_heatmap(ticker=ticker, metric="net_gex", timestamp=None, strikeCount=strikeCount, db=db, redis_conn=None)
        await websocket.send_json({
            "type": "INIT",
            "payload": init_data
        })
    except HTTPException as e:
        if e.status_code == 404 and db:
            from app.core.config import settings
            from app.db.backfill_eod import run_backfill
            from datetime import date, timedelta
            
            if settings.DATA_PROVIDER == "thetadata":
                print(f"Bootstrapping historical data for novel ticker {ticker}...")
                success = False
                for offset in range(1, 8): # Look back up to a week
                    target_date = date.today() - timedelta(days=offset)
                    try:
                        run_backfill(ticker=ticker, backfill_date=target_date, db=db)
                        target_ts = db.query(DealerMetricSnapshot.timestamp).filter(DealerMetricSnapshot.ticker == ticker).first()
                        if target_ts:
                            success = True
                            break
                    except Exception as err:
                        print(f"Bootstrap step failed for {target_date}: {err}")
                
                if success:
                    try:
                        init_data = get_heatmap(ticker=ticker, metric="net_gex", timestamp=None, strikeCount=strikeCount, db=db, redis_conn=None)
                        await websocket.send_json({"type": "INIT", "payload": init_data})
                    except Exception as inner_e:
                        await websocket.send_json({"type": "ERROR", "message": f"Failed after bootstrap: {str(inner_e)}"})
                else:
                    await websocket.send_json({"type": "ERROR", "message": "Failed to bootstrap any historical data for this ticker."})
            else:
                await websocket.send_json({"type": "ERROR", "message": "No historical data and not configured to bootstrap."})
        else:
            await websocket.send_json({"type": "ERROR", "message": f"Failed to load initial snapshot: {str(e)}"})
    except Exception as e:
        print(f"WebSocket INIT exception for {ticker}: {e}")
        try:
            await websocket.send_json({
                "type": "ERROR",
                "message": f"Failed to load initial snapshot: {str(e)}"
            })
        except Exception:
            pass
    finally:
        if db:
            db.close()

    # 2. Establish connection to Redis Pub/Sub
    import redis.asyncio as aioredis
    from app.core.config import settings
    
    redis_conn = None
    pubsub = None
    try:
        redis_conn = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        # Verify connectivity
        await redis_conn.ping()
        pubsub = redis_conn.pubsub()
        await pubsub.subscribe(f"atlas:realtime:{ticker}")
        print(f"WebSocket client connected and subscribed to Redis channel: atlas:realtime:{ticker}")
    except Exception as e:
        print(f"Warning: Redis unreachable, falling back to local simulation updates. Error: {e}")
        if pubsub:
            await pubsub.close()
        if redis_conn:
            await redis_conn.aclose()
        pubsub = None
        redis_conn = None

    if pubsub:
        # ─── Case A: Redis Pub/Sub Mode ──────────────────────────────────────
        async def redis_listener():
            try:
                async for message in pubsub.listen():
                    if message["type"] == "message":
                        payload = json.loads(message["data"])
                        await websocket.send_json({
                            "type": "PATCH",
                            "payload": payload
                        })
            except asyncio.CancelledError:
                pass
            except Exception as e:
                print(f"Error in Redis Pub/Sub listener: {e}")

        # Run Pub/Sub listener concurrently in background task
        listener_task = asyncio.create_task(redis_listener())
        try:
            while True:
                # Listen to incoming messages from client (e.g. heartbeat pings)
                data = await websocket.receive_text()
                if data == "ping":
                    await websocket.send_text("pong")
        except WebSocketDisconnect:
            pass
        finally:
            listener_task.cancel()
            try:
                await pubsub.unsubscribe(f"atlas:realtime:{ticker}")
                await pubsub.close()
                await redis_conn.aclose()
            except Exception:
                pass
    else:
        # ─── Case B: No Redis – Passive Hold (Production Safe) ────────────────
        # No active publisher is running. Keep the WebSocket alive for heartbeat
        # only. Do NOT simulate or mutate prices – the INIT snapshot is sufficient.
        try:
            while True:
                data = await websocket.receive_text()
                if data == "ping":
                    await websocket.send_text("pong")
        except WebSocketDisconnect:
            pass
