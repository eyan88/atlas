from app.db.session import get_db as db_session_generator

# Re-export get_db
get_db = db_session_generator
