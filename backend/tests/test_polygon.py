import unittest
from unittest.mock import patch, MagicMock
from datetime import date
import os
import requests

from app.services.data_providers.polygon import (
    PolygonDataProvider,
    PolygonAPIError,
    PolygonRateLimitError,
)
from app.services.data_providers.base import (
    DomainUnderlyingQuote,
    DomainOptionQuote,
)

class TestPolygonDataProvider(unittest.TestCase):

    def setUp(self):
        self.api_key = "test_api_key_123"
        # Set environment variable temporarily
        os.environ["POLYGON_API_KEY"] = self.api_key

    def tearDown(self):
        if "POLYGON_API_KEY" in os.environ:
            del os.environ["POLYGON_API_KEY"]

    def test_init_with_explicit_key(self):
        # Remove env key to ensure it uses the explicit one
        if "POLYGON_API_KEY" in os.environ:
            del os.environ["POLYGON_API_KEY"]
            
        provider = PolygonDataProvider(api_key="explicit_key")
        self.assertEqual(provider.api_key, "explicit_key")

    def test_init_with_env_key(self):
        provider = PolygonDataProvider()
        self.assertEqual(provider.api_key, self.api_key)

    def test_init_raises_value_error_if_no_key(self):
        if "POLYGON_API_KEY" in os.environ:
            del os.environ["POLYGON_API_KEY"]
        with self.assertRaises(ValueError):
            PolygonDataProvider()

    @patch("app.services.data_providers.polygon.requests.get")
    def test_get_underlying_quote_results_payload_nanoseconds(self, mock_get):
        # Mock response from Polygon API with results structure and nanosecond timestamp
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "status": "OK",
            "results": {
                "p": 450.75,
                "t": 1625097600000000000  # nanoseconds
            }
        }
        mock_get.return_value = mock_response

        provider = PolygonDataProvider()
        quote = provider.get_underlying_quote("SPY")

        self.assertIsInstance(quote, DomainUnderlyingQuote)
        self.assertEqual(quote.ticker, "SPY")
        self.assertEqual(quote.price, 450.75)
        self.assertEqual(quote.timestamp_utc, 1625097600)  # Converted to seconds

    @patch("app.services.data_providers.polygon.requests.get")
    def test_get_underlying_quote_last_payload_milliseconds(self, mock_get):
        # Mock response from Polygon API with last structure and millisecond timestamp
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "status": "OK",
            "last": {
                "p": 150.25,
                "t": 1625097600000  # milliseconds
            }
        }
        mock_get.return_value = mock_response

        provider = PolygonDataProvider()
        quote = provider.get_underlying_quote("AAPL")

        self.assertIsInstance(quote, DomainUnderlyingQuote)
        self.assertEqual(quote.ticker, "AAPL")
        self.assertEqual(quote.price, 150.25)
        self.assertEqual(quote.timestamp_utc, 1625097600)

    @patch("app.services.data_providers.polygon.requests.get")
    def test_get_underlying_quote_missing_data(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "status": "OK",
            "results": {}  # Missing 'p' and 't'
        }
        mock_get.return_value = mock_response

        provider = PolygonDataProvider()
        with self.assertRaises(PolygonAPIError):
            provider.get_underlying_quote("SPY")

    @patch("app.services.data_providers.polygon.requests.get")
    def test_get_option_chain_mapping(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "status": "OK",
            "results": [
                {
                    "details": {
                        "ticker": "O:SPY260627C00600000",
                        "contract_type": "call",
                        "expiration_date": "2026-06-27",
                        "strike_price": 600.0
                    },
                    "greeks": {
                        "delta": 0.55,
                        "gamma": 0.02,
                        "vanna": 0.12,
                        "charm": -0.05
                    },
                    "last_quote": {
                        "bid": 5.50,
                        "ask": 5.75
                    },
                    "day": {
                        "volume": 120
                    },
                    "open_interest": 4500,
                    "implied_volatility": 0.185
                },
                {
                    "details": {
                        "ticker": "SPY260627P00600000",  # No O: prefix
                        "contract_type": "put",
                        "expiration_date": "2026-06-27",
                        "strike_price": 600.0
                    },
                    # Greeks missing
                    "last_quote": {
                        "bid": 4.10,
                        "ask": 4.25
                    },
                    "day": {
                        "volume": 200
                    },
                    "open_interest": 3000,
                    "implied_volatility": 0.190
                }
            ],
            "next_url": None
        }
        mock_get.return_value = mock_response

        provider = PolygonDataProvider()
        chain = provider.get_option_chain("SPY")

        self.assertEqual(len(chain), 2)
        
        # Verify first contract
        c1 = chain[0]
        self.assertEqual(c1.contract_symbol, "SPY260627C00600000")  # Prefixed stripped
        self.assertEqual(c1.strike, 600.0)
        self.assertEqual(c1.expiration, date(2026, 6, 27))
        self.assertEqual(c1.option_type, "C")
        self.assertEqual(c1.open_interest, 4500)
        self.assertEqual(c1.volume, 120)
        self.assertEqual(c1.bid, 5.50)
        self.assertEqual(c1.ask, 5.75)
        self.assertEqual(c1.implied_volatility, 0.185)
        self.assertEqual(c1.delta, 0.55)
        self.assertEqual(c1.gamma, 0.02)
        self.assertEqual(c1.vanna, 0.12)
        self.assertEqual(c1.charm, -0.05)

        # Verify second contract (missing greeks)
        c2 = chain[1]
        self.assertEqual(c2.contract_symbol, "SPY260627P00600000")
        self.assertEqual(c2.option_type, "P")
        self.assertIsNone(c2.delta)
        self.assertIsNone(c2.gamma)
        self.assertIsNone(c2.vanna)
        self.assertIsNone(c2.charm)

    @patch("app.services.data_providers.polygon.requests.get")
    def test_get_option_chain_pagination(self, mock_get):
        # Mock pagination by returning a next_url on the first call and None on the second
        mock_response_1 = MagicMock()
        mock_response_1.status_code = 200
        mock_response_1.json.return_value = {
            "status": "OK",
            "results": [
                {
                    "details": {
                        "ticker": "O:SPY260627C00600000",
                        "contract_type": "call",
                        "expiration_date": "2026-06-27",
                        "strike_price": 600.0
                    }
                }
            ],
            "next_url": "https://api.polygon.io/v3/snapshot/options/SPY?cursor=abc123next"
        }

        mock_response_2 = MagicMock()
        mock_response_2.status_code = 200
        mock_response_2.json.return_value = {
            "status": "OK",
            "results": [
                {
                    "details": {
                        "ticker": "O:SPY260627P00600000",
                        "contract_type": "put",
                        "expiration_date": "2026-06-27",
                        "strike_price": 600.0
                    }
                }
            ],
            "next_url": None
        }

        # Set side effect to return first response, then second
        mock_get.side_effect = [mock_response_1, mock_response_2]

        provider = PolygonDataProvider()
        chain = provider.get_option_chain("SPY")

        self.assertEqual(len(chain), 2)
        self.assertEqual(chain[0].contract_symbol, "SPY260627C00600000")
        self.assertEqual(chain[1].contract_symbol, "SPY260627P00600000")
        
        # Verify that get was called twice with correct URLs
        self.assertEqual(mock_get.call_count, 2)
        mock_get.assert_any_call("https://api.polygon.io/v3/snapshot/options/SPY", params={"apiKey": self.api_key}, headers={"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}, timeout=10)
        mock_get.assert_any_call("https://api.polygon.io/v3/snapshot/options/SPY?cursor=abc123next", params={"apiKey": self.api_key}, headers={"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}, timeout=10)

    @patch("app.services.data_providers.polygon.time.sleep")
    @patch("app.services.data_providers.polygon.requests.get")
    def test_rate_limit_handling_success_on_retry(self, mock_get, mock_sleep):
        # 1st call: 429 Too Many Requests
        # 2nd call: 200 OK
        response_429 = MagicMock()
        response_429.status_code = 429
        
        response_200 = MagicMock()
        response_200.status_code = 200
        response_200.json.return_value = {
            "status": "OK",
            "results": {
                "p": 450.75,
                "t": 1625097600
            }
        }
        
        mock_get.side_effect = [response_429, response_200]
        
        provider = PolygonDataProvider(max_retries=3, backoff_factor=0.1)
        quote = provider.get_underlying_quote("SPY")
        
        self.assertEqual(quote.price, 450.75)
        self.assertEqual(mock_get.call_count, 2)
        mock_sleep.assert_called_once_with(0.1)

    @patch("app.services.data_providers.polygon.time.sleep")
    @patch("app.services.data_providers.polygon.requests.get")
    def test_rate_limit_handling_exhausted_retries(self, mock_get, mock_sleep):
        # Return 429 on all attempts
        response_429 = MagicMock()
        response_429.status_code = 429
        
        mock_get.return_value = response_429
        
        provider = PolygonDataProvider(max_retries=2, backoff_factor=0.1)
        
        with self.assertRaises(PolygonRateLimitError):
            provider.get_underlying_quote("SPY")
            
        self.assertEqual(mock_get.call_count, 3) # initial + 2 retries
        self.assertEqual(mock_sleep.call_count, 2)

    @patch("app.services.data_providers.polygon.requests.get")
    def test_http_error_handling(self, mock_get):
        # Mock 403 Forbidden which should fail immediately without retries
        response_403 = MagicMock()
        response_403.status_code = 403
        response_403.raise_for_status.side_effect = requests.HTTPError(response=response_403)
        mock_get.return_value = response_403
        
        provider = PolygonDataProvider(max_retries=3)
        
        with self.assertRaises(PolygonAPIError):
            provider.get_underlying_quote("SPY")
            
        # Should not retry for 403
        self.assertEqual(mock_get.call_count, 1)

    @patch("app.services.data_providers.polygon.time.sleep")
    @patch("app.services.data_providers.polygon.requests.get")
    def test_server_error_retry(self, mock_get, mock_sleep):
        # 1st call: 503 Service Unavailable
        # 2nd call: 200 OK
        response_503 = MagicMock()
        response_503.status_code = 503
        response_503.raise_for_status.side_effect = requests.HTTPError(response=response_503)
        
        response_200 = MagicMock()
        response_200.status_code = 200
        response_200.json.return_value = {
            "status": "OK",
            "results": {
                "p": 450.75,
                "t": 1625097600
            }
        }
        
        mock_get.side_effect = [response_503, response_200]
        
        provider = PolygonDataProvider(max_retries=3, backoff_factor=0.1)
        quote = provider.get_underlying_quote("SPY")
        
        self.assertEqual(quote.price, 450.75)
        self.assertEqual(mock_get.call_count, 2)
        mock_sleep.assert_called_once_with(0.1)

if __name__ == "__main__":
    unittest.main()
