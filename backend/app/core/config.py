import os
from pathlib import Path
from typing import List
from pydantic import BaseModel, field_validator

# Locate backend base directory (backend/)
BASE_DIR = Path(__file__).resolve().parent.parent.parent

def load_dotenv(dotenv_path: Path) -> None:
    """Loads environment variables from a .env file if it exists."""
    if not dotenv_path.exists():
        return
    with open(dotenv_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip("'\"")
                # Set in os.environ if not already defined (gives priority to system env)
                if key not in os.environ:
                    os.environ[key] = val

# Load from both the project root and backend folder for developer convenience
load_dotenv(BASE_DIR.parent / ".env")
load_dotenv(BASE_DIR / ".env")

class Settings(BaseModel):
    PROJECT_NAME: str = os.getenv("PROJECT_NAME", "Atlas Options Positioning Analytics")
    ENV: str = os.getenv("ENV", "development")  # development, testing, production
    API_V1_STR: str = "/api/v1"
    
    # Database Configuration
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "postgresql://postgres:secretpassword@localhost:5432/atlas"
    )
    
    # Redis Configuration
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    
    # Polygon Data Ingestion Configuration
    POLYGON_API_KEY: str = os.getenv("POLYGON_API_KEY", "")
    POLYGON_MAX_RETRIES: int = int(os.getenv("POLYGON_MAX_RETRIES", "3"))
    POLYGON_BACKOFF_FACTOR: float = float(os.getenv("POLYGON_BACKOFF_FACTOR", "0.5"))
    
    # Scheduling Parameters
    INGEST_INTERVAL_MINUTES: int = int(os.getenv("INGEST_INTERVAL_MINUTES", "1"))
    
    # List of active tickers to track
    SUPPORTED_TICKERS: List[str] = ["SPY", "QQQ", "IWM"]

    @field_validator("SUPPORTED_TICKERS", mode="before")
    @classmethod
    def parse_tickers(cls, v):
        """Parses comma-separated string lists from env variables into a Python list."""
        if isinstance(v, str):
            return [t.strip().upper() for t in v.split(",") if t.strip()]
        return v

    class Config:
        frozen = True

settings = Settings()
