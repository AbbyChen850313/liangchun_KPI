"""
One-off script: rename 員工資料 → 考核名單 on both TEST and PROD spreadsheets.
Run once, then delete.
"""
import os
import sys

# Load .env before importing config
_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_env_path = os.path.join(_HERE, ".env")
if os.path.exists(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())

# Add parent dir to path so we can import config
sys.path.insert(0, _HERE)

import gspread
from google.oauth2.service_account import Credentials
import config

_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
]

def get_client() -> gspread.Client:
    sa_info = config.gcp_sa_info()
    creds = Credentials.from_service_account_info(sa_info, scopes=_SCOPES)
    return gspread.authorize(creds)

OLD_NAME = "員工資料"
NEW_NAME = "考核名單"

PROD_ID = "1VKHfnnrv-xfdqj-36I6grY8K-YcuCd8WMIcNAvRA_eg"
TEST_ID = os.environ.get("TEST_SPREADSHEET_ID", "1TCOXZ0hp20h4Vr0JyLyedO64TPaSnw9GX30Fuh8Pdyg")

gc = get_client()

for label, sheet_id in [("TEST", TEST_ID), ("PROD", PROD_ID)]:
    print(f"\n=== {label} ({sheet_id}) ===")
    ss = gc.open_by_key(sheet_id)
    try:
        ws = ss.worksheet(OLD_NAME)
        ws.update_title(NEW_NAME)
        print(f"  ✓ Renamed '{OLD_NAME}' → '{NEW_NAME}'")
    except gspread.exceptions.WorksheetNotFound:
        # Check if already renamed
        try:
            ss.worksheet(NEW_NAME)
            print(f"  ✓ Already named '{NEW_NAME}', skipping")
        except gspread.exceptions.WorksheetNotFound:
            print(f"  ✗ Neither '{OLD_NAME}' nor '{NEW_NAME}' found!")

print("\nDone.")
