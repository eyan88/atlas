from sqlalchemy import Column, String, Numeric, Integer, Date, DateTime, BigInteger
from app.db.base_class import Base

class DealerMetricSnapshot(Base):
    __tablename__ = "dealer_metrics_snapshots"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime(timezone=True), primary_key=True, nullable=False)
    ticker = Column(String(10), nullable=False, index=True)
    strike = Column(Numeric(10, 2), nullable=False)
    expiration = Column(Date, nullable=False)
    net_gex = Column(Numeric(18, 2), nullable=False)
    net_dex = Column(Numeric(18, 2), nullable=False)
    net_vanna = Column(Numeric(18, 2), nullable=False)
    net_charm = Column(Numeric(18, 2), nullable=False)
    call_oi = Column(Integer, nullable=False)
    put_oi = Column(Integer, nullable=False)
    call_volume = Column(Integer, nullable=False)
    put_volume = Column(Integer, nullable=False)
    call_iv = Column(Numeric(12, 6))
    put_iv = Column(Numeric(12, 6))
