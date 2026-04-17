"""
Admin script: 直接 Sheets → Firestore 同步員工資料（測試環境）
用途: 繞過 HTTP auth，直接呼叫 SheetsService，適合本機手動執行
執行方式: python scripts/sync_test_employees.py
"""
import os
import sys

# Add flask_backend to path so we can import config/services
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Must set is-test flag before importing config
os.environ.setdefault("GCP_PROJECT", "linchun-hr")

# TEST_SPREADSHEET_ID — 使用考核系統測試 Sheet
# 若環境變數已設定則沿用，否則用已知的測試 ID
if not os.environ.get("TEST_SPREADSHEET_ID"):
    os.environ["TEST_SPREADSHEET_ID"] = "1VKHfnnrv-xfdqj-36I6grY8K-YcuCd8WMIcNAvRA_eg"
    print(f"[warn] TEST_SPREADSHEET_ID not set, using fallback (prod sheet). "
          f"Set TEST_SPREADSHEET_ID env var to use a dedicated test sheet.")

from services.sheets_service import SheetsService  # noqa: E402


def main():
    print("=== Employee Sync: Sheets → Firestore (TEST) ===")
    print(f"TEST_SPREADSHEET_ID: {os.environ.get('TEST_SPREADSHEET_ID')}")

    service = SheetsService(is_test=True)

    print("Fetching employees from HR Sheet...")
    count = service.sync_employees_from_hr()
    print(f"✅ Synced {count} employees to test environment.")

    # Verify: list first 5
    employees = service.get_all_employees()
    print(f"Verification: {len(employees)} employees in test sheet.")
    for emp in employees[:5]:
        print(f"  - {emp.get('name', '?')} ({emp.get('employeeId', '?')})")
    if len(employees) > 5:
        print(f"  ... and {len(employees) - 5} more")


if __name__ == "__main__":
    main()
