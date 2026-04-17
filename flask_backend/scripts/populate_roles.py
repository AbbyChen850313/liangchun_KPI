"""
Admin script: 從 LINE帳號 sheet 的 jobTitle 欄推導角色，寫入 H 欄（role）。
支援 PROD + TEST 兩個 spreadsheet。

執行方式：
  cd flask_backend
  python scripts/populate_roles.py
"""
from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("GCP_PROJECT", "linchun-hr")

# Load local .env so GCP_SA_KEY is available without ADC
_env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
if os.path.exists(_env_path):
    from dotenv import load_dotenv
    load_dotenv(_env_path)

import gspread
from google.oauth2.service_account import Credentials
import config

_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
]

# Column indices (0-based)
COL_NAME = 0
COL_JOB_TITLE = 5
COL_ROLE = 7   # H column

ROLE_RULES: list[tuple[str, str]] = [
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
DEFAULT_ROLE = "同仁"


def derive_role(job_title: str) -> str:
    for keyword, role in ROLE_RULES:
        if keyword in job_title:
            return role
    return DEFAULT_ROLE


def populate_roles(spreadsheet_id: str, label: str) -> None:
    print(f"\n=== {label} ({spreadsheet_id}) ===")
    sa_info = config.gcp_sa_info()
    creds = Credentials.from_service_account_info(sa_info, scopes=_SCOPES)
    gc = gspread.authorize(creds)

    ss = gc.open_by_key(spreadsheet_id)
    ws = ss.worksheet("LINE帳號")
    rows = ws.get_all_values()

    if len(rows) < 2:
        print("  ⚠️  Sheet 沒有資料列，跳過")
        return

    header = rows[0]
    print(f"  Header: {header}")

    updated = 0
    skipped_no_name = 0
    skipped_has_role = 0

    for i, row in enumerate(rows[1:], start=2):
        name = row[COL_NAME].strip() if len(row) > COL_NAME else ""
        if not name:
            skipped_no_name += 1
            continue

        job_title = row[COL_JOB_TITLE].strip() if len(row) > COL_JOB_TITLE else ""
        current_role = row[COL_ROLE].strip() if len(row) > COL_ROLE else ""
        derived = derive_role(job_title)

        if current_role == derived:
            skipped_has_role += 1
            continue  # already correct

        print(f"  Row {i}: role [{current_role or 'empty'}] -> [{derived}]".encode("ascii", "replace").decode())
        try:
            ws.update_cell(i, COL_ROLE + 1, derived)  # gspread is 1-indexed
            updated += 1
        except gspread.exceptions.APIError as e:
            err_str = str(e)
            if "protected" in err_str.lower():
                print(f"    [BLOCKED] Row {i} - H column still protected! Remove protection first.")
                print("    Stopping - all rows would fail the same way.")
                return
            if "429" in err_str:
                print(f"    [RATE LIMIT] Row {i} - sleeping 60s...")
                time.sleep(60)
                ws.update_cell(i, COL_ROLE + 1, derived)
                updated += 1
            else:
                print(f"    [ERROR] Row {i}: {err_str[:120]}")

        time.sleep(1.2)  # avoid write rate limit (60 writes/min)

    print(f"  [OK] Updated: {updated}, already-correct: {skipped_has_role}, no-name: {skipped_no_name}")


def main():
    prod_id = config.SPREADSHEET_ID  # 1VKHfnnrv-xfdqj-36I6grY8K-YcuCd8WMIcNAvRA_eg
    test_id = os.environ.get("TEST_SPREADSHEET_ID", "1TCOXZ0hp20h4Vr0JyLyedO64TPaSnw9GX30Fuh8Pdyg")

    populate_roles(prod_id, "PROD")
    populate_roles(test_id, "TEST")
    print("\n[DONE]")


if __name__ == "__main__":
    main()
