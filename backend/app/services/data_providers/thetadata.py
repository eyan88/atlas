import os
import time
from datetime import date, datetime, timedelta
from typing import List, Optional
import pandas as pd

from app.services.data_providers.base import (
    BaseDataProvider,
    DomainUnderlyingQuote,
    DomainOptionQuote,
)

class ThetaDataAPIError(Exception):
    """Exception raised for errors in the ThetaData API client."""
    pass

class ThetaDataProvider(BaseDataProvider):
    def __init__(
        self,
        username: Optional[str] = None,
        password: Optional[str] = None,
        email: Optional[str] = None,
    ):
        """
        Initializes the ThetaDataProvider using the official thetadata client.
        Reads credentials from arguments or from THETADATA_USERNAME/THETADATA_PASSWORD environment variables.
        """
        self.username = username or email or os.getenv("THETADATA_USERNAME") or os.getenv("THETADATA_EMAIL")
        self.password = password or os.getenv("THETADATA_PASSWORD")

        # Prepare configuration dict
        client_kwargs = {
            "dataframe_type": "pandas"
        }
        # Naming could be username or email depending on library version
        if self.username:
            client_kwargs["username"] = self.username
        if self.password:
            client_kwargs["password"] = self.password

        try:
            from thetadata import ThetaClient
            self.client = ThetaClient(**client_kwargs)
            # Connect automatically
            self.client.connect()
        except ImportError:
            raise ImportError(
                "The 'thetadata' library is required to use ThetaDataProvider. "
                "Install it using 'pip install thetadata'."
            )
        except Exception as e:
            raise ThetaDataAPIError(f"Failed to connect to ThetaData: {e}") from e

    def get_underlying_quote(self, ticker: str) -> DomainUnderlyingQuote:
        """
        Fetches the latest spot price of the underlying ticker.
        Attempts direct snapshot methods first, then falls back to 1-minute historical bars.
        """
        # 1. Try get_last_trade if supported in this version
        if hasattr(self.client, "get_last_trade"):
            try:
                trade = self.client.get_last_trade(ticker)
                if trade and hasattr(trade, "price"):
                    return DomainUnderlyingQuote(
                        ticker=ticker,
                        price=float(trade.price),
                        timestamp_utc=int(time.time()),
                    )
            except Exception:
                pass

        # 2. Fallback: query recent 1-minute quotes to retrieve the latest print
        today = date.today()
        for offset in range(3): # look back up to 2 days for weekend/market-close support
            target_date = today - timedelta(days=offset)
            try:
                df = self.client.stock_history_quote(
                    symbol=ticker,
                    date=target_date,
                    interval="1m"
                )
                if df is not None and not df.empty:
                    # Find price in common column names
                    price = None
                    for col in ["price", "last", "close", "ask", "bid"]:
                        if col in df.columns:
                            price = df[col].iloc[-1]
                            break
                    
                    if price is not None:
                        # Find timestamp
                        ts = int(time.time())
                        if "timestamp" in df.columns:
                            ts = int(df["timestamp"].iloc[-1])
                        
                        return DomainUnderlyingQuote(
                            ticker=ticker,
                            price=float(price),
                            timestamp_utc=ts
                        )
            except Exception:
                continue

        raise ThetaDataAPIError(f"Could not retrieve stock price for {ticker} from ThetaData.")

    def get_option_chain(self, ticker: str) -> List[DomainOptionQuote]:
        """
        Fetches the complete active option chain snapshot and calculates Greeks locally (Method B)
        using the native Rust-backed Black-Scholes solver from thetadatadx.
        """
        option_quotes: List[DomainOptionQuote] = []

        # 1. Fetch spot price of the underlying for Greeks calculation inputs
        try:
            spot_quote = self.get_underlying_quote(ticker)
            spot_price = spot_quote.price
        except Exception as e:
            raise ThetaDataAPIError(f"Failed to fetch underlying spot price for Greeks calculations: {e}") from e

        # 2. Get all active expirations
        try:
            expirations = self.client.get_expirations(root=ticker)
        except Exception as e:
            raise ThetaDataAPIError(f"Failed to fetch expirations for {ticker}: {e}") from e

        if not expirations:
            return []

        # 3. Retrieve local Greeks calculator
        try:
            from thetadatadx import all_greeks
        except ImportError:
            raise ImportError(
                "The 'thetadatadx' library is required to calculate Greeks locally (Method B). "
                "Install it using 'pip install thetadatadx'."
            )

        today = date.today()

        # 4. Iterate through expirations to compile quotes
        # We limit to the first 25 expirations for performance
        for exp in expirations[:25]:
            try:
                # Query option snapshot containing raw quotes
                df = self.client.option_snapshot(
                    symbol=ticker,
                    expiration=exp
                )
                if df is None or df.empty:
                    continue

                # Lowercase columns to handle naming variations
                cols = {c.lower(): c for c in df.columns}
                
                strike_col = cols.get("strike")
                right_col = cols.get("right") or cols.get("option_type") or cols.get("type")
                oi_col = cols.get("open_interest") or cols.get("openinterest") or cols.get("oi")
                volume_col = cols.get("volume") or cols.get("vol")
                bid_col = cols.get("bid")
                ask_col = cols.get("ask")

                # Compute time-to-expiration in years
                tte = max(0.0001, (exp - today).days) / 365.0

                for _, row in df.iterrows():
                    strike = row[strike_col] if strike_col else None
                    if strike is None:
                        continue

                    raw_right = str(row[right_col]).upper() if right_col else "C"
                    option_type = "C" if "C" in raw_right or "CALL" in raw_right else "P"

                    open_interest = int(row[oi_col]) if oi_col else 0
                    volume = int(row[volume_col]) if volume_col else 0
                    bid = float(row[bid_col]) if bid_col else 0.0
                    ask = float(row[ask_col]) if ask_col else 0.0
                    mid_price = (bid + ask) / 2.0

                    # Calculate Greeks locally using Method B (Rust-backed Black-Scholes solver)
                    try:
                        g = all_greeks(
                            spot=spot_price,
                            strike=float(strike),
                            rate=0.05,
                            div_yield=0.015,
                            tte=tte,
                            option_price=max(0.01, mid_price),
                            right=option_type
                        )
                        iv = float(g.iv) if hasattr(g, "iv") else None
                        delta = float(g.delta) if hasattr(g, "delta") else None
                        gamma = float(g.gamma) if hasattr(g, "gamma") else None
                        vanna = float(g.vanna) if hasattr(g, "vanna") else None
                        charm = float(g.charm) if hasattr(g, "charm") else None
                    except Exception as e:
                        # Fallback to None if calculations fail for a single strike
                        print(f"Warning: Local Greeks calculation failed for strike {strike} right {option_type}: {e}")
                        iv, delta, gamma, vanna, charm = None, None, None, None, None

                    # Generate standardized OCC contract symbol
                    strike_cents = int(float(strike) * 1000)
                    strike_str = f"{strike_cents:08d}"
                    exp_str = exp.strftime("%y%m%d")
                    contract_symbol = f"{ticker}{exp_str}{option_type}{strike_str}"

                    option_quotes.append(DomainOptionQuote(
                        contract_symbol=contract_symbol,
                        strike=float(strike),
                        expiration=exp,
                        option_type=option_type,
                        open_interest=open_interest,
                        volume=volume,
                        bid=bid,
                        ask=ask,
                        implied_volatility=iv,
                        delta=delta,
                        gamma=gamma,
                        vanna=vanna,
                        charm=charm
                    ))
            except Exception as e:
                # Log warning and proceed with the remaining expirations
                print(f"Warning: Failed to fetch option snapshot for {ticker} exp {exp}: {e}")
                continue

        return option_quotes
