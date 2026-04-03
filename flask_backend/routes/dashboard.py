"""
/api/dashboard  — main dashboard data aggregation.
"""

from __future__ import annotations

import logging

from flask import Blueprint, g, jsonify, request

from services.auth_service import require_auth
from services.scoring_service import (
    calc_tenure,
    current_quarter,
    days_since_join,
    is_eligible,
    is_in_scoring_period,
    is_probation,
    quarter_to_description,
)
from services.sheets_service import SheetsService

logger = logging.getLogger(__name__)
dashboard_bp = Blueprint("dashboard", __name__)


def _sheets(is_test: bool) -> SheetsService:
    return SheetsService(is_test=is_test)


# ── GET /api/dashboard ─────────────────────────────────────────────────────

@dashboard_bp.route("/dashboard", methods=["GET"])
@require_auth
def get_dashboard():
    """
    Return all data needed to render the dashboard for the current user.

    HR    → { isHR: true }
    Admin → { isSysAdmin: true, accounts: [...], settings: {...} }
    Manager → full dashboard payload
    """
    session = g.session
    line_uid: str = session["lineUid"]
    role: str = session.get("role", "同仁")
    is_test: bool = session.get("isTest", False)

    sheets = _sheets(is_test)

    if role == "HR":
        return jsonify({"isHR": True})

    if role == "系統管理員":
        accounts = sheets.get_all_accounts()
        settings = sheets.get_settings()
        return jsonify({
            "isSysAdmin": True,
            "managerName": session["name"],
            "accounts": accounts,
            "settings": settings,
        })

    # ── Manager view ───────────────────────────────────────────────────────
    return jsonify(_build_manager_dashboard(line_uid, session["name"], is_test, sheets))


# ── GET /api/dashboard/manager  (HR / SysAdmin viewing another manager) ────

@dashboard_bp.route("/dashboard/manager", methods=["GET"])
@require_auth
def get_manager_dashboard():
    """
    Return dashboard data for an arbitrary manager UID.
    Only HR / SysAdmin may call this.
    """
    session = g.session
    role = session.get("role", "")
    if role not in ("HR", "系統管理員"):
        return jsonify({"error": "無 HR 權限"}), 403

    target_uid = request.args.get("uid", "").strip()
    if not target_uid:
        return jsonify({"error": "缺少 uid 參數"}), 400

    is_test: bool = session.get("isTest", False)
    sheets = _sheets(is_test)

    account, _ = sheets.find_account_by_uid(target_uid)
    if not account:
        return jsonify({"error": "找不到該帳號"}), 404

    return jsonify(
        _build_manager_dashboard(target_uid, account["name"], is_test, sheets)
    )


# ── Private helper ─────────────────────────────────────────────────────────

def _build_manager_dashboard(
    line_uid: str, manager_name: str, is_test: bool, sheets: SheetsService
) -> dict:
    settings = sheets.get_settings()

    quarter = settings.get("當前季度") or current_quarter()
    responsibilities = sheets.get_manager_responsibilities()

    # Find sections this manager is responsible for
    my_responsibilities = [
        r for r in responsibilities
        if r["lineUid"] == line_uid
    ]

    if not my_responsibilities:
        return {
            "quarter": quarter,
            "managerName": manager_name,
            "total": 0,
            "scored": 0,
            "draft": 0,
            "pending": 0,
            "employees": [],
            "myScores": {},
            "settings": settings,
        }

    my_sections = {r["section"] for r in my_responsibilities}
    weight_by_section = {r["section"]: r["weight"] for r in my_responsibilities}

    # Get all employees and filter by section
    all_employees = sheets.get_all_employees()
    min_days = int(settings.get("最低評分天數") or 3)
    probation_days = int(settings.get("試用期天數") or 90)

    my_employees = [
        emp for emp in all_employees
        if emp["section"] in my_sections
        and not emp.get("leaveDate")  # exclude resigned
        and is_eligible(emp["joinDate"], min_days)
    ]

    # Get existing scores for this manager this quarter
    existing_scores = sheets.get_scores_by_manager(quarter, manager_name)
    score_map: dict[str, dict] = {s["empName"]: s for s in existing_scores}

    employees_out = []
    scored = draft = 0

    for emp in my_employees:
        name = emp["name"]
        score = score_map.get(name)
        status = score["status"] if score else "未評分"

        if status == "已送出":
            scored += 1
        elif status == "草稿":
            draft += 1

        employees_out.append({
            "name": name,
            "dept": emp["dept"],
            "section": emp["section"],
            "joinDate": emp["joinDate"],
            "tenure": calc_tenure(emp["joinDate"]),
            "isProbation": is_probation(emp["joinDate"], probation_days),
            "daysWorked": days_since_join(emp["joinDate"]),
            "weight": weight_by_section.get(emp["section"], 0),
            "scoreStatus": status,
        })

    total = len(employees_out)
    pending = total - scored - draft

    # Build myScores map: { empName: { scores, special, note, status } }
    my_scores = {
        s["empName"]: {
            "scores": s["scores"],
            "special": s["special"],
            "note": s["note"],
            "status": s["status"],
        }
        for s in existing_scores
    }

    return {
        "quarter": quarter,
        "quarterDescription": quarter_to_description(quarter),
        "managerName": manager_name,
        "total": total,
        "scored": scored,
        "draft": draft,
        "pending": pending,
        "employees": employees_out,
        "myScores": my_scores,
        "settings": settings,
    }
