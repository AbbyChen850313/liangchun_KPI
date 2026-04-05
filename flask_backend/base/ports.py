"""
Port interfaces for Base ↔ Plugin decoupling.

Base code (LINE binding state machine, session JWT, auth routes) depends
only on these ABCs.  Plugins provide the concrete implementations so that
the base module can be copied to a new system without touching KPI logic.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class AccountStorePort(ABC):
    """
    Abstract storage interface for the LINE binding / auth flow.

    All persistence operations in the auth lifecycle go through this port.
    The KPI plugin backs it with Google Sheets; a future plugin could use
    Firestore, SQL, or any other store without touching the base routes.
    """

    @abstractmethod
    def find_by_uid(self, line_uid: str, is_test: bool) -> tuple[dict | None, int]:
        """Return (account_dict, row_index) or (None, -1) when not found."""
        ...

    @abstractmethod
    def find_by_fields(
        self, field_values: dict[str, str], is_test: bool
    ) -> tuple[dict | None, int]:
        """
        Resolve employee identity from dynamic bind-field values.
        Return (account_dict, row_index) or (None, -1) when not found.
        The concrete implementation decides which fields are authoritative
        (e.g. KPI uses name + employeeId).
        """
        ...

    @abstractmethod
    def bind(
        self, row_index: int, line_uid: str, display_name: str, is_test: bool
    ) -> None:
        """Persist LINE UID → employee binding at row_index."""
        ...

    @abstractmethod
    def unbind(self, row_index: int, is_test: bool) -> None:
        """Clear the binding at row_index."""
        ...

    @abstractmethod
    def get_all(self, is_test: bool) -> list[dict]:
        """Return all account records (HR view)."""
        ...

    @abstractmethod
    def name_exists(self, display_name: str, is_test: bool) -> bool:
        """Return True if display_name matches any employee record."""
        ...

    @abstractmethod
    def get_settings(self, is_test: bool) -> dict:
        """Return system settings dict (e.g. bind verification code)."""
        ...
