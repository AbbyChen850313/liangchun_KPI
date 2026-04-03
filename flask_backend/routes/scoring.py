"""
/api/scoring  — draft save, score submit, status queries.
"""

from __future__ import annotations

import logging

from flask import Blueprint, g, jsonify, request

from services.auth_service import require_auth, require_manager
from services.scoring_service import (
    aggregate_annual_scores,
    annual_quarters,
    build_score_record,
    calc_all,
    current_quarter,
    get_available_quarters,
    is_in_scoring_period,
    is_quarter_fully_submitted,
    quarter_to_description,
)
from services.sheets_service import SheetsService

logger = logging.getLogger(__name__)
scoring_bp = Blueprint("scoring", __name__)


def _sheets(is_test: bool) -> SheetsService:
    return SheetsService(is_test=is_test)


# ── POST /api/scoring/draft ────────────────────────────────────────────────

@scoring_bp.route("/draft", methods=["POST"])
@require_manager
def save_draft():
    return _upsert_score(status="草稿")


# ── POST /api/scoring/submit ───────────────────────────────────────────────

@scoring_bp.route("/submit", methods=["POST"])
@require_manager
def submit_score():
    return _upsert_score(status="已送出")


def _upsert_score(status: str):
    """Shared logic for save_draft and submit_score."""
    session = g.session
    manager_name: str = session["name"]
    line_uid: str = session["lineUid"]
    is_test: bool = session.get("isTest", False)

    body = request.get_json(silent=True) or {}
    emp_name = (body.get("empName") or "").strip()
    section = (body.get("section") or "").strip()
    scores_raw: dict = body.get("scores") or {}
    special = float(body.get("special") or 0)
    note = (body.get("note") or "").strip()
    quarter = (body.get("quarter") or "").strip()

    if not emp_name or not section:
        return jsonify({"error": "缺少員工姓名或科別"}), 400

    sheets = _sheets(is_test)
    settings = sheets.get_settings()

    if not quarter:
        quarter = settings.get("當前季度") or current_quarter()

    if status == "已送出":
        # Validate scoring period
        if not is_in_scoring_period(settings):
            return jsonify({"error": "不在評分期間內，無法送出"}), 403

        # Validate all 6 items are filled
        missing = [f"item{i}" for i in range(1, 7) if not scores_raw.get(f"item{i}")]
        if missing:
            return jsonify({"error": f"評分項目未填完：{', '.join(missing)}"}), 400

    # Get weight and build record (DIP: delegated to pure function)
    responsibilities = sheets.get_manager_responsibilities()

    # [P0-1] Validate section is within manager's assigned responsibilities
    manager_sections = {r["section"] for r in responsibilities if r["lineUid"] == line_uid}
    if section not in manager_sections:
        return jsonify({"error": "無此科別的評分權限"}), 403

    # [P0-1] Validate employee belongs to the submitted section
    all_employees = sheets.get_all_employees()
    section_employee_names = {e["name"] for e in all_employees if e["section"] == section}
    if emp_name not in section_employee_names:
        return jsonify({"error": "此員工不在指定科別中"}), 403

    # [P1] Duplicate submission guard — applied only before final submit
    if status == "已送出":
        existing = sheets.get_scores_by_manager(quarter, manager_name)
        if any(s["empName"] == emp_name and s["status"] == "已送出" for s in existing):
            return jsonify({"error": "此員工本季度已完成評分，無法重複提交"}), 409

    score_data = build_score_record(
        manager_name, line_uid, emp_name, section,
        scores_raw, special, note, quarter,
        responsibilities, status=status,
    )

    if score_data["weight"] == 0:
        return jsonify({"error": "找不到此科別的主管權重設定"}), 400

    sheets.upsert_score(score_data)

    if status == "已送出":
        logger.info(
            "AUDIT | route=submit_score | actor=%s(%s) | action=submit"
            " | quarter=%s | empName=%s | section=%s | rawScore=%.1f"
            " | permSections=%s",
            manager_name, line_uid, quarter, emp_name, section,
            score_data["rawScore"], sorted(manager_sections),
        )

    return jsonify({
        "success": True,
        "status": status,
        "rawScore": score_data["rawScore"],
        "finalScore": score_data["finalScore"],
        "weightedScore": score_data["weightedScore"],
    })


# ── GET /api/scoring/my-scores ─────────────────────────────────────────────

@scoring_bp.route("/my-scores", methods=["GET"])
@require_manager
def get_my_scores():
    """Return all scores submitted by the current manager for a quarter."""
    session = g.session
    manager_name: str = session["name"]
    is_test: bool = session.get("isTest", False)
    quarter = request.args.get("quarter", "").strip()

    sheets = _sheets(is_test)
    if not quarter:
        settings = sheets.get_settings()
        quarter = settings.get("當前季度") or current_quarter()

    scores = sheets.get_scores_by_manager(quarter, manager_name)
    result = {
        s["empName"]: {
            "scores": s["scores"],
            "special": s["special"],
            "note": s["note"],
            "status": s["status"],
        }
        for s in scores
    }
    return jsonify(result)


# ── GET /api/scoring/all-status ────────────────────────────────────────────

@scoring_bp.route("/all-status", methods=["GET"])
@require_auth
def get_all_status():
    """
    Return scoring progress for all managers (HR / SysAdmin only).
    """
    session = g.session
    if session.get("role") not in ("HR", "系統管理員"):
        return jsonify({"error": "無 HR 權限"}), 403

    is_test: bool = session.get("isTest", False)
    sheets = _sheets(is_test)
    settings = sheets.get_settings()
    quarter = settings.get("當前季度") or current_quarter()

    all_scores = sheets.get_all_scores(quarter)
    score_map: dict[str, dict[str, str]] = {}  # { managerName: { empName: status } }
    for s in all_scores:
        score_map.setdefault(s["managerName"], {})[s["empName"]] = s["status"]

    responsibilities = sheets.get_manager_responsibilities()
    all_employees = sheets.get_all_employees()
    sections_to_employees: dict[str, list[str]] = {}
    for emp in all_employees:
        sections_to_employees.setdefault(emp["section"], []).append(emp["name"])

    # Build per-manager summary
    manager_sections: dict[str, list] = {}
    for r in responsibilities:
        manager_sections.setdefault(r["lineUid"], []).append(r)

    result = []
    accounts = sheets.get_all_accounts()
    manager_accounts = [a for a in accounts if a.get("role") == "主管"]

    for account in manager_accounts:
        uid = account["lineUid"]
        name = account["name"]
        my_resp = manager_sections.get(uid, [])
        my_sections = {r["section"] for r in my_resp}

        emp_names = [
            n for sec in my_sections
            for n in sections_to_employees.get(sec, [])
        ]
        total = len(emp_names)
        manager_scores = score_map.get(name, {})
        scored = sum(1 for n in emp_names if manager_scores.get(n) == "已送出")
        pending = total - scored

        result.append({
            "managerName": name,
            "lineUid": uid,
            "testUid": account.get("testUid", ""),
            "total": total,
            "scored": scored,
            "pending": pending,
        })

    return jsonify(result)


# ── GET /api/scoring/annual-summary ───────────────────────────────────────

@scoring_bp.route("/annual-summary", methods=["GET"])
@require_manager
def get_annual_summary():
    """
    Return Q1~Q4 weighted score breakdown for all employees under the current manager.

    Query param: year (ROC year, e.g. 115). Defaults to the year of the current quarter.
    AC1: All four quarters scored → annualTotal = sum of Q1~Q4.
    AC2: Missing quarter → quarters[q] = null (frontend shows 未評分).
    """
    session = g.session
    manager_name: str = session["name"]
    is_test: bool = session.get("isTest", False)
    year = request.args.get("year", "").strip()

    sheets = _sheets(is_test)
    if not year:
        settings = sheets.get_settings()
        quarter = settings.get("當前季度") or current_quarter()
        year = quarter[:3]

    quarters = annual_quarters(int(year))

    all_scores: list[dict] = []
    for q in quarters:
        all_scores.extend(sheets.get_scores_by_manager(q, manager_name))

    emp_map: dict[str, dict[str, float | None]] = {}
    for s in all_scores:
        emp = s["empName"]
        if emp not in emp_map:
            emp_map[emp] = {q: None for q in quarters}
        if s["status"] == "已送出":
            emp_map[emp][s["quarter"]] = s.get("weightedScore")

    return jsonify({
        "year": year,
        "quarters": quarters,
        "summary": aggregate_annual_scores(emp_map),
    })


# ── GET /api/scoring/season-status ────────────────────────────────────────

@scoring_bp.route("/season-status", methods=["GET"])
@require_manager
def get_season_status():
    """Return per-quarter completion status for the current manager.

    Query param: year (ROC year, e.g. 115). Defaults to the year of the current quarter.
    Response: { year, quarters: [{ quarter, description, isAvailable, status, scoredCount, totalCount }] }
    """
    session = g.session
    manager_name: str = session["name"]
    line_uid: str = session["lineUid"]
    is_test: bool = session.get("isTest", False)
    year = request.args.get("year", "").strip()

    sheets = _sheets(is_test)
    if not year:
        settings = sheets.get_settings()
        year = (settings.get("當前季度") or current_quarter())[:3]

    available_quarters = get_available_quarters(int(year))

    responsibilities = sheets.get_manager_responsibilities()
    manager_sections = {r["section"] for r in responsibilities if r["lineUid"] == line_uid}

    # [P0-1] Only count employees in this manager's sections
    section_employees = [
        e for e in sheets.get_all_employees()
        if e["section"] in manager_sections
    ]
    year_scores = sheets.get_scores_by_manager_year(manager_name, year)

    result = []
    for q in annual_quarters(int(year)):
        q_scores = [s for s in year_scores if s["quarter"] == q]
        submitted_count = sum(1 for s in q_scores if s["status"] == "已送出")
        is_available = q in available_quarters
        is_complete = is_quarter_fully_submitted(q_scores, section_employees)

        if is_complete:
            status = "已完成"
        elif is_available:
            status = "評分中"
        else:
            status = "未開始"

        result.append({
            "quarter": q,
            "description": quarter_to_description(q),
            "isAvailable": is_available,
            "status": status,
            "scoredCount": submitted_count,
            "totalCount": len(section_employees),
        })

    return jsonify({"year": year, "quarters": result})


# ── GET /api/scoring/quarter-employees ────────────────────────────────────

@scoring_bp.route("/quarter-employees", methods=["GET"])
@require_manager
def get_quarter_employees():
    """Return employees with their scoring status for a given quarter.

    Query param: quarter (e.g. 115Q1). Defaults to current quarter.
    Response: { quarter, employees: [{ name, dept, section, joinDate, scoreStatus }] }
    """
    session = g.session
    manager_name: str = session["name"]
    line_uid: str = session["lineUid"]
    is_test: bool = session.get("isTest", False)
    quarter = request.args.get("quarter", "").strip()

    sheets = _sheets(is_test)
    if not quarter:
        settings = sheets.get_settings()
        quarter = settings.get("當前季度") or current_quarter()

    responsibilities = sheets.get_manager_responsibilities()
    # [P0-1] Scope employees to manager's own sections
    manager_sections = {r["section"] for r in responsibilities if r["lineUid"] == line_uid}

    section_employees = [
        e for e in sheets.get_all_employees()
        if e["section"] in manager_sections
    ]
    scores = sheets.get_scores_by_manager(quarter, manager_name)
    score_by_emp = {s["empName"]: s for s in scores}

    employees = [
        {
            "name": emp["name"],
            "dept": emp["dept"],
            "section": emp["section"],
            "joinDate": emp["joinDate"],
            "scoreStatus": score_by_emp[emp["name"]]["status"] if emp["name"] in score_by_emp else "未評分",
        }
        for emp in section_employees
    ]
    return jsonify({"quarter": quarter, "employees": employees})


# ── GET /api/scoring/employee-history ─────────────────────────────────────

@scoring_bp.route("/employee-history", methods=["GET"])
@require_manager
def get_employee_history():
    """Return 4-quarter weighted score history for one employee.

    Query params: empName, year (ROC year, e.g. 115).
    Response: { empName, year, quarters: { "115Q1": 57.0 | null, ... } }
    """
    session = g.session
    manager_name: str = session["name"]
    is_test: bool = session.get("isTest", False)
    emp_name = request.args.get("empName", "").strip()
    year = request.args.get("year", "").strip()

    if not emp_name:
        return jsonify({"error": "缺少 empName 參數"}), 400

    sheets = _sheets(is_test)
    if not year:
        settings = sheets.get_settings()
        year = (settings.get("當前季度") or current_quarter())[:3]

    quarters = annual_quarters(int(year))
    all_scores = sheets.get_scores_by_manager_year(manager_name, year)
    emp_scores = [s for s in all_scores if s["empName"] == emp_name and s["status"] == "已送出"]
    score_by_quarter: dict[str, float | None] = {q: None for q in quarters}
    for s in emp_scores:
        if s["quarter"] in score_by_quarter:
            score_by_quarter[s["quarter"]] = s.get("weightedScore")

    return jsonify({"empName": emp_name, "year": year, "quarters": score_by_quarter})


# ── GET /api/scoring/items ─────────────────────────────────────────────────

@scoring_bp.route("/items", methods=["GET"])
@require_auth
def get_score_items():
    """Return the list of scoring items (評分項目)."""
    is_test: bool = g.session.get("isTest", False)
    items = _sheets(is_test).get_score_items()
    return jsonify(items)
