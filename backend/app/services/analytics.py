import numpy as np
import pandas as pd
from scipy.stats import norm
from typing import Tuple, Optional

class BlackScholesCalculator:
    """
    Vectorized calculator for standard Black-Scholes-Merton option Greeks.
    """
    @staticmethod
    def _calc_d1_d2(
        S: float,
        K: pd.Series,
        t: pd.Series,
        sigma: pd.Series,
        r: float,
        q: float
    ) -> Tuple[pd.Series, pd.Series]:
        """
        Computes the standard d1 and d2 variables vectorized.
        Clipped values are used for time-to-expiry and IV to prevent division by zero or NaN.
        """
        # Clip time to expiration to prevent division by zero
        t_clipped = np.maximum(t, 1e-5)
        # Clip implied volatility to prevent division by zero
        sigma_clipped = np.maximum(sigma, 1e-5)
        
        d1 = (np.log(S / K) + (r - q + 0.5 * sigma_clipped ** 2) * t_clipped) / (sigma_clipped * np.sqrt(t_clipped))
        d2 = d1 - sigma_clipped * np.sqrt(t_clipped)
        return d1, d2

    def compute_greeks(
        self,
        df: pd.DataFrame,
        spot: float,
        r: float,
        q: float,
        reference_date: pd.Timestamp
    ) -> pd.DataFrame:
        """
        Computes option Greeks (Delta, Gamma, Vanna, Charm) vectorized using Black-Scholes.
        
        Args:
            df: DataFrame containing the options chain. Must have columns:
                'strike', 'expiration', 'implied_volatility', 'option_type'
            spot: Spot price of the underlying asset (S)
            r: Annualized risk-free interest rate (e.g. 0.05)
            q: Annualized dividend yield (e.g. 0.015)
            reference_date: Timestamp of the current market snapshot to calculate time-to-expiration.
            
        Returns:
            A copy of the DataFrame with additional/updated columns:
            'delta', 'gamma', 'vanna', 'charm'
        """
        if df.empty:
            return df.copy()
            
        result_df = df.copy()

        # Days to expiration
        exp_dt = pd.to_datetime(df['expiration'])
        ref_dt = pd.to_datetime(reference_date)
        days = (exp_dt - ref_dt).dt.total_seconds() / (24 * 3600)
        t = days / 365.25
        t = np.maximum(t, 0.0)

        # Handle missing implied volatility
        sigma = df['implied_volatility'].fillna(1e-4)
        sigma = np.maximum(sigma, 1e-4)
        
        K = df['strike']

        d1, d2 = self._calc_d1_d2(spot, K, t, sigma, r, q)

        t_clipped = np.maximum(t, 1e-5)
        sigma_clipped = np.maximum(sigma, 1e-5)
        sqrt_t = np.sqrt(t_clipped)
        exp_qt = np.exp(-q * t)

        N_d1 = pd.Series(norm.cdf(d1), index=df.index)
        n_d1 = pd.Series(norm.pdf(d1), index=df.index)

        # Initialize columns
        delta = pd.Series(0.0, index=df.index)
        gamma = pd.Series(0.0, index=df.index)
        vanna = pd.Series(0.0, index=df.index)
        charm = pd.Series(0.0, index=df.index)

        # Vectorized Greeks calculations
        is_call = df['option_type'] == 'C'
        is_put = df['option_type'] == 'P'

        # Delta
        delta.loc[is_call] = exp_qt * N_d1
        delta.loc[is_put] = exp_qt * (N_d1 - 1.0)

        # Gamma (identical for Call/Put)
        gamma = exp_qt * n_d1 / (spot * sigma_clipped * sqrt_t)

        # Vanna (identical for Call/Put)
        vanna = -exp_qt * n_d1 * d2 / sigma_clipped

        # Charm
        common_term = exp_qt * n_d1 * ((r - q) / (sigma_clipped * sqrt_t) - d2 / (2.0 * t_clipped))
        charm.loc[is_call] = -q * exp_qt * N_d1 + common_term
        charm.loc[is_put] = q * exp_qt * (1.0 - N_d1) + common_term

        result_df['delta'] = delta
        result_df['gamma'] = gamma
        result_df['vanna'] = vanna
        result_df['charm'] = charm

        return result_df


class LeeReadyClassifier:
    """
    Vectorized implementation of the Lee-Ready (1991) Trade Aggressor Classification Algorithm.
    Determines whether option trades are Buyer-Initiated (+1) or Seller-Initiated (-1) for GEX alignment.
    """
    @staticmethod
    def classify_trades(trades_df: pd.DataFrame) -> pd.Series:
        """
        Classifies trade aggressor direction using the Lee-Ready Quote & Tick algorithm.
        
        Args:
            trades_df: DataFrame containing trade & quote data. Must have columns:
                'price', 'bid', 'ask' (and optional 'prev_price')
                
        Returns:
            pd.Series with values +1.0 (Buyer-Initiated / Ask-Side) or -1.0 (Seller-Initiated / Bid-Side).
        """
        if trades_df.empty:
            return pd.Series(dtype=float)

        price = trades_df['price']
        bid = trades_df['bid']
        ask = trades_df['ask']
        
        # Calculate Bid-Ask Midpoint
        midpoint = (bid + ask) / 2.0
        
        # 1. Quote Test
        sign = pd.Series(0.0, index=trades_df.index)
        sign[price > midpoint] = 1.0   # Buyer-Initiated (Ask-Side Aggression)
        sign[price < midpoint] = -1.0  # Seller-Initiated (Bid-Side Aggression)
        
        # 2. Tick Test (Fallback when price == midpoint or quotes missing)
        midpoint_mask = (price == midpoint) | (bid == 0.0) | (ask == 0.0) | (bid.isna()) | (ask.isna())
        if midpoint_mask.any():
            if 'prev_price' in trades_df.columns:
                prev_p = trades_df['prev_price']
            else:
                prev_p = price.shift(1).fillna(price)
                
            tick_diff = price - prev_p
            tick_sign = pd.Series(0.0, index=trades_df.index)
            tick_sign[tick_diff > 0] = 1.0
            tick_sign[tick_diff < 0] = -1.0
            
            # Forward-fill zero ticks (when price == prev_price)
            tick_sign = tick_sign.replace(0.0, np.nan).ffill().fillna(1.0)
            
            # Apply Tick Test for midpoint trades
            sign[midpoint_mask] = tick_sign[midpoint_mask]
            
        return sign


class DealerExposureEngine:
    """
    Vectorized computation engine for aggregate options dealer positioning.
    Calculates exposures (GEX, DEX, VEX, CEX) and parses key levels (Walls, Gamma Flip).
    """
    def calculate_exposures(self, chain_df: pd.DataFrame, spot: float) -> pd.DataFrame:
        """
        Computes GEX, DEX, VEX, and CEX for each option contract in the option chain.
        
        Args:
            chain_df: DataFrame of option contracts. Must contain:
                'open_interest', 'option_type', 'delta', 'gamma', 'vanna', 'charm'
            spot: Spot price of the underlying asset (S)
            
        Returns:
            A copy of the DataFrame with additional columns:
            'net_gex', 'net_dex', 'net_vanna', 'net_charm'
        """
        if chain_df.empty:
            return chain_df.copy()

        result_df = chain_df.copy()

        # Exposure calculation constants
        multiplier = 100.0
        gex_factor = multiplier * (spot ** 2) * 0.01
        dex_factor = multiplier * spot
        vex_factor = multiplier * spot * 0.01
        cex_factor = multiplier * spot

        oi = chain_df['open_interest'].fillna(0)
        gamma = chain_df['gamma'].fillna(0.0)
        delta = chain_df['delta'].fillna(0.0)
        vanna = chain_df['vanna'].fillna(0.0)
        charm = chain_df['charm'].fillna(0.0)

        # Calls are long dealer exposure (+1), Puts are short dealer exposure (-1)
        # under the profiling model that retail is net long calls/puts.
        is_call = (chain_df['option_type'] == 'C').astype(float)
        is_put = (chain_df['option_type'] == 'P').astype(float)
        sign = is_call - is_put

        result_df['net_gex'] = sign * oi * gamma * gex_factor
        result_df['net_dex'] = sign * oi * delta * dex_factor
        result_df['net_vanna'] = sign * oi * vanna * vex_factor
        result_df['net_charm'] = sign * oi * charm * cex_factor

        return result_df

    def calculate_intraday_volume_gex(self, chain_df: pd.DataFrame, spot: float) -> pd.DataFrame:
        """
        Calculates dynamic intraday Volume GEX using Lee-Ready trade aggressor classification.
        Matches commercial platform standards (Unusual Whales / SpotGamma).
        """
        if chain_df.empty:
            return chain_df.copy()

        result_df = chain_df.copy()
        multiplier = 100.0
        gex_factor = multiplier * (spot ** 2) * 0.01

        vol = chain_df['volume'].fillna(0)
        gamma = chain_df['gamma'].fillna(0.0)

        # Apply Lee-Ready algorithm if trade price & quote data exist
        if {'bid', 'ask', 'price'}.issubset(chain_df.columns):
            aggressor_sign = LeeReadyClassifier.classify_trades(chain_df)
        else:
            is_call = (chain_df['option_type'] == 'C').astype(float)
            is_put = (chain_df['option_type'] == 'P').astype(float)
            aggressor_sign = is_call - is_put

        result_df['volume_gex'] = aggressor_sign * vol * gamma * gex_factor
        return result_df

    def find_gamma_flip_strike(self, grouped_metrics_df: pd.DataFrame, spot: Optional[float] = None) -> float:
        """
        Finds the Gamma Flip Strike (the price where aggregate Net GEX crosses zero).
        If multiple zero-crossings exist, returns the crossing closest to the spot price.
        
        Args:
            grouped_metrics_df: DataFrame containing aggregate Net GEX grouped by strike.
                Must have columns: 'strike', 'net_gex'
            spot: Optional spot price to resolve multiple crossings.
            
        Returns:
            The zero-crossing strike price, or NaN if no crossing can be determined.
        """
        if grouped_metrics_df.empty or len(grouped_metrics_df) < 2:
            return float('nan')

        df_sorted = grouped_metrics_df.sort_values('strike')
        strikes = df_sorted['strike'].values
        gex = df_sorted['net_gex'].values

        crossings = []
        for i in range(len(gex) - 1):
            g0, g1 = gex[i], gex[i+1]
            k0, k1 = strikes[i], strikes[i+1]
            
            # Check for zero crossing (change of sign)
            if g0 * g1 < 0:
                # Linear interpolation: S* = K0 + (K1 - K0) * (0 - GEX0) / (GEX1 - GEX0)
                s_star = k0 + (k1 - k0) * (0.0 - g0) / (g1 - g0)
                crossings.append(s_star)
            elif g0 == 0:
                crossings.append(k0)

        # Check last point explicitly if zero
        if gex[-1] == 0:
            crossings.append(strikes[-1])

        if not crossings:
            # Fallback: strike with GEX closest to zero
            min_idx = np.argmin(np.abs(gex))
            return float(strikes[min_idx])

        if len(crossings) == 1:
            return float(crossings[0])

        # If multiple crossings, return the one closest to spot (if spot is provided)
        if spot is not None:
            closest_idx = np.argmin([abs(c - spot) for c in crossings])
            return float(crossings[closest_idx])
            
        # Default fallback: return the crossing closest to the midpoint of the strike range
        mid_strike = (strikes[0] + strikes[-1]) / 2.0
        closest_idx = np.argmin([abs(c - mid_strike) for c in crossings])
        return float(crossings[closest_idx])

    def find_walls(self, grouped_metrics_df: pd.DataFrame) -> Tuple[float, float]:
        """
        Extracts Call Wall and Put Wall levels from the aggregated GEX strike profile.
        
        Args:
            grouped_metrics_df: DataFrame containing aggregate Net GEX grouped by strike.
                Must have columns: 'strike', 'net_gex'
                
        Returns:
            Tuple: (call_wall_strike, put_wall_strike)
        """
        if grouped_metrics_df.empty:
            return float('nan'), float('nan')

        # Call Wall: strike with maximum positive Net GEX
        max_gex_idx = grouped_metrics_df['net_gex'].idxmax()
        call_wall = grouped_metrics_df.loc[max_gex_idx, 'strike']

        # Put Wall: strike with maximum negative Net GEX (the minimum value)
        min_gex_idx = grouped_metrics_df['net_gex'].idxmin()
        put_wall = grouped_metrics_df.loc[min_gex_idx, 'strike']

        return float(call_wall), float(put_wall)
