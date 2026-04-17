"""
Fill employee IDs in 主管权重.
Strategy:
  1. HR spreadsheet (sheet gid=285248129): name + jobTitle + employeeId
  2. Build jobTitle → employeeId mapping
  3. Fill 主管権重 column E in TEST + PROD
"""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import gspread
from google.oauth2.service_account import Credentials
from dotenv import load_dotenv

load_dotenv()

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
]

HR_SHEET_ID    = os.environ.get("HR_SPREADSHEET_ID", "1hOBSm5BnCjsrp2rX51EN5kYVtEgLZ8FVIMF90_5BMqA")
TEST_SHEET_ID  = "1TCOXZ0hp20h4Vr0JyLyedO64TPaSnw9GX30Fuh8Pdyg"
PROD_SHEET_ID  = "1VKHfnnrv-xfdqj-36I6grY8K-YcuCd8WMIcNAvRA_eg"
HR_GID         = 285248129  # specific sheet in HR spreadsheet


def main():
    creds = Credentials.from_service_account_info(
        json.loads(os.environ["GCP_SA_KEY"]), scopes=SCOPES
    )
    gc = gspread.authorize(creds)

    # ── Step 1: Read HR spreadsheet to get name/jobTitle/employeeId ──────
    print(f"Reading HR spreadsheet: {HR_SHEET_ID}")
    hr_ss = gc.open_by_key(HR_SHEET_ID)

    # Open by gid
    hr_ws = None
    for ws in hr_ss.worksheets():
        if ws.id == HR_GID:
            hr_ws = ws
            break

    if hr_ws is None:
        # Fallback: try first sheet
        print(f"WARNING: sheet gid={HR_GID} not found, listing all sheets:")
        for ws in hr_ss.worksheets():
            print(f"  id={ws.id}, title={ws.title}")
        # Just use first sheet for diagnosis
        hr_ws = hr_ss.get_worksheet(0)

    hr_rows = hr_ws.get_all_values()
    print(f"HR sheet '{hr_ws.title}': {len(hr_rows)} rows")
    if hr_rows:
        print(f"Headers: {hr_rows[0]}")

    # Find relevant columns
    header = hr_rows[0] if hr_rows else []
    name_col = next((i for i, h in enumerate(header) if "姓名" in h), None)
    job_col  = next((i for i, h in enumerate(header) if "職稱" in h or "職位" in h), None)
    id_col   = next((i for i, h in enumerate(header) if "員工編號" in h or "工號" in h or "編號" in h), None)

    print(f"Columns found: name={name_col}, jobTitle={job_col}, employeeId={id_col}")

    if name_col is None or job_col is None or id_col is None:
        print("Cannot find required columns. Showing all data:")
        for i, row in enumerate(hr_rows[:5]):
            print(f"  row {i}: {row}")
        return

    # Build jobTitle → employeeId (and name → employeeId)
    job_to_id: dict[str, str] = {}
    name_to_id: dict[str, str] = {}

    print("\nAll manager data from HR:")
    for row in hr_rows[1:]:
        if len(row) <= max(name_col, job_col, id_col):
            continue
        name   = row[name_col].strip()
        job    = row[job_col].strip()
        emp_id = row[id_col].strip()
        if name and emp_id:
            name_to_id[name] = emp_id
        if job and emp_id:
            job_to_id[job] = emp_id
            print(f"  name={name}, job={job}, id={emp_id}")

    print(f"\njob→empId: {job_to_id}")

    # ── Step 2: Fill 主管権重 in TEST and PROD ───────────────────────────
    for label, sheet_id in [("TEST", TEST_SHEET_ID), ("PROD", PROD_SHEET_ID)]:
        print(f"\n{'='*40}\n{label}\n{'='*40}")
        ss = gc.open_by_key(sheet_id)
        weight_ws = ss.worksheet("主管權重")
        weight_rows = weight_ws.get_all_values()

        updated = 0
        unmatched = []

        for row_idx, row in enumerate(weight_rows[1:], start=2):
            if not row or not row[0]:
                continue
            section        = row[0].strip()
            job_title      = row[1].strip() if len(row) > 1 else ""
            name           = row[2].strip() if len(row) > 2 else ""
            current_emp_id = row[4].strip() if len(row) > 4 else ""

            if current_emp_id:
                continue

            # Try by name first, then by job title
            emp_id = name_to_id.get(name, "") or job_to_id.get(job_title, "")

            if emp_id:
                weight_ws.update_cell(row_idx, 5, emp_id)
                print(f"  [OK] row {row_idx}: section={section}, job={job_title} -> {emp_id}")
                updated += 1
            else:
                unmatched.append((row_idx, section, job_title, name))

        print(f"Updated: {updated}")
        if unmatched:
            print(f"Unmatched ({len(unmatched)}):")
            for r, s, j, n in unmatched:
                print(f"  row {r}: section={s}, jobTitle={j}, name={n}")

    print("\n[DONE]")


if __name__ == "__main__":
    main()
