"""
Shared Flask extensions — instantiated here, registered in app.py via init_app().
Keeps blueprints free of circular imports.
"""

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# No default limits globally; individual routes opt-in via @limiter.limit(...)
limiter = Limiter(key_func=get_remote_address, default_limits=[])
