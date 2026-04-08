"""
Shared Flask extensions — instantiated here, registered in app.py via init_app().
Keeps blueprints free of circular imports.
"""

from flask import request
from flask_limiter import Limiter

def _real_client_ip() -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"

# No default limits globally; individual routes opt-in via @limiter.limit(...)
limiter = Limiter(key_func=_real_client_ip, default_limits=[])
