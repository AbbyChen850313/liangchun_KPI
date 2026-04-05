"""
KPI Plugin — AccountStorePort implementation.

Resolves employee identity via name + employeeId, backed by Google Sheets.
All field-name knowledge lives here; the base auth routes are field-agnostic.
"""

from __future__ import annotations

from base.ports import AccountStorePort
from services.sheets_service import SheetsService


class KpiAccountStore(AccountStorePort):
    """Delegates all account persistence to SheetsService (KPI Sheets schema)."""

    def _svc(self, is_test: bool) -> SheetsService:
        return SheetsService(is_test=is_test)

    def find_by_uid(self, line_uid: str, is_test: bool) -> tuple[dict | None, int]:
        return self._svc(is_test).find_account_by_uid(line_uid)

    def find_by_fields(
        self, field_values: dict[str, str], is_test: bool
    ) -> tuple[dict | None, int]:
        """KPI identity: name + employeeId uniquely identifies an employee."""
        name = field_values.get("name", "")
        employee_id = field_values.get("employeeId", "")
        return self._svc(is_test).find_account_by_identity(name, employee_id)

    def bind(
        self, row_index: int, line_uid: str, display_name: str, is_test: bool
    ) -> None:
        self._svc(is_test).bind_account(row_index, line_uid, display_name)

    def unbind(self, row_index: int, is_test: bool) -> None:
        self._svc(is_test).unbind_account(row_index)

    def get_all(self, is_test: bool) -> list[dict]:
        return self._svc(is_test).get_all_accounts()

    def name_exists(self, display_name: str, is_test: bool) -> bool:
        return self._svc(is_test).check_name_in_employees(display_name)

    def get_settings(self, is_test: bool) -> dict:
        return self._svc(is_test).get_settings()
