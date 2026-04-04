"""
LINE API operations: token verification, profile fetch, push messages.
"""

from __future__ import annotations

import logging

import requests

import config

logger = logging.getLogger(__name__)

_LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify"
_LINE_PROFILE_URL = "https://api.line.me/v2/profile"
_LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"
_LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token"


def verify_access_token(access_token: str, is_test: bool = False) -> dict | None:
    """
    Verify a LIFF access token and return the user profile dict,
    or None if verification fails.

    [P0] Validates that the token's client_id matches the expected LINE Login
    channel to prevent cross-channel token reuse attacks.

    Returns: { "userId": str, "displayName": str, "pictureUrl": str }
    """
    verify_resp = requests.get(
        _LINE_VERIFY_URL,
        params={"access_token": access_token},
        timeout=10,
    )
    if verify_resp.status_code != 200:
        logger.warning("LINE token verification failed: %s", verify_resp.text)
        return None

    # [P0] Reject tokens issued by a different LINE channel
    expected_channel_id = (
        config.LINE_LOGIN_CHANNEL_ID_TEST if is_test else config.LINE_LOGIN_CHANNEL_ID
    )
    actual_client_id = verify_resp.json().get("client_id", "")
    if actual_client_id != expected_channel_id:
        logger.warning(
            "LINE token channel_id mismatch: expected=%s actual=%s",
            expected_channel_id, actual_client_id,
        )
        return None

    profile_resp = requests.get(
        _LINE_PROFILE_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    )
    if profile_resp.status_code != 200:
        logger.warning("LINE profile fetch failed: %s", profile_resp.text)
        return None

    return profile_resp.json()


def exchange_auth_code(code: str, redirect_uri: str, is_test: bool = False) -> str | None:
    """
    Exchange a LINE Login OAuth2 authorisation code for an access token.
    Returns the access token string, or None on failure.
    """
    channel_id = (
        config.LINE_LOGIN_CHANNEL_ID_TEST if is_test else config.LINE_LOGIN_CHANNEL_ID
    )
    resp = requests.post(
        _LINE_TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": channel_id,
            "client_secret": config.line_login_channel_secret(is_test),
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=10,
    )
    if resp.status_code != 200:
        logger.warning("LINE code exchange failed: %s", resp.text)
        return None
    return resp.json().get("access_token")


def push_message(line_uid: str, text: str, is_test: bool = False) -> bool:
    """Send a LINE push text message. Returns True on success."""
    token = config.line_channel_token(is_test=is_test)
    resp = requests.post(
        _LINE_PUSH_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "to": line_uid,
            "messages": [{"type": "text", "text": text}],
        },
        timeout=10,
    )
    if resp.status_code != 200:
        logger.error("LINE push failed (uid=%s): %s", line_uid, resp.text)
        return False
    return True
