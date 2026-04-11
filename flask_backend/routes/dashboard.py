"""
/api/dashboard  — main dashboard data aggregation.
"""

from __future__ import annotations

import logging

from flask import Blueprint, g, jsonify, request

from services.auth_service import require_auth
from services.scoring_service import (
    SCORE_DIFF_ALERT_THRESHOLD,
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
    role: str = session.get("role") or "同仁"
    is_test: bool = session.get("isTest", False)

    sheets = _sheets(is_test)

    if role == "HR":
        return jsonify({"isHR": True})

    if role == "系統管理員":
        accounts = sheets.get_all_accounts()
        settings = sheets.get_settings()
        # Managers = unique names from 主管權重 (source of truth for who evaluates)
        responsibilities = sheets.get_manager_responsibilities()
        seen: set[str] = set()
        managers = []
        for r in responsibilities:
            name = r.get("name", "").strip()
            job_title = r.get("jobTitle", "").strip()
            if not name and not job_title:
                continue
            display = name or job_title
            if display not in seen:
                seen.add(display)
                managers.append({"name": display, "lineUid": r.get("lineUid", "")})
        managers.sort(key=lambda m: m["name"])
        return jsonify({
            "isSysAdmin": True,
            "managerName": session["name"],
            "accounts": accounts,
            "managers": managers,
            "settings": settings,
        })

    if role == "同仁":
        emp_name: str = session["name"]
        settings = sheets.get_settings()
        quarter = settings.get("當前季度") or current_quarter()
        self_record = sheets.get_self_score(quarter, emp_name)
        self_score_status = self_record.get("status") if self_record else "未填寫"
        return jsonify({
            "isEmployee": True,
            "empName": emp_name,
            "quarter": quarter,
            "selfScoreStatus": self_score_status,
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
    target_name = request.args.get("name", "").strip()
    if not target_uid and not target_name:
        return jsonify({"error": "缺少 uid 或 name 參數"}), 400

    is_test: bool = session.get("isTest", False)
    sheets = _sheets(is_test)

    if target_uid:
        account, _ = sheets.find_account_by_uid(target_uid)
        if not account:
            return jsonify({"error": "找不到該帳號"}), 404
        manager_name = account["name"]
    else:
        # Simulate by name (unbound managers who are in 主管權重)
        manager_name = target_name
        target_uid = ""  # will be resolved inside _build_manager_dashboard

    return jsonify(
        _build_manager_dashboard(target_uid, manager_name, is_test, sheets)
    )


# ── Private helper ─────────────────────────────────────────────────────────

def _build_manager_dashboard(
    line_uid: str, manager_name: str, is_test: bool, sheets: SheetsService
) -> dict:
    settings = sheets.get_settings()

    quarter = settings.get("當前季度") or current_quarter()
    responsibilities = sheets.get_manager_responsibilities()

    # Resolve manager's employee ID from 員工資料 (source of truth for IDs)
    manager_emp_id = ""
    manager_job_title = ""
    if manager_name:
        employees = sheets.get_all_employees()
        emp = next((e for e in employees if e.get("name", "").strip() == manager_name), None)
        if emp:
            manager_emp_id = emp.get("employeeId", "")
        # Also get job title from LINE帳號 for fallback
        accounts = sheets.get_all_accounts()
        acc = next((a for a in accounts if a.get("name") == manager_name), None)
        if acc:
            manager_job_title = acc.get("jobTitle", "")

    # Find sections this manager is responsible for.
    # Priority: employeeId → lineUid → jobTitle
    my_responsibilities = [
        r for r in responsibilities
        if (manager_emp_id and r.get("employeeId") == manager_emp_id) or
           (line_uid and r.get("lineUid") == line_uid) or
           (not manager_emp_id and not line_uid and manager_job_title and r.get("jobTitle") == manager_job_title)
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
            "diffAlerts": [],
            "settings": settings,
        }

    my_sections = {r["section"] for r in my_responsibilities}
    weight_by_section = {r["section"]: r["weight"] for r in my_responsibilities}

    # Get all employees and filter by section
    all_employees = sheets.get_all_employees()
    try:
        min_days = int(settings.get("最低評分天數") or 3)
    except (ValueError, TypeError):
        min_days = 3
    try:
        probation_days = int(settings.get("試用期天數") or 90)
    except (ValueError, TypeError):
        probation_days = 90

    my_employees = sorted(
        (
            emp for emp in all_employees
            if (emp["section"] in my_sections or emp.get("jobTitle", "") in my_sections)
            and emp["name"] != manager_name  # exclude self-evaluation
            and not emp.get("leaveDate")  # exclude resigned
            and is_eligible(emp["joinDate"], min_days)
        ),
        key=lambda e: (e["dept"], e["section"], e["name"]),
    )

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

    # Build diffAlerts: submitted manager scores where |manager - self| >= 15
    self_scores_quarter = sheets.get_all_self_scores(quarter)
    self_raw_map: dict[str, float] = {s["empName"]: s["rawScore"] for s in self_scores_quarter}

    diff_alerts = []
    for s in existing_scores:
        if s["status"] != "已送出":
            continue
        self_raw = self_raw_map.get(s["empName"])
        if self_raw is None:
            continue
        diff = round(s["rawScore"] - self_raw, 2)
        if abs(diff) >= SCORE_DIFF_ALERT_THRESHOLD:
            diff_alerts.append({
                "empName": s["empName"],
                "selfRawScore": self_raw,
                "managerRawScore": s["rawScore"],
                "diff": diff,
            })

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
        "diffAlerts": diff_alerts,
        "settings": settings,
    }
