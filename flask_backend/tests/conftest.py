"""
Shared test fixtures and helpers.
Must run before any test file imports — env vars are set at module level.
"""

import json
import os
import sys

# Add flask_backend/ to sys.path so tests can import services, routes, etc.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Required env vars — must be set before any app module is imported
_TEST_JWT_SECRET = "test-jwt-secret-for-pytest-exactly-32ch!"
os.environ.setdefault("JWT_SECRET", _TEST_JWT_SECRET)
os.environ.setdefault(
    "GCP_SA_KEY",
    json.dumps({"type": "service_account", "project_id": "test"}),
)
os.environ.setdefault("SPREADSHEET_ID", "fake-spreadsheet-id")
os.environ.setdefault("TEST_SPREADSHEET_ID", "fake-test-spreadsheet-id")
os.environ.setdefault("HR_SPREADSHEET_ID", "fake-hr-spreadsheet-id")

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest


def make_jwt(
    name: str,
    role: str,
    line_uid: str = "U_test",
    is_test: bool = True,
    responsibilities: list | None = None,
) -> str:
    """Build a signed JWT for use in test request headers."""
    import jwt as pyjwt

    payload = {
        "lineUid": line_uid,
        "name": name,
        "role": role,
        "isTest": is_test,
        "responsibilities": responsibilities or [],
        "exp": datetime.now(tz=timezone.utc) + timedelta(hours=1),
    }
    return pyjwt.encode(payload, _TEST_JWT_SECRET, algorithm="HS256")


@pytest.fixture(scope="session")
def app():
    """Create the Flask test application once per test session."""
    from services.sheets_service import SheetsService

    with patch.object(SheetsService, "validate_sheet_headers", return_value=None):
        from app import create_app

        flask_app = create_app()

    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture
def client(app):
    return app.test_client()
