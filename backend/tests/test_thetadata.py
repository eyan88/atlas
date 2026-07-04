import os
import unittest
from unittest.mock import MagicMock, patch
from datetime import date, datetime, timezone
import pandas as pd

from app.services.data_providers.thetadata import ThetaDataProvider, ThetaDataAPIError
from app.services.data_providers.base import DomainUnderlyingQuote, DomainOptionQuote

class TestThetaDataProvider(unittest.TestCase):
    def setUp(self):
        # Set dummy env vars for constructor testing
        self.env_patcher = patch.dict(os.environ, {
            "THETADATA_EMAIL": "test@example.com",
            "THETADATA_PASSWORD": "testpassword"
        })
        self.env_patcher.start()

    def tearDown(self):
        self.env_patcher.stop()

    @patch("app.services.data_providers.thetadata.ThetaClient")
    def test_init_with_credentials(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client
        
        provider = ThetaDataProvider(email="arg@example.com", password="argpassword")
        
        self.assertEqual(provider.username, "arg@example.com")
        self.assertEqual(provider.password, "argpassword")
        mock_client_cls.assert_called_once_with(username="arg@example.com", password="argpassword", dataframe_type="pandas")
        mock_client.connect.assert_called_once()

    @patch("app.services.data_providers.thetadata.ThetaClient")
    def test_get_underlying_quote_direct(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client
        
        # Mock get_last_trade direct method
        mock_trade = MagicMock()
        mock_trade.price = 542.50
        mock_client.get_last_trade.return_value = mock_trade

        provider = ThetaDataProvider()
        quote = provider.get_underlying_quote("SPY")

        self.assertIsInstance(quote, DomainUnderlyingQuote)
        self.assertEqual(quote.ticker, "SPY")
        self.assertEqual(quote.price, 542.50)
        mock_client.get_last_trade.assert_called_once_with("SPY")

    @patch("app.services.data_providers.thetadata.ThetaClient")
    def test_get_underlying_quote_fallback(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client
        
        # Remove get_last_trade to trigger fallback
        del mock_client.get_last_trade

        # Mock stock_history_quote returning pandas DataFrame
        mock_df = pd.DataFrame({
            "close": [540.0, 541.5, 542.12],
            "timestamp": [1783001000, 1783002000, 1783003000]
        })
        mock_client.stock_history_quote.return_value = mock_df

        provider = ThetaDataProvider()
        quote = provider.get_underlying_quote("SPY")

        self.assertIsInstance(quote, DomainUnderlyingQuote)
        self.assertEqual(quote.ticker, "SPY")
        self.assertEqual(quote.price, 542.12)
        self.assertEqual(quote.timestamp_utc, 1783003000)

    @patch("app.services.data_providers.thetadata.all_greeks")
    @patch("app.services.data_providers.thetadata.ThetaClient")
    def test_get_option_chain_mapping(self, mock_client_cls, mock_all_greeks):
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        # Mock spot price lookup inside get_option_chain
        mock_trade = MagicMock()
        mock_trade.price = 542.12
        mock_client.get_last_trade.return_value = mock_trade

        # Mock expirations list
        exp_date = date(2026, 6, 27)
        mock_client.get_expirations.return_value = [exp_date]

        # Mock raw option snapshot dataframe
        mock_snapshot_df = pd.DataFrame({
            "strike": [600.0, 600.0],
            "right": ["call", "put"],
            "open_interest": [4500, 3200],
            "volume": [120, 80],
            "bid": [5.50, 4.20],
            "ask": [5.75, 4.35]
        })
        mock_client.option_snapshot.return_value = mock_snapshot_df

        # Mock local all_greeks calculation responses
        mock_greeks_call = MagicMock()
        mock_greeks_call.iv = 0.185
        mock_greeks_call.delta = 0.55
        mock_greeks_call.gamma = 0.02
        mock_greeks_call.vanna = 0.12
        mock_greeks_call.charm = -0.05

        mock_greeks_put = MagicMock()
        mock_greeks_put.iv = 0.210
        mock_greeks_put.delta = -0.42
        mock_greeks_put.gamma = 0.015
        mock_greeks_put.vanna = 0.08
        mock_greeks_put.charm = -0.03

        mock_all_greeks.side_effect = [mock_greeks_call, mock_greeks_put]

        provider = ThetaDataProvider()
        chain = provider.get_option_chain("SPY")

        self.assertEqual(len(chain), 2)
        
        # Call Contract Verification
        call_contract = chain[0]
        self.assertIsInstance(call_contract, DomainOptionQuote)
        self.assertEqual(call_contract.contract_symbol, "SPY260627C00600000")
        self.assertEqual(call_contract.strike, 600.0)
        self.assertEqual(call_contract.expiration, exp_date)
        self.assertEqual(call_contract.option_type, "C")
        self.assertEqual(call_contract.open_interest, 4500)
        self.assertEqual(call_contract.volume, 120)
        self.assertEqual(call_contract.bid, 5.50)
        self.assertEqual(call_contract.ask, 5.75)
        self.assertEqual(call_contract.implied_volatility, 0.185)
        self.assertEqual(call_contract.delta, 0.55)
        self.assertEqual(call_contract.gamma, 0.02)
        self.assertEqual(call_contract.vanna, 0.12)
        self.assertEqual(call_contract.charm, -0.05)

        # Put Contract Verification
        put_contract = chain[1]
        self.assertEqual(put_contract.contract_symbol, "SPY260627P00600000")
        self.assertEqual(put_contract.option_type, "P")
        self.assertEqual(put_contract.delta, -0.42)
        self.assertEqual(put_contract.gamma, 0.015)
        self.assertEqual(put_contract.vanna, 0.08)
        self.assertEqual(put_contract.charm, -0.03)

        self.assertEqual(mock_all_greeks.call_count, 2)
