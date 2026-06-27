from sqlalchemy import Column, String, Numeric, DateTime, BigInteger
from app.db.base_class import Base

class UnderlyingPriceSnapshot(Base):
    __tablename__ = "underlying_price_snapshots"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime(timezone=True), primary_key=True, nullable=False)
    ticker = Column(String(10), nullable=False, index=True)
    price = Column(Numeric(12, 4), nullable=False)
