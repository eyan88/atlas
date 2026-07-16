from fastapi import APIRouter, HTTPException, Query
from typing import Optional, Dict, Any
import httpx
from app.core.config import settings

router = APIRouter()

def get_base_url() -> str:
    """
    Normalizes the base URL. If the user provided a URL ending in '/api' or with a trailing slash,
    normalizes it to the root domain so that we can append '/api/...' consistently.
    """
    url = settings.GAMMA_FLOW_API_URL.rstrip('/')
    if url.endswith('/api'):
        url = url[:-4].rstrip('/')
    return url

async def forward_request(url: str, params: Optional[Dict[str, Any]] = None) -> Any:
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, params=params, timeout=10.0)
            if response.status_code == 404:
                raise HTTPException(status_code=404, detail="Resource not found on external API")
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=f"External API error: {str(e)}")
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Failed to connect to external Gamma Flow API: {str(e)}")

@router.get("/current/{ticker}")
async def get_current_gamma(ticker: str) -> Dict[str, Any]:
    """
    Proxy request to fetch the latest options Greeks/Gamma exposure snapshot from the external API.
    """
    base_url = get_base_url()
    url = f"{base_url}/api/gamma/current/{ticker.upper()}"
    return await forward_request(url)

@router.get("/historical/{ticker}")
async def get_historical_gamma(
    ticker: str,
    date: Optional[str] = Query(None),
    limit: Optional[int] = Query(50)
) -> Dict[str, Any]:
    """
    Proxy request to fetch historical options Greeks/Gamma exposure snapshots from the external API.
    """
    base_url = get_base_url()
    url = f"{base_url}/api/gamma/historical/{ticker.upper()}"
    params = {}
    if date:
        params["date"] = date
    if limit:
        params["limit"] = limit
    return await forward_request(url, params)

@router.get("/net-flow/current/{ticker}")
async def get_current_net_flow(ticker: str) -> Dict[str, Any]:
    """
    Proxy request to fetch the current net options flow from the external API.
    """
    base_url = get_base_url()
    url = f"{base_url}/api/net-flow/current/{ticker.upper()}"
    return await forward_request(url)

@router.get("/net-flow/historical/{ticker}")
async def get_historical_net_flow(
    ticker: str,
    date: Optional[str] = Query(None),
    limit: Optional[int] = Query(2000)
) -> Dict[str, Any]:
    """
    Proxy request to fetch historical net options flow data from the external API.
    """
    base_url = get_base_url()
    url = f"{base_url}/api/net-flow/historical/{ticker.upper()}"
    params = {}
    if date:
        params["date"] = date
    if limit:
        params["limit"] = limit
    return await forward_request(url, params)

@router.get("/dates/{ticker}")
async def get_available_dates(ticker: str) -> Dict[str, Any]:
    """
    Proxy request to fetch available dates with data for the ticker from the external API.
    """
    base_url = get_base_url()
    url = f"{base_url}/api/gamma/dates/{ticker.upper()}"
    return await forward_request(url)
