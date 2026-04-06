"""
Central configuration — reads from environment variables (local dev)
or Google Cloud Secret Manager (production).
"""

import os
import json
import logging

logger = logging.getLogger(__name__)

_secrets_cache: dict[str, str] = {}

# Cloud Run sets K_SERVICE; absence means local development
IS_PRODUCTION: bool = os.environ.get("K_SERVICE") is not None


def _get_secret(name: str) -> str:
    """Return secret value; env var takes precedence over Secret Manager."""
    if name in _secrets_cache:
        return _secrets_cache[name]

    env_val = os.environ.get(name)
    if env_val:
        _secrets_cache[name] = env_val
        return env_val

    try:
        from google.cloud import secretmanager  # type: ignore

        project = os.environ.get("GCP_PROJECT", "linchun-hr")
        client = secretmanager.SecretManagerServiceClient()
        resource = f"projects/{project}/secrets/{name}/versions/latest"
        response = client.access_secret_version(request={"name": resource})
        val = response.payload.data.decode("UTF-8")
        _secrets_cache[name] = val
        logger.info("Loaded secret '%s' from Secret Manager.", name)
        return val
    except Exception as exc:
        raise RuntimeError(
            f"Secret '{name}' not found in env or Secret Manager: {exc}"
        ) from exc


# ── Static config (non-sensitive) ──────────────────────────────────────────

GCP_PROJECT: str = os.environ.get("GCP_PROJECT", "linchun-hr")

SPREADSHEET_ID: str = os.environ.get(
    "SPREADSHEET_ID", "1VKHfnnrv-xfdqj-36I6grY8K-YcuCd8WMIcNAvRA_eg"
)
TEST_SPREADSHEET_ID: str = os.environ.get("TEST_SPREADSHEET_ID", "")
HR_SPREADSHEET_ID: str = os.environ.get(
    "HR_SPREADSHEET_ID", "1hOBSm5BnCjsrp2rX51EN5kYVtEgLZ8FVIMF90_5BMqA"
)

LIFF_ID: str = os.environ.get("LIFF_ID", "2009611318-5UphK9JK")
LIFF_ID_TEST: str = os.environ.get("LIFF_ID_TEST", "2009619528-aJO34c6u")

# LINE Login channel IDs (derived from LIFF IDs — no secret)
LINE_LOGIN_CHANNEL_ID: str = LIFF_ID.split("-")[0]
LINE_LOGIN_CHANNEL_ID_TEST: str = LIFF_ID_TEST.split("-")[0]

# Allowed CORS origins — localhost only permitted outside production (Cloud Run)
_PRODUCTION_ORIGINS: list[str] = [
    "https://linchun-hr.web.app",
    "https://linchun-hr.firebaseapp.com",
    "https://linchun-hr-test.web.app",
    "https://linchun-hr-test.firebaseapp.com",
]
_DEVELOPMENT_ORIGINS: list[str] = [
    "http://localhost:5173",
    "http://localhost:3000",
]
ALLOWED_ORIGINS: list[str] = (
    _PRODUCTION_ORIGINS if IS_PRODUCTION else _PRODUCTION_ORIGINS + _DEVELOPMENT_ORIGINS
)

# Permitted LINE Login OAuth redirect_uri values — requests with other values are rejected (P0)
ALLOWED_REDIRECT_URIS: list[str] = [
    "https://linchun-hr.web.app/line-auth-callback",
    "https://linchun-hr.firebaseapp.com/line-auth-callback",
    "https://linchun-hr-test.web.app/line-auth-callback",
    "https://linchun-hr-test.firebaseapp.com/line-auth-callback",
    "http://localhost:5173/line-auth-callback",
    "http://localhost:3000/line-auth-callback",
]


# ── Secret accessors ────────────────────────────────────────────────────────

def line_channel_token(is_test: bool = False) -> str:
    key = "LINE_CHANNEL_TOKEN_TEST" if is_test else "LINE_CHANNEL_TOKEN"
    return _get_secret(key)


def line_channel_secret(is_test: bool = False) -> str:
    key = "LINE_CHANNEL_SECRET_TEST" if is_test else "LINE_CHANNEL_SECRET"
    return _get_secret(key)


def line_login_channel_secret(is_test: bool = False) -> str:
    """Channel secret for the LINE Login channel (used for OAuth code exchange)."""
    key = "LINE_LOGIN_CHANNEL_SECRET_TEST" if is_test else "LINE_LOGIN_CHANNEL_SECRET"
    return _get_secret(key)


def gcp_sa_info() -> dict:
    """Return parsed Service Account JSON dict."""
    raw = _get_secret("GCP_SA_KEY")
    return json.loads(raw)


def jwt_secret() -> str:
    secret = _get_secret("JWT_SECRET")
    assert len(secret) >= 32, (
        "JWT_SECRET must be at least 32 characters for HS256 security."
    )
    return secret


def gas_webhook_secret() -> str:
    """Return the GAS Webhook notification secret from Secret Manager.  # [P0-SECRET-01]
    The plain-text .notify_secret file must never be committed; always
    read this value via Secret Manager (or GAS_WEBHOOK_SECRET env var).
    """
    return _get_secret("GAS_WEBHOOK_SECRET")


def gas_web_app_url() -> str:
    """Return the GAS web app deployment URL (for trigger-reminder calls)."""
    return _get_secret("GAS_WEB_APP_URL")
