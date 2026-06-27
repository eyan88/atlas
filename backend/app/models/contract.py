from datetime import datetime
from sqlalchemy import Column, String, Numeric, Date, DateTime
from app.db.base_class import Base

class OptionContract(Base):
    __tablename__ = "option_contracts"

    id = Column(String(50), primary_key=True, index=True)  # OCC contract symbol
    ticker = Column(String(10), nullable=False, index=True)
    strike = Column(Numeric(10, 2), nullable=False)
    expiration = Column(Date, nullable=False)
    option_type = Column(String(1), nullable=False)  # 'C' or 'P'
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
