"""
Diagnostic script to compare job titles between 主管権重 and 員工資料 sheets.
Identifies missing employee IDs and potential name-based matches.

Usage:
  cd flask_backend
  python scripts/diagnose_weight.py
"""

from __future__ import annotations

import os
import sys
import json
import io

# Set stdout to UTF-8
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("GCP_PROJECT", "linchun-hr")

# Load .env file
_env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
if os.path.exists(_env_path):
    from dotenv import load_dotenv
    load_dotenv(_env_path)

import gspread
from google.oauth2.service_account import Credentials

_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
]

# TEST Spreadsheet ID
TEST_SPREADSHEET_ID = "1TCOXZ0hp20h4Vr0JyLyedO64TPaSnw9GX30Fuh8Pdyg"

# Column indices (0-based) for 主管權重 sheet
# Structure: 被評科別 | 職稱 | 姓名 | LINE_UID | 員工編號 | 權重
COL_WEIGHT_SECTION = 0
COL_WEIGHT_JOB_TITLE = 1
COL_WEIGHT_NAME = 2
COL_WEIGHT_LINE_UID = 3
COL_WEIGHT_EMPLOYEE_ID = 4
COL_WEIGHT_WEIGHT = 5

# Column indices (0-based) for 員工資料 sheet
# We need to find name and jobTitle columns
COL_EMPLOYEE_NAME = None  # Will discover
COL_EMPLOYEE_JOB_TITLE = None  # Will discover
COL_EMPLOYEE_ID = None  # Will discover


def load_credentials() -> dict:
    """Load service account credentials from GCP_SA_KEY env var."""
    raw = os.environ.get("GCP_SA_KEY")
    if not raw:
        raise ValueError("GCP_SA_KEY not found in environment. Ensure .env is loaded.")
    return json.loads(raw)


def get_sheets_client():
    """Create and return gspread client."""
    sa_info = load_credentials()
    creds = Credentials.from_service_account_info(sa_info, scopes=_SCOPES)
    return gspread.authorize(creds)


def read_weight_sheet(gc, spreadsheet_id: str) -> list[list[str]]:
    """Read all rows from 主管權重 sheet."""
    print(f"\n[Reading 主管權重 sheet...]")
    ss = gc.open_by_key(spreadsheet_id)

    try:
        ws = ss.worksheet("主管權重")
    except gspread.exceptions.WorksheetNotFound:
        print("  ERROR: '主管權重' sheet not found!")
        return []

    rows = ws.get_all_values()
    print(f"  Found {len(rows)} rows (including header)")

    if rows:
        print(f"  Header: {rows[0]}")

    return rows


def read_employee_sheet(gc, spreadsheet_id: str) -> tuple[list[list[str]], dict[str, int]]:
    """Read all rows from 員工資料 sheet and discover column indices."""
    print(f"\n[Reading 員工資料 sheet...]")
    ss = gc.open_by_key(spreadsheet_id)

    try:
        ws = ss.worksheet("考核名單")
    except gspread.exceptions.WorksheetNotFound:
        print("  ERROR: '考核名單' sheet not found!")
        return [], {}

    rows = ws.get_all_values()
    print(f"  Found {len(rows)} rows (including header)")

    if not rows:
        return [], {}

    # Discover column indices from header
    header = rows[0]
    print(f"  Header: {header}")

    col_indices = {}
    for idx, col_name in enumerate(header):
        col_lower = col_name.lower().strip()
        # Check for name column: contains "名" or is exactly "姓名"
        if col_name.strip() in ["姓名", "名字", "名"] or "名" in col_name:
            if "name" not in col_indices:  # prefer earlier columns
                col_indices["name"] = idx
        # Check for job title column
        if col_name.strip() == "職稱" or "job" in col_lower or "title" in col_lower:
            col_indices["jobTitle"] = idx
        # Check for employee ID column
        if col_name.strip() in ["員工編號", "編號"] or "id" in col_lower or "employee" in col_lower:
            col_indices["employeeId"] = idx

    print(f"  Discovered columns: {col_indices}")
    return rows, col_indices


def safe_get(row: list, idx: int, default: str = "") -> str:
    """Safely get cell value from row."""
    if idx is None:
        return default
    return row[idx].strip() if len(row) > idx else default


def main():
    print("=== Job Title Diagnostic Script ===")
    print(f"TEST Spreadsheet: {TEST_SPREADSHEET_ID}")

    # Load credentials and get Sheets client
    try:
        gc = get_sheets_client()
        print("[OK] Google Sheets client initialized")
    except Exception as e:
        print(f"[ERROR] Failed to initialize Sheets client: {e}")
        return

    # Read both sheets
    weight_rows = read_weight_sheet(gc, TEST_SPREADSHEET_ID)
    employee_rows, emp_col_indices = read_employee_sheet(gc, TEST_SPREADSHEET_ID)

    if not weight_rows or not employee_rows:
        print("[ERROR] Failed to read one or both sheets")
        return

    # Extract managers from weight sheet (skip header)
    weight_data = weight_rows[1:]

    # Extract employees from employee sheet (skip header)
    employee_data = employee_rows[1:]

    # Build lookup tables
    employees_by_name = {}
    employees_by_id = {}
    all_job_titles = set()

    emp_name_col = emp_col_indices.get("name")
    emp_job_col = emp_col_indices.get("jobTitle")
    emp_id_col = emp_col_indices.get("employeeId")

    for emp_row in employee_data:
        emp_name = safe_get(emp_row, emp_name_col)
        emp_job = safe_get(emp_row, emp_job_col)
        emp_id = safe_get(emp_row, emp_id_col)

        if emp_name:
            employees_by_name[emp_name] = {
                "jobTitle": emp_job,
                "employeeId": emp_id,
                "row": emp_row
            }

        if emp_id:
            employees_by_id[emp_id] = {
                "name": emp_name,
                "jobTitle": emp_job,
                "row": emp_row
            }

        if emp_job:
            all_job_titles.add(emp_job)

    print(f"\n[Employee Summary]")
    print(f"  Total employees: {len(employee_data)}")
    print(f"  Unique job titles: {len(all_job_titles)}")

    # Find managers with missing employee IDs
    print(f"\n[主管權重 - Analysis]")
    managers_missing_id = []
    managers_missing_name = []

    for idx, mgr_row in enumerate(weight_data, start=2):  # Row number starts at 2 (after header)
        section = safe_get(mgr_row, COL_WEIGHT_SECTION)
        job_title = safe_get(mgr_row, COL_WEIGHT_JOB_TITLE)
        name = safe_get(mgr_row, COL_WEIGHT_NAME)
        line_uid = safe_get(mgr_row, COL_WEIGHT_LINE_UID)
        employee_id = safe_get(mgr_row, COL_WEIGHT_EMPLOYEE_ID)
        weight = safe_get(mgr_row, COL_WEIGHT_WEIGHT)

        if not name:
            managers_missing_name.append({
                "row": idx,
                "section": section,
                "jobTitle": job_title,
                "lineUid": line_uid,
                "employeeId": employee_id,
                "weight": weight
            })

        if not employee_id:
            managers_missing_id.append({
                "row": idx,
                "section": section,
                "jobTitle": job_title,
                "name": name,
                "lineUid": line_uid,
                "weight": weight
            })

    # Report missing names
    print(f"\n  Managers with EMPTY NAME (Column C):")
    if managers_missing_name:
        print(f"  Found {len(managers_missing_name)} rows with empty name:\n")
        for mgr in managers_missing_name:
            emp_id_str = f"ID={mgr['employeeId']}" if mgr['employeeId'] else "ID=<empty>"
            print(f"  Row {mgr['row']}: {mgr['section']:12} | JobTitle: {mgr['jobTitle']:12} | {emp_id_str}")
    else:
        print("  All managers have names!")

    # Report missing employee IDs
    print(f"\n  Managers with MISSING EMPLOYEE ID (Column E):")
    if managers_missing_id:
        print(f"  Found {len(managers_missing_id)} rows with missing employee ID:\n")
        for mgr in managers_missing_id:
            match = employees_by_name.get(mgr["name"])
            if match:
                print(f"  Row {mgr['row']}: Name={mgr['name']:12} | JobTitle: {mgr['jobTitle']:12}")
                print(f"    [MATCH] CAN MATCH by name: ID={match['employeeId']}, JobTitle={match['jobTitle']}")
            else:
                print(f"  Row {mgr['row']}: Name={mgr['name']:12} | JobTitle: {mgr['jobTitle']:12}")
                print(f"    [NOMATCH] NO MATCH by name (not found in employee sheet)")
    else:
        print("  All managers have employee IDs!")

    # Show all unique job titles from 員工資料
    print(f"\n[All Unique Job Titles from 員工資料]")
    sorted_titles = sorted(all_job_titles)
    for title in sorted_titles:
        print(f"  - {title}")

    # Show job titles in weight sheet
    print(f"\n[Job Titles in 主管權重]")
    weight_job_titles = set()
    for mgr_row in weight_data:
        job_title = safe_get(mgr_row, COL_WEIGHT_JOB_TITLE)
        if job_title:
            weight_job_titles.add(job_title)

    sorted_weight_titles = sorted(weight_job_titles)
    for title in sorted_weight_titles:
        print(f"  - {title}")

    # Summary
    print(f"\n[Summary]")
    print(f"  Managers with missing IDs: {len(managers_missing_id)}")
    print(f"  Can auto-match by name: {sum(1 for m in managers_missing_id if m['name'] in employees_by_name)}")
    print(f"  Cannot match (name mismatch): {sum(1 for m in managers_missing_id if m['name'] not in employees_by_name)}")

    print("\n[DONE]")


if __name__ == "__main__":
    main()
