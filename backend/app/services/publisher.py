import asyncio
import random
import json
import redis.asyncio as aioredis
from datetime import datetime, timezone
from app.core.config import settings

async def redis_mock_publisher():
    """
    Background loop simulating data ingestion pipeline.
    Periodically publishes cell diff updates to Redis Pub/Sub channels (atlas:realtime:{ticker})
    and updates the latest cache key (atlas:heatmap:{ticker}:latest).
    """
    # Initialize connection
    r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    tickers = ["SPY", "QQQ", "IWM"]
    
    # Starting base spots for indexes
    spot_levels = {
        "SPY": 542.00,
        "QQQ": 475.00,
        "IWM": 210.00
    }
    
    print("Starting background Redis mock publisher task...")
    try:
        # Verify connection first
        await r.ping()
        print("Connected to Redis for background Pub/Sub publishing.")
    except Exception as e:
        print(f"Notice: Redis is unreachable. Mock Pub/Sub background task won't publish. Error: {e}")
        await r.close()
        return

    try:
        while True:
            await asyncio.sleep(5.0)
            for ticker in tickers:
                # Evolve spot price slightly
                spot_levels[ticker] = round(spot_levels[ticker] + random.uniform(-0.15, 0.15), 2)
                spot = spot_levels[ticker]
                
                # Dynamic levels close to spot
                call_wall = round(spot + 3.0 + random.choice([-0.5, 0.0, 0.5]), 2)
                put_wall = round(spot - 4.0 + random.choice([-0.5, 0.0, 0.5]), 2)
                gamma_flip = round(spot + random.choice([-0.25, 0.0, 0.25]), 2)
                
                # Generate cell diff patches for 3 random cells
                diffs = []
                columns = ["2026-07-03", "2026-07-10", "2026-07-17"]
                rows = [round(spot + i) for i in range(-5, 6)]
                
                if rows and columns:
                    sampled_strikes = random.sample(rows, min(len(rows), 3))
                    sampled_exps = random.sample(columns, min(len(columns), 3))
                    
                    for k in sampled_strikes:
                        for e in sampled_exps:
                            is_call = k > spot
                            gex_base = 5e8 if is_call else -5e8
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
                    "spot_price": spot,
                    "gamma_flip": gamma_flip,
                    "call_wall": call_wall,
                    "put_wall": put_wall,
                    "diffs": diffs
                }
                
                try:
                    # Publish JSON frame payload to Redis channel
                    channel = f"atlas:realtime:{ticker}"
                    await r.publish(channel, json.dumps(payload))
                except Exception as e:
                    print(f"Failed to publish cell diff to Redis: {e}")
                    
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"Background Redis mock publisher encountered error: {e}")
    finally:
        await r.aclose()
        print("Redis mock publisher closed.")
