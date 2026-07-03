import unittest
import numpy as np
import pandas as pd
from datetime import date, datetime
from app.services.analytics import BlackScholesCalculator, DealerExposureEngine

class TestBlackScholesCalculator(unittest.TestCase):
    def setUp(self):
        self.calculator = BlackScholesCalculator()
        self.ref_date = pd.Timestamp("2026-07-01 12:00:00")

    def test_compute_greeks_calls_and_puts(self):
        # Setup a basic option chain
        data = {
            "strike": [100.0, 100.0],
            "expiration": [date(2026, 7, 31), date(2026, 7, 31)],  # 30 days out
            "implied_volatility": [0.20, 0.20],
            "option_type": ["C", "P"]
        }
        df = pd.DataFrame(data)
        
        spot = 100.0
        r = 0.05
        q = 0.00
        
        res = self.calculator.compute_greeks(df, spot, r, q, self.ref_date)
        
        # Test basic shape and columns
        self.assertEqual(len(res), 2)
        self.assertIn("delta", res.columns)
        self.assertIn("gamma", res.columns)
        self.assertIn("vanna", res.columns)
        self.assertIn("charm", res.columns)
        
        # Call Delta should be positive, Put Delta negative
        self.assertGreater(res.loc[0, "delta"], 0)
        self.assertLess(res.loc[1, "delta"], 0)
        
        # Gamma should be positive and equal for call and put
        self.assertGreater(res.loc[0, "gamma"], 0)
        self.assertAlmostEqual(res.loc[0, "gamma"], res.loc[1, "gamma"], places=6)
        
        # Vanna should be defined
        self.assertFalse(np.isnan(res.loc[0, "vanna"]))
        
        # Charm should be defined
        self.assertFalse(np.isnan(res.loc[0, "charm"]))

    def test_compute_greeks_edge_cases(self):
        # Expiration today (t = 0) and missing IV
        data = {
            "strike": [100.0, 100.0],
            "expiration": [date(2026, 7, 1), date(2026, 7, 1)],
            "implied_volatility": [None, 0.0],  # test missing and zero IV
            "option_type": ["C", "P"]
        }
        df = pd.DataFrame(data)
        
        spot = 100.0
        r = 0.05
        q = 0.00
        
        res = self.calculator.compute_greeks(df, spot, r, q, self.ref_date)
        
        # No NaNs or Infinite values should be produced
        self.assertFalse(res["delta"].isnull().any())
        self.assertFalse(res["gamma"].isnull().any())
        self.assertFalse(res["vanna"].isnull().any())
        self.assertFalse(res["charm"].isnull().any())
        
        self.assertFalse(np.isinf(res["delta"]).any())
        self.assertFalse(np.isinf(res["gamma"]).any())
        self.assertFalse(np.isinf(res["vanna"]).any())
        self.assertFalse(np.isinf(res["charm"]).any())


class TestDealerExposureEngine(unittest.TestCase):
    def setUp(self):
        self.engine = DealerExposureEngine()

    def test_calculate_exposures(self):
        data = {
            "option_type": ["C", "P"],
            "open_interest": [1000, 500],
            "delta": [0.55, -0.45],
            "gamma": [0.03, 0.03],
            "vanna": [0.12, 0.12],
            "charm": [-0.01, -0.01]
        }
        df = pd.DataFrame(data)
        spot = 100.0
        
        res = self.engine.calculate_exposures(df, spot)
        
        # Test columns are added
        self.assertIn("net_gex", res.columns)
        self.assertIn("net_dex", res.columns)
        self.assertIn("net_vanna", res.columns)
        self.assertIn("net_charm", res.columns)
        
        # Check call calculations
        # GEX_Call = OI * Gamma * 100 * S^2 * 0.01 = 1000 * 0.03 * 100 * 10000 * 0.01 = 300,000
        self.assertAlmostEqual(res.loc[0, "net_gex"], 300000.0)
        
        # Check put calculations (Puts should be negative for GEX under typical retail long indexing assumptions)
        # GEX_Put = -OI * Gamma * 100 * S^2 * 0.01 = -500 * 0.03 * 100 * 10000 * 0.01 = -150,000
        self.assertAlmostEqual(res.loc[1, "net_gex"], -150000.0)
        
        # Check Net DEX sign
        # DEX_Call = OI * Delta * 100 * S = 1000 * 0.55 * 100 * 100 = 5,500,000 (positive)
        # DEX_Put = -OI * Delta * 100 * S = -500 * (-0.45) * 100 * 100 = 2,250,000 (positive because Delta is negative)
        self.assertGreater(res.loc[0, "net_dex"], 0)
        self.assertGreater(res.loc[1, "net_dex"], 0)

    def test_find_gamma_flip_strike_linear_interpolation(self):
        grouped_data = {
            "strike": [90.0, 95.0, 100.0, 105.0, 110.0],
            "net_gex": [-1000.0, -500.0, -100.0, 400.0, 900.0]
        }
        df = pd.DataFrame(grouped_data)
        
        # Zero crossing between 100 (GEX = -100) and 105 (GEX = 400)
        # s_star = 100 + (105 - 100) * (0 - (-100)) / (400 - (-100))
        # s_star = 100 + 5 * 100 / 500 = 101.0
        flip = self.engine.find_gamma_flip_strike(df)
        self.assertAlmostEqual(flip, 101.0)

    def test_find_gamma_flip_strike_multiple_crossings(self):
        grouped_data = {
            "strike": [90.0, 95.0, 100.0, 105.0, 110.0],
            "net_gex": [100.0, -100.0, 200.0, -200.0, 300.0]
        }
        df = pd.DataFrame(grouped_data)
        
        # Multiple crossings:
        # 1. between 90 and 95 (GEX: 100 to -100) -> 92.5
        # 2. between 95 and 100 (GEX: -100 to 200) -> 96.67
        # 3. between 100 and 105 (GEX: 200 to -200) -> 102.5
        # 4. between 105 and 110 (GEX: -200 to 300) -> 107.0
        
        # With spot = 101.0, closest crossing should be 102.5
        flip = self.engine.find_gamma_flip_strike(df, spot=101.0)
        self.assertAlmostEqual(flip, 102.5)

    def test_find_walls(self):
        grouped_data = {
            "strike": [90.0, 95.0, 100.0, 105.0, 110.0],
            "net_gex": [100.0, -1500.0, 200.0, 3000.0, 300.0]
        }
        df = pd.DataFrame(grouped_data)
        
        call_wall, put_wall = self.engine.find_walls(df)
        
        # Call Wall: max GEX -> strike 105.0 (GEX = 3000.0)
        self.assertEqual(call_wall, 105.0)
        # Put Wall: min GEX -> strike 95.0 (GEX = -1500.0)
        self.assertEqual(put_wall, 95.0)
