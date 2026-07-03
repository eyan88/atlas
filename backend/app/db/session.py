from sqlalchemy import create_engine, Table, event
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

DATABASE_URL = settings.DATABASE_URL

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False}
    )
    
    # SQLite does not support autoincrement on composite primary keys.
    # We dynamically strip autoincrement before table creation if dialect is SQLite.
    @event.listens_for(Table, "before_create")
    def remove_autoincrement_for_sqlite(target, connection, **kw):
        if connection.dialect.name == "sqlite":
            pk_cols = [col for col in target.columns if col.primary_key]
            if len(pk_cols) > 1:
                for col in pk_cols:
                    if col.autoincrement:
                        col.autoincrement = False
else:
    # Initialize engine with pool options suitable for high concurrency
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_size=20,
        max_overflow=10
    )

# Session generator class
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """Dependency to retrieve database session in FastAPI requests."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
