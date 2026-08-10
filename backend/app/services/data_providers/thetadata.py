import os
import time
from datetime import date, timedelta
from typing import List, Optional
import asyncio
import pandas as pd
import numpy as np
from scipy.stats import norm
from scipy.optimize import brentq

class GreeksResult:
    def __init__(self, iv, delta, gamma, vanna, charm):
        self.iv = iv
        self.delta = delta
        self.gamma = gamma
        self.vanna = vanna
        self.charm = charm

def _bs_price(iv, S, K, T, r, q, cp):
    if T <= 0 or iv <= 0:
        return max(0.0, S - K) if cp == 'C' else max(0.0, K - S)
    d1 = (np.log(S / K) + (r - q + 0.5 * iv ** 2) * T) / (iv * np.sqrt(T))
    d2 = d1 - iv * np.sqrt(T)
    if cp == 'C':
        return S * np.exp(-q * T) * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
    else:
        return K * np.exp(-r * T) * norm.cdf(-d2) - S * np.exp(-q * T) * norm.cdf(-d1)

def compute_all_greeks(spot, strike, rate, div_yield, tte, option_price, right):
    cp = 'C' if right.upper() == 'C' else 'P'
    S, K, T, r, q, P = spot, strike, tte, rate, div_yield, option_price
    
    intrinsic = max(0.0, S - K) if cp == 'C' else max(0.0, K - S)
    if P <= intrinsic:
        return GreeksResult(0.001, 1.0 if cp=='C' else -1.0, 0.0, 0.0, 0.0)

    def obj_func(sigma):
        return _bs_price(sigma, S, K, T, r, q, cp) - P

    try:
        iv = brentq(obj_func, 1e-4, 10.0, maxiter=100)
    except ValueError:
        if obj_func(1e-4) > 0: iv = 1e-4
        elif obj_func(10.0) < 0: iv = 10.0
        else: iv = 0.5

    if T <= 0 or iv <= 0:
        return GreeksResult(iv, 1.0 if cp=='C' else -1.0, 0.0, 0.0, 0.0)
        
    d1 = (np.log(S / K) + (r - q + 0.5 * iv ** 2) * T) / (iv * np.sqrt(T))
    d2 = d1 - iv * np.sqrt(T)
    nd1 = norm.pdf(d1)
    
    if cp == 'C':
        delta = np.exp(-q * T) * norm.cdf(d1)
        charm = q * np.exp(-q * T) * norm.cdf(d1) - np.exp(-q * T) * nd1 * (2*(r-q)*T - d2*iv*np.sqrt(T)) / (2*T*iv*np.sqrt(T))
    else:
        delta = -np.exp(-q * T) * norm.cdf(-d1)
        charm = -q * np.exp(-q * T) * norm.cdf(-d1) - np.exp(-q * T) * nd1 * (2*(r-q)*T - d2*iv*np.sqrt(T)) / (2*T*iv*np.sqrt(T))
        
    gamma = np.exp(-q * T) * nd1 / (S * iv * np.sqrt(T))
    vanna = -np.exp(-q * T) * nd1 * d2 / iv
        
    return GreeksResult(iv, delta, gamma, vanna, charm)

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
            client_kwargs["email"] = self.username
        if self.password:
            client_kwargs["password"] = self.password

        try:
            from thetadata import ThetaClient
            self.client = ThetaClient(**client_kwargs)
        except ImportError:
            raise ImportError(
                "The 'thetadata' library is required to use ThetaDataProvider. "
                "Install it using 'pip install thetadata'."
            )
        except Exception as e:
            raise ThetaDataAPIError(f"Failed to connect to ThetaData: {e}") from e

    def get_underlying_quote(self, ticker: str) -> DomainUnderlyingQuote:
        """
        Fetches the latest real-time spot price of the underlying ticker.
        Attempts real-time market API first, then falls back to ThetaData snapshots and bars.
        """
        ticker = ticker.upper()

        # 1. Primary Source: Yahoo Finance Real-Time Quote (instant live market price)
        try:
            import requests
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1m&range=1d"
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            }
            res = requests.get(url, headers=headers, timeout=3)
            if res.status_code == 200:
                data = res.json()
                result = data.get("chart", {}).get("result", [])
                if result:
                    meta = result[0].get("meta", {})
                    regular_price = meta.get("regularMarketPrice")
                    if regular_price and float(regular_price) > 0:
                        return DomainUnderlyingQuote(
                            ticker=ticker,
                            price=float(regular_price),
                            timestamp_utc=int(time.time()),
                        )
                    indicators = result[0].get("indicators", {}).get("quote", [{}])[0]
                    closes = [c for c in indicators.get("close", []) if c is not None]
                    if closes:
                        return DomainUnderlyingQuote(
                            ticker=ticker,
                            price=float(closes[-1]),
                            timestamp_utc=int(time.time()),
                        )
        except Exception as e:
            print(f"Notice: Yahoo real-time price fetch notice for {ticker}: {e}")

        # 2. Try get_last_trade if supported in this version
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

        # 2. Try stock_snapshot_trade (requires standard subscription)
        if hasattr(self.client, "stock_snapshot_trade"):
            try:
                df = self.client.stock_snapshot_trade(symbol=ticker)
                if df is not None and not df.empty:
                    price = None
                    for col in ["price", "last", "close", "ask", "bid"]:
                        for c in df.columns:
                            if c.lower() == col.lower():
                                price = df[c].iloc[-1]
                                break
                        if price is not None:
                            break
                    if price is not None:
                        return DomainUnderlyingQuote(
                            ticker=ticker,
                            price=float(price),
                            timestamp_utc=int(time.time()),
                        )
            except Exception:
                pass

        # 3. Fallback: query recent 1-minute quotes (requires standard subscription)
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
                        for c in df.columns:
                            if c.lower() == col.lower():
                                price = df[c].iloc[-1]
                                break
                        if price is not None:
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

        # 4. Deep Fallback: query stock_history_eod (works on FREE plan)
        for offset in range(5): # look back up to 4 days to cover long weekends
            target_date = today - timedelta(days=offset)
            try:
                df = self.client.stock_history_eod(
                    symbol=ticker,
                    start_date=target_date,
                    end_date=target_date
                )
                if df is not None and not df.empty:
                    price = None
                    for col in ["close", "last_trade", "open", "high", "low", "bid", "ask"]:
                        for c in df.columns:
                            if c.lower() == col.lower():
                                price = df[c].iloc[-1]
                                break
                        if price is not None:
                            break
                    if price is not None:
                        return DomainUnderlyingQuote(
                            ticker=ticker,
                            price=float(price),
                            timestamp_utc=int(time.time())
                        )
            except Exception:
                continue

        raise ThetaDataAPIError(f"Could not retrieve stock price for {ticker} from ThetaData.")

    def get_option_chain(self, ticker: str, spot_price: float = None) -> List[DomainOptionQuote]:
        """
        Fetches the complete active option chain snapshot and calculates Greeks locally (Method B)
        using the native Rust-backed Black-Scholes solver from thetadatadx.
        """
        option_quotes: List[DomainOptionQuote] = []

        # 1. Fetch spot price of the underlying for Greeks calculation inputs
        if spot_price is None:
            try:
                spot_quote = self.get_underlying_quote(ticker)
                spot_price = spot_quote.price
            except Exception as e:
                raise ThetaDataAPIError(f"Failed to fetch underlying spot price for Greeks calculations: {e}") from e

        # 2. Get all active expirations (future or today)
        try:
            df_exp = self.client.option_list_expirations(symbol=ticker)
            df_exp['exp_date'] = pd.to_datetime(df_exp['expiration']).dt.date
            expirations = df_exp[df_exp['exp_date'] >= date.today()]['exp_date'].sort_values().tolist()
        except Exception as e:
            raise ThetaDataAPIError(f"Failed to fetch expirations for {ticker}: {e}") from e

        if not expirations:
            return []

        # 3. Retrieve local Greeks calculator
        # We now use the pure-python compute_all_greeks defined above
        
        today = date.today()
        max_date = today + timedelta(days=90)
        
        # 4. Iterate through expirations to compile quotes
        # Limit to 90 days out (to avoid Free Tier paywall on LEAPS) and max 20 expirations
        valid_expirations = [e for e in expirations if e <= max_date][:20]
        
        _denied_logged = set()
        for exp in valid_expirations:
            try:
                # Query option snapshot containing raw quotes
                df_quote = self.client.option_snapshot_quote(
                    symbol=ticker,
                    expiration=exp
                )
                if df_quote is None or df_quote.empty:
                    continue

                # Query open interest snapshot
                try:
                    df_oi = self.client.option_snapshot_open_interest(
                        symbol=ticker,
                        expiration=exp
                    )
                except Exception:
                    df_oi = pd.DataFrame()

                # Lowercase columns to handle naming variations and perform merge
                # Lowercase columns and normalize strike values (handle thousandths vs dollars)
                df_quote.columns = [c.lower() for c in df_quote.columns]
                
                def norm_strike(v):
                    try:
                        fv = float(v)
                        return round(fv / 1000.0, 2) if fv > 10000 else round(fv, 2)
                    except Exception:
                        return 0.0

                q_strike_col = "strike" if "strike" in df_quote.columns else "stk"
                df_quote["strike_norm"] = df_quote[q_strike_col].apply(norm_strike)
                
                # Determine type column name
                q_right_col = "right" if "right" in df_quote.columns else ("option_type" if "option_type" in df_quote.columns else "type")
                if q_right_col in df_quote.columns:
                    df_quote["right_norm"] = df_quote[q_right_col].astype(str).str.upper()
                else:
                    df_quote["right_norm"] = "C"

                if not df_oi.empty:
                    df_oi.columns = [c.lower() for c in df_oi.columns]
                    oi_strike_col = "strike" if "strike" in df_oi.columns else "stk"
                    df_oi["strike_norm"] = df_oi[oi_strike_col].apply(norm_strike)
                    
                    oi_right_col = "right" if "right" in df_oi.columns else ("option_type" if "option_type" in df_oi.columns else "type")
                    if oi_right_col in df_oi.columns:
                        df_oi["right_norm"] = df_oi[oi_right_col].astype(str).str.upper()
                    else:
                        df_oi["right_norm"] = "C"

                    df = pd.merge(df_quote, df_oi, on=["strike_norm", "right_norm"], how="left", suffixes=("", "_oi"))
                else:
                    df = df_quote
                    df["open_interest"] = 0

                cols = {c.lower(): c for c in df.columns}
                
                oi_col = cols.get("open_interest") or cols.get("openinterest") or cols.get("oi") or cols.get("open_interest_oi")
                volume_col = cols.get("volume") or cols.get("vol")
                bid_col = cols.get("bid")
                ask_col = cols.get("ask")

                # Compute time-to-expiration in years (minimum 1 trading day = 1/365)
                days_to_exp = (exp - today).days
                tte = max(1.0 / 365.0, days_to_exp / 365.0)

                for _, row in df.iterrows():
                    strike = row["strike_norm"]
                    if not strike or strike <= 0:
                        continue

                    option_type = "C" if "C" in str(row["right_norm"]) or "CALL" in str(row["right_norm"]).upper() else "P"

                    open_interest = int(row[oi_col]) if oi_col and pd.notna(row[oi_col]) else 0
                    volume = int(row[volume_col]) if volume_col and pd.notna(row[volume_col]) else 0
                    bid = float(row[bid_col]) if bid_col and pd.notna(row[bid_col]) else 0.0
                    ask = float(row[ask_col]) if ask_col and pd.notna(row[ask_col]) else 0.0
                    mid_price = (bid + ask) / 2.0

                    # Calculate Greeks locally using Black-Scholes solver
                    try:
                        # Use market price if available; fallback to baseline Black-Scholes if deep OTM
                        target_price = mid_price if mid_price > 0.01 else 0.05
                        g = compute_all_greeks(
                            spot=spot_price,
                            strike=float(strike),
                            rate=0.05,
                            div_yield=0.015,
                            tte=tte,
                            option_price=target_price,
                            right=option_type
                        )
                        iv = float(g.iv) if hasattr(g, "iv") else None
                        delta = float(g.delta) if hasattr(g, "delta") else None
                        gamma = float(g.gamma) if hasattr(g, "gamma") else None
                        vanna = float(g.vanna) if hasattr(g, "vanna") else None
                        charm = float(g.charm) if hasattr(g, "charm") else None
                    except Exception as e:
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
                error_msg = str(e)
                if "PERMISSION_DENIED" in error_msg:
                    if exp not in _denied_logged:
                        print(f"Notice: ThetaData Free Tier limit restricts exp {exp}. Skipping.")
                        _denied_logged.add(exp)
                    continue
                # Log warning and proceed with the remaining expirations
                print(f"Warning: Failed to fetch option snapshot for {ticker} exp {exp}: {e}")
                continue

        return option_quotes
