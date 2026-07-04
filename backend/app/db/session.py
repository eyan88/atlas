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

    def setup_timescaledb(engine):
        """If using postgresql, enable TimescaleDB and convert tables to hypertables."""
        from sqlalchemy import text
        if engine.dialect.name == "postgresql":
            # 1. Ensure the tables are created first so we don't throw relation-not-found errors
            try:
                from app.db.base import Base
                Base.metadata.create_all(bind=engine)
                print("Database schemas created/verified successfully.")
            except Exception as e:
                print(f"Warning: Could not create tables before TimescaleDB setup: {e}")

            # 2. Enable TimescaleDB extension
            with engine.begin() as conn:
                try:
                    conn.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;"))
                except Exception as e:
                    print(f"Warning: Could not create timescaledb extension: {e}")
                
            # 3. Create hypertables inside separate transactions to avoid transaction abort poisoning
            for table in ['underlying_price_snapshots', 'option_chain_snapshots', 'dealer_metrics_snapshots']:
                with engine.begin() as conn:
                    try:
                        res = conn.execute(text(f"""
                            SELECT 1 FROM _timescaledb_catalog.hypertable 
                            WHERE table_name = '{table}';
                        """)).fetchone()
                        if not res:
                            conn.execute(text(f"SELECT create_hypertable('{table}', 'timestamp', chunk_time_interval => INTERVAL '1 day');"))
                            print(f"Successfully created TimescaleDB hypertable for {table}")
                    except Exception as e:
                        print(f"Notice: Skip hypertable check/creation for {table}: {e}")

    setup_timescaledb(engine)

# Session generator class
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """Dependency to retrieve database session in FastAPI requests."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
