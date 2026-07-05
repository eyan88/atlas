from sqlalchemy import Column, String, Numeric, Integer, DateTime, BigInteger, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base_class import Base

class OptionChainSnapshot(Base):
    __tablename__ = "option_chain_snapshots"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime(timezone=True), primary_key=True, nullable=False)
    contract_id = Column(String(50), ForeignKey("option_contracts.id"), nullable=False)
    bid = Column(Numeric(10, 2))
    ask = Column(Numeric(10, 2))
    open_interest = Column(Integer, nullable=False)
    volume = Column(Integer, nullable=False)
    implied_volatility = Column(Numeric(12, 6))
    delta = Column(Numeric(8, 6))
    gamma = Column(Numeric(10, 8))
    vanna = Column(Numeric(10, 8))
    charm = Column(Numeric(10, 8))

    contract = relationship("OptionContract")
