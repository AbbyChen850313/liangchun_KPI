"""KPI plugin entry point.

KpiPlugin wires together the KpiAccountStore (AccountStorePort) and
exposes a consistent plugin surface parallel to CoursePlugin and CrmPlugin.

The KPI system handles LINE binding through LIFF (not a webhook chat flow),
so this plugin is intentionally minimal — binding is driven by the LIFF
frontend calling /api/auth/bind, not by chat events.

Usage (e.g. in a webhook route if added in future):
    from plugins.kpi.plugin import KpiPlugin
    _plugin = KpiPlugin()
    _plugin.on_follow(event, is_test, channel_id)
"""

from __future__ import annotations

import logging

from plugins.kpi.identity import KpiAccountStore

logger = logging.getLogger(__name__)


class KpiPlugin:
    """Stub plugin entry point for the KPI LINE OA.

    Binding is LIFF-driven (auth routes + KpiAccountStore), not chat-driven.
    Webhook event handlers are stubs that log and no-op, ready to be
    extended if the KPI OA ever adds chat interactions.
    """

    def __init__(self) -> None:
        self._store = KpiAccountStore()

    # ── AccountStorePort accessor ────────────────────────────────────────────

    @property
    def store(self) -> KpiAccountStore:
        """Expose the account store for callers that need direct access."""
        return self._store

    # ── Webhook event stubs ──────────────────────────────────────────────────

    def on_follow(self, event, is_test: bool, channel_id: str | None) -> None:
        """Handle FollowEvent — log only; binding is LIFF-driven."""
        line_uid = event.source.user_id
        logger.info(
            "KpiPlugin.on_follow: lineUid=%s is_test=%s channel_id=%s",
            line_uid, is_test, channel_id,
        )

    def on_unfollow(self, event, is_test: bool) -> None:
        """Handle UnfollowEvent — log only."""
        line_uid = event.source.user_id
        logger.info(
            "KpiPlugin.on_unfollow: lineUid=%s is_test=%s",
            line_uid, is_test,
        )

    def on_text_message(self, event, is_test: bool, channel_id: str | None) -> None:
        """Handle MessageEvent — log only; no chat flow defined for KPI OA."""
        line_uid = event.source.user_id
        text = getattr(getattr(event, 'message', None), 'text', '') or ''
        logger.debug(
            "KpiPlugin.on_text_message: lineUid=%s text=%r is_test=%s",
            line_uid, text, is_test,
        )
