from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.endpoints import tickers, heatmap

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

# Set all CORS enabled origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
app.include_router(
    heatmap.router,
    prefix=settings.API_V1_STR,
    tags=["heatmap"]
)
