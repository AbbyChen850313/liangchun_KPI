"""
Google Sheets data access layer via gspread.
Mirrors all the GAS Sheet operations from Auth.gs, Employees.gs, Scoring.gs, Config.gs.
"""

from __future__ import annotations

import logging
import time as _time
from datetime import datetime
from functools import cached_property
from typing import Any

import gspread
from google.oauth2.service_account import Credentials

import config

logger = logging.getLogger(__name__)

_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
]

# Column indices (0-based) for LINE帳號 sheet
_COL_ACCOUNT = {
    "name": 0,
    "lineUid": 1,
    "displayName": 2,
    "boundAt": 3,
    "status": 4,
    "jobTitle": 5,
    "phone": 6,
    "role": 7,
    "clearFlag": 8,
    "testUid": 9,
    "employeeId": 10,
}

# Column indices (0-based) for 主管權重 sheet
_COL_WEIGHT = {
    "section": 0,
    "jobTitle": 1,
    "name": 2,
    "lineUid": 3,
    "testUid": 4,
    "weight": 5,
}

# Column indices (0-based) for 評分記錄 sheet
_COL_SCORE = {
    "quarter": 0,
    "managerName": 1,
    "empName": 2,
    "section": 3,
    "weight": 4,
    "item1": 5,
    "item2": 6,
    "item3": 7,
    "item4": 8,
    "item5": 9,
    "item6": 10,
    "rawScore": 11,
    "special": 12,
    "finalScore": 13,
    "weightedScore": 14,
    "note": 15,
    "status": 16,
    "updatedAt": 17,
}


def _safe(row: list, idx: int, default: Any = "") -> Any:
    return row[idx] if len(row) > idx else default


def _with_retry(fn, max_attempts: int = 3, base_delay: float = 1.0):
    """Execute fn(), retrying on Sheets quota (429) or service-unavailable (503) errors.

    Uses exponential backoff: 1s → 2s → 4s.
    All other exceptions propagate immediately.
    """
    for attempt in range(max_attempts):
        try:
            return fn()
        except gspread.exceptions.APIError as exc:
            status_code = getattr(getattr(exc, "response", None), "status_code", 0)
            if status_code in (429, 503) and attempt < max_attempts - 1:
                delay = base_delay * (2 ** attempt)
                logger.warning(
                    "Sheets API %d; retrying in %.1fs (attempt %d/%d)",
                    status_code, delay, attempt + 1, max_attempts,
                )
                _time.sleep(delay)
                continue
            raise


# ── Worksheet-level TTL cache ──────────────────────────────────────────────
# Keyed by "{env}:{ws_name}". Shared across requests within the same process.
# Write operations must call _invalidate() so stale data is never served.

_CACHE_TTL: float = 10.0  # seconds — kept short to reduce stale-read risk across instances
_ws_cache: dict[str, tuple[list[list], float]] = {}

# Per-manager-year aggregation cache (longer TTL acceptable; invalidated on writes)
_YEAR_SCORE_CACHE_TTL: float = 60.0
_year_score_cache: dict[str, tuple[list[dict], float]] = {}


def _cache_key(is_test: bool, ws_name: str) -> str:
    return f"{'test' if is_test else 'prod'}:{ws_name}"


def _cached_rows(ws, is_test: bool, ws_name: str) -> list[list]:
    """Return cached get_all_values(), refreshing if stale."""
    key = _cache_key(is_test, ws_name)
    entry = _ws_cache.get(key)
    if entry and (_time.monotonic() - entry[1]) < _CACHE_TTL:
        return entry[0]
    rows = _with_retry(ws.get_all_values)
    _ws_cache[key] = (rows, _time.monotonic())
    return rows


def _invalidate(is_test: bool, ws_name: str) -> None:
    """Evict a worksheet from the cache after a write."""
    _ws_cache.pop(_cache_key(is_test, ws_name), None)


def _invalidate_year_score(is_test: bool, manager_name: str, year: str) -> None:
    """Evict the year-score aggregation cache for a specific manager+year."""
    env = "test" if is_test else "prod"
    _year_score_cache.pop(f"scores:{env}:{manager_name}:{year}", None)


class SheetsService:
    """All Google Sheets read/write operations for the 考核 system."""

    def __init__(self, is_test: bool = False):
        self.is_test = is_test
        self._client: gspread.Client | None = None
        self._spreadsheet: gspread.Spreadsheet | None = None
        self._hr_spreadsheet: gspread.Spreadsheet | None = None

    # ── Internal helpers ───────────────────────────────────────────────────

    def _get_client(self) -> gspread.Client:
        if not self._client:
            creds = Credentials.from_service_account_info(
                config.gcp_sa_info(), scopes=_SCOPES
            )
            self._client = gspread.authorize(creds)
        return self._client

    def _ss(self) -> gspread.Spreadsheet:
        if not self._spreadsheet:
            spreadsheet_id = (
                config.TEST_SPREADSHEET_ID
                if self.is_test and config.TEST_SPREADSHEET_ID
                else config.SPREADSHEET_ID
            )
            self._spreadsheet = self._get_client().open_by_key(spreadsheet_id)
        return self._spreadsheet

    def _hr_ss(self) -> gspread.Spreadsheet:
        if not self._hr_spreadsheet:
            self._hr_spreadsheet = self._get_client().open_by_key(
                config.HR_SPREADSHEET_ID
            )
        return self._hr_spreadsheet

    def worksheet(self, name: str) -> gspread.Worksheet:
        return self._ss().worksheet(name)

    # ── Settings (系統設定) ────────────────────────────────────────────────

    def get_settings(self) -> dict[str, str]:
        ws = self.worksheet("系統設定")
        rows = _cached_rows(ws, self.is_test, "系統設定")
        return {
            row[0]: (row[1] if len(row) > 1 else "")
            for row in rows[1:]
            if row and row[0]
        }

    def update_settings(self, new_settings: dict[str, str]) -> None:
        ws = self.worksheet("系統設定")
        rows = _cached_rows(ws, self.is_test, "系統設定")
        for i, row in enumerate(rows[1:], start=2):
            key = row[0] if row else ""
            if key in new_settings:
                ws.update_cell(i, 2, new_settings[key])
        _invalidate(self.is_test, "系統設定")

    # ── Accounts (LINE帳號) ────────────────────────────────────────────────

    def _parse_account_row(self, row: list) -> dict:
        c = _COL_ACCOUNT
        return {
            "name": _safe(row, c["name"]),
            "lineUid": _safe(row, c["lineUid"]),
            "displayName": _safe(row, c["displayName"]),
            "boundAt": _safe(row, c["boundAt"]),
            "status": _safe(row, c["status"]),
            "jobTitle": _safe(row, c["jobTitle"]),
            "phone": _safe(row, c["phone"]),
            "role": _safe(row, c["role"]),
            "testUid": _safe(row, c["testUid"]),
            "employeeId": _safe(row, c["employeeId"]),
        }

    def find_account_by_uid(self, line_uid: str) -> tuple[dict | None, int]:
        """Return (account_dict, 1-based row index) or (None, -1)."""
        ws = self.worksheet("LINE帳號")
        rows = _cached_rows(ws, self.is_test, "LINE帳號")
        uid_col = _COL_ACCOUNT["testUid"] if self.is_test else _COL_ACCOUNT["lineUid"]
        for i, row in enumerate(rows[1:], start=2):  # row i is 1-based sheet row
            if len(row) > uid_col and row[uid_col] == line_uid:
                return self._parse_account_row(row), i
        return None, -1

    def find_account_by_identity(
        self, name: str, employee_id: str
    ) -> tuple[dict | None, int]:
        """Match by name + employeeId for binding."""
        ws = self.worksheet("LINE帳號")
        rows = _cached_rows(ws, self.is_test, "LINE帳號")
        for i, row in enumerate(rows[1:], start=2):
            row_name = _safe(row, _COL_ACCOUNT["name"])
            row_emp_id = _safe(row, _COL_ACCOUNT["employeeId"])
            if row_name == name and row_emp_id == employee_id:
                return self._parse_account_row(row), i
        return None, -1

    def get_all_accounts(self) -> list[dict]:
        ws = self.worksheet("LINE帳號")
        rows = _cached_rows(ws, self.is_test, "LINE帳號")
        return [
            self._parse_account_row(row)
            for row in rows[1:]
            if row and _safe(row, _COL_ACCOUNT["name"])
        ]

    def bind_account(
        self,
        sheet_row: int,
        line_uid: str,
        display_name: str,
    ) -> None:
        """Write LINE UID (and metadata) into the given sheet row."""
        ws = self.worksheet("LINE帳號")
        now_str = datetime.now().strftime("%Y/%m/%d %H:%M:%S")
        if self.is_test:
            ws.update_cell(sheet_row, _COL_ACCOUNT["testUid"] + 1, line_uid)
        else:
            ws.update_cell(sheet_row, _COL_ACCOUNT["lineUid"] + 1, line_uid)
            ws.update_cell(sheet_row, _COL_ACCOUNT["displayName"] + 1, display_name)
            ws.update_cell(sheet_row, _COL_ACCOUNT["boundAt"] + 1, now_str)
            ws.update_cell(sheet_row, _COL_ACCOUNT["status"] + 1, "已授權")
        _invalidate(self.is_test, "LINE帳號")

    def unbind_account(self, sheet_row: int) -> None:
        ws = self.worksheet("LINE帳號")
        if self.is_test:
            ws.update_cell(sheet_row, _COL_ACCOUNT["testUid"] + 1, "")
        else:
            ws.update_cell(sheet_row, _COL_ACCOUNT["lineUid"] + 1, "")
            ws.update_cell(sheet_row, _COL_ACCOUNT["displayName"] + 1, "")
            ws.update_cell(sheet_row, _COL_ACCOUNT["boundAt"] + 1, "")
            ws.update_cell(sheet_row, _COL_ACCOUNT["status"] + 1, "")
        _invalidate(self.is_test, "LINE帳號")

    # ── Employees (員工資料) ───────────────────────────────────────────────

    def get_all_employees(self) -> list[dict]:
        ws = self.worksheet("員工資料")
        rows = _cached_rows(ws, self.is_test, "員工資料")
        return [
            {
                "employeeId": _safe(row, 0),
                "name": _safe(row, 1),
                "dept": _safe(row, 2),
                "section": _safe(row, 3),
                "joinDate": _safe(row, 4),
                "leaveDate": _safe(row, 5),
            }
            for row in rows[1:]
            if _safe(row, 1)  # must have a name
        ]

    def sync_employees_from_hr(self) -> int:
        """Copy eligible employees from HR Sheet → 員工資料 sheet. Returns count."""
        HR_COL = {
            "employeeId": 2,   # C
            "name": 4,         # E
            "dept": 10,        # K
            "section": 11,     # L
            "joinDate": 28,    # AC
            "leaveDate": 30,   # AE
            "include": 36,     # AK — "算入考核"
        }
        hr_ws = self._hr_ss().worksheet("(人工打)總表")
        hr_rows = hr_ws.get_all_values()

        eligible = []
        for row in hr_rows[1:]:
            if _safe(row, HR_COL["include"]) == "算入考核":
                eligible.append([
                    _safe(row, HR_COL["employeeId"]),
                    _safe(row, HR_COL["name"]),
                    _safe(row, HR_COL["dept"]),
                    _safe(row, HR_COL["section"]),
                    _safe(row, HR_COL["joinDate"]),
                    _safe(row, HR_COL["leaveDate"]),
                ])

        dest_ws = self.worksheet("員工資料")
        # Clear existing data (keep header row)
        dest_ws.resize(rows=1)
        if eligible:
            dest_ws.append_rows(eligible, value_input_option="USER_ENTERED")
        _invalidate(self.is_test, "員工資料")

        # Automatically sync roles so Firestore reflects latest Sheets data
        try:
            self.refresh_roles_in_firestore()
        except Exception:
            logger.exception("Auto refresh_roles after sync_employees failed; skipping.")

        return len(eligible)

    # ── Manager weights (主管權重) ─────────────────────────────────────────

    def get_manager_responsibilities(self) -> list[dict]:
        ws = self.worksheet("主管權重")
        rows = _cached_rows(ws, self.is_test, "主管權重")
        result = []
        c = _COL_WEIGHT
        for row in rows[1:]:
            if not _safe(row, c["section"]):
                continue
            uid_col = c["testUid"] if self.is_test else c["lineUid"]
            result.append({
                "section": _safe(row, c["section"]),
                "jobTitle": _safe(row, c["jobTitle"]),
                "name": _safe(row, c["name"]),
                "lineUid": _safe(row, uid_col),
                "weight": float(_safe(row, c["weight"]) or 0),
            })
        return result

    # ── Score items (評分項目) ─────────────────────────────────────────────

    def get_score_items(self) -> list[dict]:
        ws = self.worksheet("評分項目")
        rows = _cached_rows(ws, self.is_test, "評分項目")
        return [
            {"code": _safe(row, 0), "name": _safe(row, 1), "description": _safe(row, 2)}
            for row in rows[1:]
            if _safe(row, 0)
        ]

    # ── Scores (評分記錄) ──────────────────────────────────────────────────

    def _parse_score_row(self, row: list) -> dict:
        c = _COL_SCORE
        return {
            "quarter": _safe(row, c["quarter"]),
            "managerName": _safe(row, c["managerName"]),
            "empName": _safe(row, c["empName"]),
            "section": _safe(row, c["section"]),
            "weight": float(_safe(row, c["weight"]) or 0),
            "scores": {
                f"item{i}": _safe(row, c[f"item{i}"])
                for i in range(1, 7)
            },
            "rawScore": float(_safe(row, c["rawScore"]) or 0),
            "special": float(_safe(row, c["special"]) or 0),
            "finalScore": float(_safe(row, c["finalScore"]) or 0),
            "weightedScore": float(_safe(row, c["weightedScore"]) or 0),
            "note": _safe(row, c["note"]),
            "status": _safe(row, c["status"]),
            "updatedAt": _safe(row, c["updatedAt"]),
        }

    def _score_to_row(self, d: dict) -> list:
        scores = d.get("scores", {})
        return [
            d.get("quarter", ""),
            d.get("managerName", ""),
            d.get("empName", ""),
            d.get("section", ""),
            d.get("weight", ""),
            scores.get("item1", ""),
            scores.get("item2", ""),
            scores.get("item3", ""),
            scores.get("item4", ""),
            scores.get("item5", ""),
            scores.get("item6", ""),
            d.get("rawScore", ""),
            d.get("special", ""),
            d.get("finalScore", ""),
            d.get("weightedScore", ""),
            d.get("note", ""),
            d.get("status", ""),
            datetime.now().strftime("%Y/%m/%d %H:%M:%S"),
        ]

    def get_scores_by_manager(self, quarter: str, manager_name: str) -> list[dict]:
        ws = self.worksheet("評分記錄")
        rows = _cached_rows(ws, self.is_test, "評分記錄")
        c = _COL_SCORE
        return [
            self._parse_score_row(row)
            for row in rows[1:]
            if _safe(row, c["quarter"]) == quarter
            and _safe(row, c["managerName"]) == manager_name
        ]

    def get_all_scores(self, quarter: str) -> list[dict]:
        ws = self.worksheet("評分記錄")
        rows = _cached_rows(ws, self.is_test, "評分記錄")
        c = _COL_SCORE
        return [
            self._parse_score_row(row)
            for row in rows[1:]
            if _safe(row, c["quarter"]) == quarter
        ]

    def get_all_scores_for_year(self, roc_year: str) -> list[dict]:
        """Return all scoring records whose quarter starts with the given ROC year prefix.

        OCP: extends functionality without modifying the existing get_all_scores method.
        """
        ws = self.worksheet("評分記錄")
        rows = _cached_rows(ws, self.is_test, "評分記錄")
        c = _COL_SCORE
        return [
            self._parse_score_row(row)
            for row in rows[1:]
            if _safe(row, c["quarter"]).startswith(roc_year)
        ]

    def get_scores_by_manager_year(self, manager_name: str, year: str) -> list[dict]:
        """Return all scoring records for a manager across a full ROC year.

        Uses a 60-second TTL aggregation cache (keyed by 'scores:{env}:{manager}:{year}')
        on top of the worksheet-level cache to reduce repeated full-sheet reads when
        the season-status endpoint polls multiple times per minute.
        """
        env = "test" if self.is_test else "prod"
        cache_key = f"scores:{env}:{manager_name}:{year}"
        entry = _year_score_cache.get(cache_key)
        if entry and (_time.monotonic() - entry[1]) < _YEAR_SCORE_CACHE_TTL:
            return entry[0]
        manager_scores = [
            s for s in self.get_all_scores_for_year(year)
            if s["managerName"] == manager_name
        ]
        _year_score_cache[cache_key] = (manager_scores, _time.monotonic())
        return manager_scores

    def upsert_score(self, score_data: dict) -> None:
        """Update existing row or append a new one."""
        ws = self.worksheet("評分記錄")
        rows = _cached_rows(ws, self.is_test, "評分記錄")
        c = _COL_SCORE
        score_row = self._score_to_row(score_data)
        for i, row in enumerate(rows[1:], start=2):
            if (
                _safe(row, c["quarter"]) == score_data["quarter"]
                and _safe(row, c["managerName"]) == score_data["managerName"]
                and _safe(row, c["empName"]) == score_data["empName"]
            ):
                existing_status = _safe(row, c["status"])
                if existing_status == "已送出":
                    if score_data.get("status") == "已送出":
                        raise ValueError(
                            f"duplicate_submission:{score_data.get('empName')}"
                        )
                    return  # 已送出記錄不允許被草稿覆寫
                _with_retry(lambda: ws.update(
                    f"A{i}:R{i}",
                    [score_row],
                    value_input_option="USER_ENTERED",
                ))
                _invalidate(self.is_test, "評分記錄")
                return
        _with_retry(lambda: ws.append_row(score_row, value_input_option="USER_ENTERED"))
        _invalidate(self.is_test, "評分記錄")
        year = score_data.get("quarter", "")[:3]
        manager = score_data.get("managerName", "")
        if year and manager:
            _invalidate_year_score(self.is_test, manager, year)

    # ── Self-scores (自評記錄) — stored in 評分記錄 with managerName = "【自評】{empName}" ──

    _SELF_SCORE_PREFIX = "【自評】"

    def get_self_score(self, quarter: str, emp_name: str) -> dict | None:
        """Return the self-assessment record for an employee in a quarter, or None."""
        ws = self.worksheet("評分記錄")
        rows = _cached_rows(ws, self.is_test, "評分記錄")
        c = _COL_SCORE
        sentinel = f"{self._SELF_SCORE_PREFIX}{emp_name}"
        for row in rows[1:]:
            if (
                _safe(row, c["quarter"]) == quarter
                and _safe(row, c["managerName"]) == sentinel
            ):
                return self._parse_score_row(row)
        return None

    def get_all_self_scores(self, quarter: str) -> list[dict]:
        """Return all self-assessment records for a quarter."""
        ws = self.worksheet("評分記錄")
        rows = _cached_rows(ws, self.is_test, "評分記錄")
        c = _COL_SCORE
        return [
            self._parse_score_row(row)
            for row in rows[1:]
            if _safe(row, c["quarter"]) == quarter
            and _safe(row, c["managerName"]).startswith(self._SELF_SCORE_PREFIX)
        ]

    def upsert_self_score(
        self, quarter: str, emp_name: str, section: str, scores: dict, note: str
    ) -> float:
        """Save or overwrite an employee's self-assessment. Returns rawScore."""
        from services.scoring_service import calc_all as _calc_all
        sentinel = f"{self._SELF_SCORE_PREFIX}{emp_name}"
        calc = _calc_all(scores, 0, 0)
        score_row = self._score_to_row({
            "quarter": quarter,
            "managerName": sentinel,
            "empName": emp_name,
            "section": section,
            "weight": 0,
            "scores": scores,
            "special": 0,
            "note": note,
            "rawScore": calc["rawScore"],
            "finalScore": calc["finalScore"],
            "weightedScore": 0,
            "status": "已送出",
        })
        ws = self.worksheet("評分記錄")
        rows = _cached_rows(ws, self.is_test, "評分記錄")
        c = _COL_SCORE
        for i, row in enumerate(rows[1:], start=2):
            if (
                _safe(row, c["quarter"]) == quarter
                and _safe(row, c["managerName"]) == sentinel
            ):
                _with_retry(lambda i=i, score_row=score_row: ws.update(
                    f"A{i}:R{i}", [score_row], value_input_option="USER_ENTERED"
                ))
                _invalidate(self.is_test, "評分記錄")
                return calc["rawScore"]
        _with_retry(lambda: ws.append_row(score_row, value_input_option="USER_ENTERED"))
        _invalidate(self.is_test, "評分記錄")
        return calc["rawScore"]

    def reset_scores_for_employees(self, quarter: str, emp_names: list[str]) -> int:
        """Delete scoring rows for specified employees in a given quarter."""
        ws = self.worksheet("評分記錄")
        rows = _cached_rows(ws, self.is_test, "評分記錄")
        c = _COL_SCORE
        rows_to_delete = [
            i
            for i, row in enumerate(rows[1:], start=2)
            if _safe(row, c["quarter"]) == quarter
            and _safe(row, c["empName"]) in emp_names
        ]
        # Delete from bottom to top so row indices stay valid
        for sheet_row in reversed(rows_to_delete):
            ws.delete_rows(sheet_row)
        _invalidate(self.is_test, "評分記錄")
        # Bulk reset may affect multiple managers — clear the entire year-score cache
        year = quarter[:3]
        stale_keys = [k for k in list(_year_score_cache) if f":{year}" in k]
        for k in stale_keys:
            _year_score_cache.pop(k, None)
        return len(rows_to_delete)

    # ── Role refresh (LINE帳號 → Firestore) ───────────────────────────────────

    # Maps job-title keywords to roles. More specific entries must come first.
    _ROLE_RULES: list[tuple[str, str]] = [
        ("系統管理員", "系統管理員"),
        ("人資", "HR"),
        ("HR", "HR"),
        ("廠長", "主管"),
        ("組長", "主管"),
        ("課長", "主管"),
        ("主任", "主管"),
        ("副理", "主管"),
        ("經理", "主管"),
        ("協理", "主管"),
        ("副總", "主管"),
        ("總經理", "主管"),
    ]
    _DEFAULT_ROLE = "員工"

    def _derive_role_from_job_title(self, job_title: str) -> str:
        """Return the role string inferred from a job title."""
        for keyword, role in self._ROLE_RULES:
            if keyword in job_title:
                return role
        return self._DEFAULT_ROLE

    def refresh_roles_in_firestore(self) -> int:
        """Read all accounts from LINE帳號 sheet and upsert role into Firestore."""
        import config

        try:
            import firebase_admin
            from firebase_admin import credentials as fb_creds, firestore as fb_store
        except ImportError as exc:
            raise RuntimeError("firebase-admin not installed") from exc

        # Initialise Firebase app lazily (safe to call multiple times)
        if not firebase_admin._apps:
            sa_info = config.gcp_sa_info()
            firebase_admin.initialize_app(fb_creds.Certificate(sa_info))

        db = fb_store.client()
        prefix = "test_" if self.is_test else ""
        collection_name = f"{prefix}accounts"

        accounts = self.get_all_accounts()
        updated = 0
        for account in accounts:
            uid = account.get("lineUid") or account.get("testUid")
            if not uid:
                continue
            role = account.get("role") or self._derive_role_from_job_title(
                account.get("jobTitle", "")
            )
            db.collection(collection_name).document(uid).set(
                {"role": role, "name": account.get("name", "")},
                merge=True,
            )
            updated += 1

        logger.info("refresh_roles_in_firestore: updated %d accounts (env=%s)", updated, collection_name)
        return updated
