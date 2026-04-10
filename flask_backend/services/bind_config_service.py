"""
Bind field configuration service.

Reads bind field definitions from 紫精靈 console Firestore `_config/bind_fields`.
Falls back to KPI defaults if the console Firestore is unavailable or not configured.

Config document schema:
  {
    "useVerifyCode": bool,          # whether to require HR verify-code step
    "fields": [
      {
        "key": str,                 # body key (e.g. "name", "employeeId")
        "label": str,               # display label (e.g. "姓名")
        "type": str,                # "text" | "select" | "phone"
        "placeholder": str,
        "required": bool,
        "options": list[str]        # only for type="select"
      }, ...
    ]
  }
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_KPI_DEFAULT_CONFIG: dict = {
    "useVerifyCode": True,
    "fields": [
        {
            "key": "name",
            "label": "姓名",
            "type": "text",
            "placeholder": "請輸入真實姓名",
            "required": True,
        },
        {
            "key": "employeeId",
            "label": "員工編號",
            "type": "text",
            "placeholder": "請輸入員工編號",
            "required": True,
        },
    ],
}


def get_bind_config(is_test: bool) -> dict:
    """Return bind field config from console Firestore, falling back to KPI defaults."""
    try:
        from services.console_client import get_console_db

        prefix = "test_" if is_test else ""
        db = get_console_db()
        doc = db.collection(f"{prefix}_config").document("bind_fields").get()
        if doc.exists:
            data = doc.to_dict() or {}
            if data.get("fields"):
                return data
    except Exception:
        logger.warning("bind_config: console Firestore 讀取失敗，使用 KPI 預設設定")

    return _KPI_DEFAULT_CONFIG


def validate_bind_fields(
    fields_config: list[dict], body: dict
) -> tuple[dict, str | None]:
    """Validate all required fields from request body.

    Returns:
        (field_values, None)        on success
        ({}, error_message_str)     on validation failure
    """
    field_values: dict[str, str] = {}
    for field in fields_config:
        key = field["key"]
        val = (body.get(key) or "").strip()
        if field.get("required") and not val:
            return {}, f"缺少必填欄位：{field['label']}"
        field_values[key] = val
    return field_values, None
