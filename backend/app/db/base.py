# Import all models so that Base has them registered before Alembic imports it.
# This prevents errors during auto-generation of database migrations.

from app.db.base_class import Base  # noqa: F401
from app.models.contract import OptionContract  # noqa: F401
from app.models.underlying import UnderlyingPriceSnapshot  # noqa: F401
from app.models.snapshot import OptionChainSnapshot  # noqa: F401
from app.models.metric import DealerMetricSnapshot  # noqa: F401
