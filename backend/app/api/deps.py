import redis
from app.core.config import settings
from app.db.session import get_db as db_session_generator

# Re-export get_db
get_db = db_session_generator

# Initialize Redis client with response decoding enabled
redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)

def get_redis() -> redis.Redis:
    """Dependency to retrieve Redis client."""
    return redis_client
