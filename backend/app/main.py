import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from app.core.config import settings
from app.api.endpoints import tickers, heatmap, gamma_flow
from app.api.websockets import feed
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Starting Atlas Backend - End of Day Dealer Positioning Service...")
    yield
    print("Stopping Atlas Backend...")

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan
)

# Enable Gzip compression for network egress optimization (responses > 500 bytes)
app.add_middleware(GZipMiddleware, minimum_size=500)

# Set all CORS enabled origins safely with regex support for cloud origins
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Healthcheck
@app.get("/health")
def health():
    return {"status": "ok"}

# Include routers
# Tickers router mounted at /api/v1/tickers
app.include_router(
    tickers.router,
    prefix=f"{settings.API_V1_STR}/tickers",
    tags=["tickers"]
)

# Heatmap router mounted at /api/v1
# This exposes:
#   - GET /api/v1/heatmap/{ticker}
#   - GET /api/v1/replay/timeline/{ticker}
#   - GET /api/v1/heatmap/{ticker}/history
app.include_router(
    heatmap.router,
    prefix=settings.API_V1_STR,
    tags=["heatmap"]
)

# WebSocket feed router mounted at /api/v1/ws
app.include_router(
    feed.router,
    prefix=f"{settings.API_V1_STR}/ws",
    tags=["websockets"]
)

# Gamma Flow router mounted at /api/v1/gamma-flow
app.include_router(
    gamma_flow.router,
    prefix=f"{settings.API_V1_STR}/gamma-flow",
    tags=["gamma-flow"]
)

