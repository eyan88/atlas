import os
import time
from datetime import date
from typing import List, Optional
import requests

from app.services.data_providers.base import (
    BaseDataProvider,
    DomainUnderlyingQuote,
    DomainOptionQuote,
)

class PolygonAPIError(Exception):
    """Exception raised for errors in the Polygon API."""
    pass

class PolygonRateLimitError(PolygonAPIError):
    """Exception raised when the Polygon API returns a 429 rate limit error after retries."""
    pass

class PolygonDataProvider(BaseDataProvider):
    def __init__(
        self,
        api_key: Optional[str] = None,
        max_retries: int = 3,
        backoff_factor: float = 0.5,
    ):
        """
        Initializes the PolygonDataProvider.
        
        Args:
            api_key: Polygon.io API key. If not provided, reads from POLYGON_API_KEY environment variable.
            max_retries: Maximum number of retries for rate limits (429) or transient 5xx errors.
            backoff_factor: Factor for exponential backoff sleep duration.
        """
        self.api_key = api_key or os.getenv("POLYGON_API_KEY")
        if not self.api_key:
            raise ValueError("Polygon API key is required. Pass it to __init__ or set POLYGON_API_KEY environment variable.")
        
        self.max_retries = max_retries
        self.backoff_factor = backoff_factor
        self.base_url = "https://api.polygon.io"

    def _make_request(self, url: str, params: Optional[dict] = None) -> dict:
        """
        Helper method to make HTTP GET requests with retries on rate limits (429) and transient errors.
        """
        if params is None:
            params = {}

        # Ensure apiKey is passed in query parameters if not present
        if "apiKey" not in params and "apiKey=" not in url:
            params["apiKey"] = self.api_key

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
        }

        retries = 0
        while True:
            try:
                response = requests.get(url, params=params, headers=headers, timeout=10)
                
                # Handle rate limiting (429)
                if response.status_code == 429:
                    if retries < self.max_retries:
                        sleep_time = self.backoff_factor * (2 ** retries)
                        time.sleep(sleep_time)
                        retries += 1
                        continue
                    else:
                        raise PolygonRateLimitError(
                            f"Rate limit exceeded (429) on {url} after {self.max_retries} retries."
                        )

                # Raise exception for HTTP errors (e.g. 4xx, 5xx)
                response.raise_for_status()

                # Parse JSON
                data = response.json()
                status = data.get("status")
                
                # Check Polygon specific error status
                if status and status.upper() not in ("OK", "SUCCESS"):
                    raise PolygonAPIError(
                        f"Polygon API returned status: {status}. Error message: {data.get('error', 'No detail provided')}"
                    )

                return data

            except requests.RequestException as e:
                # Retry for 5xx server errors
                is_5xx = e.response is not None and e.response.status_code >= 500
                is_conn_error = e.response is None  # Connection refused, timeout, etc.
                
                if (is_5xx or is_conn_error) and retries < self.max_retries:
                    sleep_time = self.backoff_factor * (2 ** retries)
                    time.sleep(sleep_time)
                    retries += 1
                    continue
                raise PolygonAPIError(f"HTTP request failed: {e}") from e

    def get_underlying_quote(self, ticker: str) -> DomainUnderlyingQuote:
        """
        Fetches the latest spot price snapshot of the underlying ticker.
        
        Args:
            ticker: The underlying ticker symbol (e.g., 'SPY').
            
        Returns:
            DomainUnderlyingQuote: Domain schema containing ticker, price, and timestamp.
        """
        url = f"{self.base_url}/v2/last/trade/{ticker}"
        data = self._make_request(url)

        trade_data = data.get("results") or data.get("last")
        if not trade_data:
            raise PolygonAPIError(f"No trade data found in response for ticker {ticker}")

        price = trade_data.get("p")
        if price is None:
            raise PolygonAPIError(f"Execution price 'p' missing in response for ticker {ticker}")

        raw_timestamp = trade_data.get("t")
        if raw_timestamp is None:
            raise PolygonAPIError(f"Timestamp 't' missing in response for ticker {ticker}")

        # Normalize timestamp to UTC seconds
        if raw_timestamp > 1_000_000_000_000_000:  # Nanoseconds
            timestamp_utc = int(raw_timestamp // 1_000_000_000)
        elif raw_timestamp > 1_000_000_000_000:    # Milliseconds
            timestamp_utc = int(raw_timestamp // 1_000)
        else:
            timestamp_utc = int(raw_timestamp)

        return DomainUnderlyingQuote(
            ticker=ticker,
            price=float(price),
            timestamp_utc=timestamp_utc,
        )

    def get_option_chain(self, ticker: str) -> List[DomainOptionQuote]:
        """
        Fetches the complete active option chain snapshot for the ticker, handling pagination.
        
        Args:
            ticker: The underlying ticker symbol (e.g., 'SPY').
            
        Returns:
            List[DomainOptionQuote]: List of option contracts quotes.
        """
        url = f"{self.base_url}/v3/snapshot/options/{ticker}"
        option_quotes: List[DomainOptionQuote] = []

        while url:
            data = self._make_request(url)
            results = data.get("results", [])

            for item in results:
                details = item.get("details", {})
                ticker_symbol = details.get("ticker", "")
                
                # Remove "O:" prefix typical of option tickers in Polygon
                if ticker_symbol.startswith("O:"):
                    contract_symbol = ticker_symbol[2:]
                else:
                    contract_symbol = ticker_symbol

                if not contract_symbol:
                    continue

                exp_str = details.get("expiration_date")
                if not exp_str:
                    continue
                try:
                    expiration = date.fromisoformat(exp_str)
                except ValueError:
                    continue

                raw_type = details.get("contract_type", "").lower()
                option_type = "C" if "call" in raw_type or raw_type == "c" else "P"

                strike = details.get("strike_price")
                if strike is None:
                    continue

                # Safely parse Greeks
                greeks = item.get("greeks") or {}
                delta = greeks.get("delta")
                gamma = greeks.get("gamma")
                vanna = greeks.get("vanna")
                charm = greeks.get("charm")

                # Safely parse Last Quote
                last_quote = item.get("last_quote") or {}
                bid = last_quote.get("bid", 0.0)
                ask = last_quote.get("ask", 0.0)

                # Safely parse Day performance
                day = item.get("day") or {}
                volume = day.get("volume", 0)

                open_interest = item.get("open_interest", 0)
                implied_volatility = item.get("implied_volatility")

                option_quotes.append(
                    DomainOptionQuote(
                        contract_symbol=contract_symbol,
                        strike=float(strike),
                        expiration=expiration,
                        option_type=option_type,
                        open_interest=int(open_interest),
                        volume=int(volume),
                        bid=float(bid),
                        ask=float(ask),
                        implied_volatility=float(implied_volatility) if implied_volatility is not None else None,
                        delta=float(delta) if delta is not None else None,
                        gamma=float(gamma) if gamma is not None else None,
                        vanna=float(vanna) if vanna is not None else None,
                        charm=float(charm) if charm is not None else None,
                    )
                )

            # Pagination handling
            next_url = data.get("next_url")
            if next_url == url:
                break
            url = next_url

        return option_quotes
