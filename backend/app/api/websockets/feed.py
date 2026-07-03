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

@router.websocket("/{ticker}")
async def websocket_endpoint(websocket: WebSocket, ticker: str, db: Session = Depends(get_db)):
    await websocket.accept()
    ticker = ticker.upper()
    
    try:
        # 1. Fetch the latest snapshot to send as INIT
        # We can reuse our get_heatmap endpoint function
        try:
            init_data = get_heatmap(ticker=ticker, metric="net_gex", timestamp=None, strikeCount=20, db=db)
            await websocket.send_json({
                "type": "INIT",
                "payload": init_data
            })
        except Exception as e:
            # Send error message if no initial data
            await websocket.send_json({
                "type": "ERROR",
                "message": f"Failed to load initial snapshot: {str(e)}"
            })
            await websocket.close()
            return

        # Keep track of current levels to mutate them
        current_spot = init_data["spot_price"] or 100.0
        current_flip = init_data["gamma_flip"]
        current_call = init_data["call_wall"]
        current_put = init_data["put_wall"]
        columns = init_data["columns"]
        rows = init_data["rows"]

        # 2. Replay/Live stream simulation loop
        while True:
            # Receive ping/messages to keep connection alive
            # Wait for data or timeout
            try:
                # We can await a small read or just sleep.
                # To prevent blocking, we use asyncio.wait_for
                # This handles incoming heartbeats ("ping") from frontend
                data = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
                if data == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                # Timeout occurred, this is our cue to broadcast the periodic update!
                pass

            # Mutate spot price slightly
            price_change = random.uniform(-0.15, 0.15)
            current_spot += price_change
            current_spot = round(current_spot, 2)

            # Keep walls and flip close to spot
            if current_flip is not None:
                current_flip = round(current_flip + random.choice([-0.5, 0.0, 0.5]), 2)
            if current_call is not None:
                current_call = round(current_call + random.choice([-0.5, 0.0, 0.5]), 2)
            if current_put is not None:
                current_put = round(current_put + random.choice([-0.5, 0.0, 0.5]), 2)

            # Generate incremental updates for 3 random cells
            diffs = []
            if rows and columns:
                sampled_strikes = random.sample(rows, min(len(rows), 3))
                sampled_exps = random.sample(columns, min(len(columns), 3))
                
                for k in sampled_strikes:
                    for e in sampled_exps:
                        # Random GEX shift
                        # Calls are generally positive, Puts are generally negative
                        is_positive = k > current_spot
                        gex_base = 5e8 if is_positive else -5e8
                        gex_val = gex_base * random.uniform(0.5, 1.5)
                        
                        diffs.append({
                            "k": float(k),
                            "e": str(e),
                            "g": float(gex_val),
                            "oi": int(random.randint(1000, 3000)),
                            "v": int(random.randint(50, 500))
                        })

            payload = {
                "ticker": ticker,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "spot_price": current_spot,
                "gamma_flip": current_flip,
                "call_wall": current_call,
                "put_wall": current_put,
                "diffs": diffs
            }

            await websocket.send_json({
                "type": "PATCH",
                "payload": payload
            })

    except WebSocketDisconnect:
        # Client disconnected cleanly
        pass
    except Exception as e:
        # Logging or handling other errors
        pass
