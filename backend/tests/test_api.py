import unittest
from unittest.mock import MagicMock, patch
from datetime import datetime, date, timezone
from fastapi.testclient import TestClient
from app.main import app
from app.api.deps import get_db
from app.models.metric import DealerMetricSnapshot
from app.models.underlying import UnderlyingPriceSnapshot

# Create a mock database session
mock_db = MagicMock()

def override_get_db():
    try:
        yield mock_db
    finally:
        pass

# Apply dependency override
app.dependency_overrides[get_db] = override_get_db

class TestAPI(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        mock_db.reset_mock()

    def test_health(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"status": "ok"})

    def test_get_tickers(self):
        # Mock query return for min/max dates
        # Each query will return a tuple of (min_timestamp, max_timestamp)
        # We need mock_db.query().filter().first() to return mock datetime bounds
        mock_db.query.return_value.filter.return_value.first.return_value = (
            datetime(2026, 7, 1, 9, 30, 0),
            datetime(2026, 7, 2, 16, 0, 0)
        )

        res = self.client.get("/api/v1/tickers")
        self.assertEqual(res.status_code, 200)
        
        data = res.json()
        self.assertIn("tickers", data)
        self.assertGreater(len(data["tickers"]), 0)
        
        # Verify first ticker data structure
        first_ticker = data["tickers"][0]
        self.assertEqual(first_ticker["min_date"], "2026-07-01")
        self.assertEqual(first_ticker["max_date"], "2026-07-02")
        self.assertIn("symbol", first_ticker)
        self.assertIn("name", first_ticker)

    def test_get_replay_timeline(self):
        # Mock timeline timestamps
        # query().filter().distinct().order_by().all() -> list of tuples of datetime
        mock_timestamps = [
            (datetime(2026, 7, 1, 9, 30),),
            (datetime(2026, 7, 1, 9, 31),),
            (datetime(2026, 7, 1, 9, 32),)
        ]
        mock_db.query.return_value.filter.return_value.distinct.return_value.order_by.return_value.all.return_value = mock_timestamps

        res = self.client.get("/api/v1/replay/timeline/SPY?date=2026-07-01")
        self.assertEqual(res.status_code, 200)
        
        data = res.json()
        self.assertEqual(data["ticker"], "SPY")
        self.assertEqual(data["date"], "2026-07-01")
        self.assertEqual(len(data["timestamps"]), 3)
        self.assertEqual(data["timestamps"][0], int(datetime(2026, 7, 1, 9, 30, tzinfo=timezone.utc).timestamp()))

    def test_get_heatmap_not_found(self):
        # Mock database empty case
        mock_db.query.return_value.filter.return_value.scalar.return_value = None
        
        res = self.client.get("/api/v1/heatmap/INVALID")
        self.assertEqual(res.status_code, 404)

    def test_get_heatmap_success(self):
        # Setup mock database query chain results:
        target_ts = datetime(2026, 7, 1, 10, 0, 0)
        
        # 1. Mock max timestamp scalar
        # query(func.max).filter().scalar() -> target_ts
        mock_db.query.return_value.filter.return_value.scalar.return_value = target_ts
        
        # 2. Mock dealer metric snapshot records
        # query(DealerMetricSnapshot).filter().all() -> records
        # Let's create two mock records: strike 100 and strike 105
        rec1 = MagicMock()
        rec1.strike = 100.0
        rec1.expiration = date(2026, 7, 31)
        rec1.net_gex = 5e9
        rec1.net_dex = 1e7
        rec1.net_vanna = 50.0
        rec1.net_charm = 1.2
        rec1.call_oi = 1000
        rec1.put_oi = 500
        rec1.call_volume = 100
        rec1.put_volume = 50
        rec1.call_iv = 0.22
        rec1.put_iv = 0.24

        rec2 = MagicMock()
        rec2.strike = 105.0
        rec2.expiration = date(2026, 7, 31)
        rec2.net_gex = -2e9
        rec2.net_dex = -5e6
        rec2.net_vanna = -20.0
        rec2.net_charm = -0.5
        rec2.call_oi = 800
        rec2.put_oi = 1200
        rec2.call_volume = 80
        rec2.put_volume = 120
        rec2.call_iv = 0.21
        rec2.put_iv = 0.23

        # We will mock the query chain specifically for the DealerMetricSnapshot filter
        # Since get_heatmap runs several queries, we can side_effect query or mock the model filters
        # For simplicity, let's patch the db queries inside get_heatmap or structure the query return chain
        def mock_query_router(*args, **kwargs):
            q_mock = MagicMock()
            
            # Identify what is being queried by args[0]
            if len(args) > 0:
                target_model = args[0]
                # If it's a function like func.max(DealerMetricSnapshot.timestamp)
                if hasattr(target_model, '_as_impl') or 'max' in str(target_model):
                    q_mock.filter.return_value.scalar.return_value = target_ts
                elif target_model == DealerMetricSnapshot:
                    q_mock.filter.return_value.all.return_value = [rec1, rec2]
                elif target_model == UnderlyingPriceSnapshot:
                    # Mock spot price record query
                    spot_rec = MagicMock()
                    spot_rec.price = 100.5
                    q_mock.filter.return_value.order_by.return_value.first.return_value = spot_rec
                    
            return q_mock

        with patch.object(mock_db, 'query', side_effect=mock_query_router):
            res = self.client.get("/api/v1/heatmap/SPY?metric=net_gex")
            self.assertEqual(res.status_code, 200)
            
            data = res.json()
            self.assertEqual(data["ticker"], "SPY")
            self.assertEqual(data["spot_price"], 100.5)
            self.assertEqual(data["columns"], ["2026-07-31"])
            self.assertEqual(data["rows"], [105.0, 100.0]) # descending order
            
            # Verify data matrix has shape 2 rows x 1 columns
            self.assertEqual(len(data["data"]), 2)
            self.assertEqual(len(data["data"][0]), 1)
            
            # Row index 0 is strike 105.0 -> GEX should be -2e9
            self.assertEqual(data["data"][0][0], -2e9)
            # Row index 1 is strike 100.0 -> GEX should be 5e9
            self.assertEqual(data["data"][1][0], 5e9)
            
            # Check dynamic walls
            # Call Wall: max GEX -> strike 100 (5e9 vs -2e9)
            self.assertEqual(data["call_wall"], 100.0)
            # Put Wall: min GEX -> strike 105 (-2e9 vs 5e9)
            self.assertEqual(data["put_wall"], 105.0)
            # Gamma Flip: crossing between 100 (5e9) and 105 (-2e9)
            # s_star = 100 + (105 - 100) * (0 - 5e9) / (-2e9 - 5e9) = 100 + 5 * 5/7 = 103.5714...
            self.assertAlmostEqual(data["gamma_flip"], 103.5714, places=3)
