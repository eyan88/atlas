from abc import ABC, abstractmethod
from datetime import date
from typing import List, Optional
from pydantic import BaseModel, Field

class DomainUnderlyingQuote(BaseModel):
    ticker: str = Field(..., description="Underlying ticker symbol (e.g., SPY, QQQ)")
    price: float = Field(..., description="Latest spot price of the underlying asset")
    timestamp_utc: int = Field(..., description="Unix timestamp of the quote in UTC seconds")

class DomainOptionQuote(BaseModel):
    contract_symbol: str = Field(..., description="OCC option contract symbol (e.g., SPY260627C00600000)")
    strike: float = Field(..., description="Strike price of the option contract")
    expiration: date = Field(..., description="Expiration date of the option contract")
    option_type: str = Field(..., description="Option type: 'C' for Call, 'P' for Put")
    open_interest: int = Field(..., description="Open Interest of the contract")
    volume: int = Field(..., description="Today's volume of the contract")
    bid: float = Field(..., description="Current bid price of the contract")
    ask: float = Field(..., description="Current ask price of the contract")
    implied_volatility: Optional[float] = Field(None, description="Implied Volatility (IV) of the option contract")
    delta: Optional[float] = Field(None, description="Black-Scholes Delta Greek of the option contract")
    gamma: Optional[float] = Field(None, description="Black-Scholes Gamma Greek of the option contract")
    vanna: Optional[float] = Field(None, description="Black-Scholes Vanna Greek of the option contract")
    charm: Optional[float] = Field(None, description="Black-Scholes Charm Greek of the option contract")

class BaseDataProvider(ABC):
    
    @abstractmethod
    def get_underlying_quote(self, ticker: str) -> DomainUnderlyingQuote:
        """
        Fetches the latest spot price snapshot of the underlying index/ETF.
        
        Args:
            ticker: The underlying ticker symbol (e.g., 'SPY').
            
        Returns:
            DomainUnderlyingQuote: Domain-specific schema containing the price and timestamp.
        """
        pass

    @abstractmethod
    def get_option_chain(self, ticker: str) -> List[DomainOptionQuote]:
        """
        Fetches the complete active option chain snapshot for the ticker.
        
        Args:
            ticker: The underlying ticker symbol (e.g., 'SPY').
            
        Returns:
            List[DomainOptionQuote]: List of all active option contracts and their current quotes.
        """
        pass
