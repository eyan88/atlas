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

def bs_price(iv, S, K, T, r, q, cp):
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
        return bs_price(sigma, S, K, T, r, q, cp) - P

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

res = compute_all_greeks(400.0, 400.0, 0.05, 0.0, 0.25, 20.0, 'C')
print(f"IV: {res.iv}, Delta: {res.delta}, Gamma: {res.gamma}, Vanna: {res.vanna}, Charm: {res.charm}")
