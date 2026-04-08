"""
Fill employee IDs in 主管权重 sheet by matching job titles against 员工资料.
Outputs ASCII-safe text to avoid CP950 encoding issues on Windows terminal.
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

TEST_SHEET_ID = "1TCOXZ0hp20h4Vr0JyLyedO64TPaSnw9GX30Fuh8Pdyg"
PROD_SHEET_ID = "1VKHfnnrv-xfdqj-36I6grY8K-YcuCd8WMIcNAvRA_eg"


def main():
    gcp_sa_key = os.environ.get("GCP_SA_KEY", "")
    if not gcp_sa_key:
        print("ERROR: GCP_SA_KEY not set")
        return
    sa_info = json.loads(gcp_sa_key)
    creds = Credentials.from_service_account_info(sa_info, scopes=SCOPES)
    gc = gspread.authorize(creds)

    for label, sheet_id in [("TEST", TEST_SHEET_ID)]:  # TEST only for diagnosis
        print(f"\n=== {label} ===")
        ss = gc.open_by_key(sheet_id)

        # Read 员工资料
        emp_ws = ss.worksheet("考核名單")
        emp_rows = emp_ws.get_all_values()
        header = emp_rows[0] if emp_rows else []
        print(f"Employee headers: {header}")

        # Locate name/jobTitle/employeeId columns
        name_col = next((i for i, h in enumerate(header) if "姓名" in h or h == "name"), None)
        job_col = next((i for i, h in enumerate(header) if "職稱" in h or "職位" in h), None)
        id_col = next((i for i, h in enumerate(header) if "員工編號" in h or "工號" in h), None)

        print(f"Columns: name={name_col}, jobTitle={job_col}, employeeId={id_col}")

        # Build lookups
        job_to_emp_id: dict[str, str] = {}
        name_to_emp_id: dict[str, str] = {}
        all_job_titles = []

        for row in emp_rows[1:]:
            name = row[name_col].strip() if name_col is not None and len(row) > name_col else ""
            job = row[job_col].strip() if job_col is not None and len(row) > job_col else ""
            emp_id = row[id_col].strip() if id_col is not None and len(row) > id_col else ""
            if job:
                job_to_emp_id[job] = emp_id
                all_job_titles.append(job)
            if name:
                name_to_emp_id[name] = emp_id

        print(f"Loaded {len(name_to_emp_id)} employees, {len(job_to_emp_id)} unique job titles")

        # Read 主管权重
        weight_ws = ss.worksheet("主管權重")
        weight_rows = weight_ws.get_all_values()
        print(f"Weight sheet headers: {weight_rows[0] if weight_rows else []}")
        print(f"Total weight rows: {len(weight_rows) - 1}")

        unmatched_jobs = []
        updated = 0

        for row_idx, row in enumerate(weight_rows[1:], start=2):
            if not row or not row[0]:
                continue

            section = row[0].strip()
            job_title = row[1].strip() if len(row) > 1 else ""
            name = row[2].strip() if len(row) > 2 else ""
            line_uid = row[3].strip() if len(row) > 3 else ""
            current_emp_id = row[4].strip() if len(row) > 4 else ""
            weight = row[5].strip() if len(row) > 5 else ""

            if current_emp_id:
                print(f"  row {row_idx}: already has emp_id={current_emp_id} (job={job_title}, name={name})")
                continue

            # Try name first, then job title
            emp_id = name_to_emp_id.get(name, "") if name else ""
            if not emp_id:
                emp_id = job_to_emp_id.get(job_title, "")

            if emp_id:
                weight_ws.update_cell(row_idx, 5, emp_id)
                print(f"  [FILLED] row {row_idx}: {job_title}/{name} -> {emp_id}")
                updated += 1
            else:
                unmatched_jobs.append((row_idx, section, job_title, name))

        print(f"\nUpdated: {updated} rows")

        if unmatched_jobs:
            print(f"\nUNMATCHED ({len(unmatched_jobs)} rows):")
            for row_idx, section, job, name in unmatched_jobs:
                print(f"  row {row_idx}: section={section}, jobTitle={job}, name={name}")

            print(f"\nAll job titles in employee data:")
            for jt in sorted(set(all_job_titles)):
                print(f"  {jt}")

    print("\n[DONE]")


if __name__ == "__main__":
    main()
