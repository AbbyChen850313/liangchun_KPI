"""
/api/admin  — HR and SysAdmin management operations.
"""

from __future__ import annotations

import csv
import io
import logging
import re

from flask import Blueprint, g, jsonify, request, make_response

from extensions import limiter
from services.audit_service import write_audit_log
from services.auth_service import require_hr, require_sysadmin
from services.scoring_service import aggregate_annual_scores, annual_quarters, build_score_record, current_quarter as _current_quarter
from services.sheets_service import SheetsService

logger = logging.getLogger(__name__)
admin_bp = Blueprint("admin", __name__)

# [P1] Whitelist of editable settings keys — unknown keys are rejected
_ALLOWED_SETTINGS_KEYS = frozenset({
    "當前季度", "評分開始日", "評分截止日", "綁定驗證碼",
})

_CSV_INJECTION_PREFIXES = ('=', '+', '-', '@', '\t', '\r')


def _csv_safe(value) -> str:
    """Neutralise CSV/spreadsheet formula injection in user-supplied string values."""
    s = str(value) if value is not None else ""
    if s and s[0] in _CSV_INJECTION_PREFIXES:
        return "'" + s
    return s


def _annual_grade(score: float) -> str:
    """Map final annual score to grade label per CLAUDE.md: 甲≥90, 乙≥75, 丙≥60, 丁<60."""
    if score >= 90:
        return "甲"
    if score >= 75:
        return "乙"
    if score >= 60:
        return "丙"
    return "丁"


def _sheets(is_test: bool) -> SheetsService:
    return SheetsService(is_test=is_test)


# ── GET /api/admin/settings ────────────────────────────────────────────────

@admin_bp.route("/settings", methods=["GET"])
@require_hr
def get_settings():
    is_test: bool = g.session.get("isTest", False)
    return jsonify(_sheets(is_test).get_settings())


# ── POST /api/admin/settings ───────────────────────────────────────────────

@admin_bp.route("/settings", methods=["POST"])
@require_hr
def update_settings():
    is_test: bool = g.session.get("isTest", False)
    body = request.get_json(silent=True) or {}
    if not body:
        return jsonify({"error": "沒有要更新的設定"}), 400

    # [P1] Reject unknown keys to prevent arbitrary field injection
    unknown_keys = set(body.keys()) - _ALLOWED_SETTINGS_KEYS
    if unknown_keys:
        return jsonify({"error": f"不允許的設定欄位：{sorted(unknown_keys)}"}), 400

    _sheets(is_test).update_settings(body)
    logger.info(
        "AUDIT | route=update_settings | actor=%s(%s) | action=update | keys=%s",
        g.session["name"], g.session["lineUid"], list(body.keys()),
    )
    write_audit_log(
        actor_name=g.session["name"], actor_uid=g.session["lineUid"],
        action="update_settings", details={"keys": list(body.keys())}, is_test=is_test,
    )
    return jsonify({"success": True})


# ── GET /api/admin/employees ───────────────────────────────────────────────

@admin_bp.route("/employees", methods=["GET"])
@require_hr
def get_employees():
    is_test: bool = g.session.get("isTest", False)
    return jsonify(_sheets(is_test).get_all_employees())


# ── POST /api/admin/employees/sync ────────────────────────────────────────

@admin_bp.route("/employees/sync", methods=["POST"])
@require_hr
def sync_employees():
    """Sync employee list from HR spreadsheet."""
    is_test: bool = g.session.get("isTest", False)
    count = _sheets(is_test).sync_employees_from_hr()
    logger.info(
        "AUDIT | route=sync_employees | actor=%s(%s) | action=sync | count=%d",
        g.session["name"], g.session["lineUid"], count,
    )
    write_audit_log(
        actor_name=g.session["name"], actor_uid=g.session["lineUid"],
        action="sync_employees", details={"count": count}, is_test=is_test,
    )  # [P2-AUDIT-02]
    return jsonify({"success": True, "count": count})


# ── GET /api/admin/score-items ─────────────────────────────────────────────

@admin_bp.route("/score-items", methods=["GET"])
@require_hr
def get_score_items():
    is_test: bool = g.session.get("isTest", False)
    return jsonify(_sheets(is_test).get_score_items())


# ── GET /api/admin/responsibilities ───────────────────────────────────────

@admin_bp.route("/responsibilities", methods=["GET"])
@require_hr
def get_responsibilities():
    """Return the manager-section weight table (主管權重)."""
    is_test: bool = g.session.get("isTest", False)
    return jsonify(_sheets(is_test).get_manager_responsibilities())


# ── POST /api/admin/refresh-roles ─────────────────────────────────────────

@admin_bp.route("/refresh-roles", methods=["POST"])
@require_sysadmin
def refresh_roles():
    """Re-derive roles for all accounts from Sheets and sync to Firestore."""
    is_test: bool = g.session.get("isTest", False)
    updated_count = _sheets(is_test).refresh_roles_in_firestore()
    logger.info(
        "AUDIT | route=refresh_roles | actor=%s(%s) | action=refresh_roles | updatedCount=%d",
        g.session["name"], g.session["lineUid"], updated_count,
    )
    write_audit_log(
        actor_name=g.session["name"], actor_uid=g.session["lineUid"],
        action="refresh_roles", details={"updatedCount": updated_count}, is_test=is_test,
    )  # [P1-AUDIT-01]
    return jsonify({"success": True, "updatedCount": updated_count})


# ── POST /api/admin/batch-reset ────────────────────────────────────────────

@admin_bp.route("/batch-reset", methods=["POST"])
@require_hr
@limiter.limit("5/hour")
def batch_reset_scores():
    """Reset scoring records for a list of employee names in the current quarter."""
    is_test: bool = g.session.get("isTest", False)
    body = request.get_json(silent=True) or {}
    emp_names: list[str] = body.get("empNames", [])
    quarter: str = body.get("quarter", "")
    if not emp_names or not quarter:
        return jsonify({"error": "必須提供 empNames 與 quarter"}), 400
    reset_count = _sheets(is_test).reset_scores_for_employees(quarter, emp_names)
    logger.info(
        "AUDIT | route=batch_reset_scores | actor=%s(%s) | action=reset | quarter=%s | empNames=%s",
        g.session["name"], g.session["lineUid"], quarter, emp_names,
    )
    write_audit_log(
        actor_name=g.session["name"], actor_uid=g.session["lineUid"],
        action="batch_reset_scores",
        details={"quarter": quarter, "empNames": emp_names, "resetCount": reset_count},
        is_test=is_test,
    )  # [P1-AUDIT-01]
    return jsonify({"success": True, "resetCount": reset_count})


# ── POST /api/admin/batch-submit ───────────────────────────────────────────

@admin_bp.route("/batch-submit", methods=["POST"])
@require_hr
@limiter.limit("5/hour")
def batch_submit_scores():
    """
    HR proxy: submit scores for multiple employees/managers in one request.
    AC2: per-entry validation — failed entries are returned, others proceed.
    """
    is_test: bool = g.session.get("isTest", False)
    body = request.get_json(silent=True) or {}
    quarter: str = (body.get("quarter") or "").strip()
    entries: list[dict] = body.get("entries") or []

    if not quarter or not entries:
        return jsonify({"error": "必須提供 quarter 與 entries"}), 400

    sheets = _sheets(is_test)
    responsibilities = sheets.get_manager_responsibilities()

    # [P2] Pre-fetch submitted keys for idempotency guard — avoids re-submitting
    # records already in 已送出 state, treating them as no-ops rather than errors.
    submitted_keys = {
        (s["managerName"], s["empName"])
        for s in sheets.get_all_scores(quarter)
        if s["status"] == "已送出"
    }

    submitted, skipped, failed = 0, 0, []
    for entry in entries:
        manager_name = (entry.get("managerName") or "").strip()
        manager_uid = (entry.get("managerLineUid") or "").strip()
        emp_name = (entry.get("empName") or "").strip()
        section = (entry.get("section") or "").strip()
        scores_raw: dict = entry.get("scores") or {}
        special_raw = float(entry.get("special") or 0)
        note = (entry.get("note") or "").strip()

        if not manager_name or not emp_name or not section:
            failed.append({"empName": emp_name or "?", "error": "缺少必要欄位"})
            continue

        # [P1] Enforce special score range to prevent abnormal bonus manipulation
        if not (-20 <= special_raw <= 20):
            failed.append({"empName": emp_name, "error": "special 加減分必須在 -20 到 20 之間"})
            continue
        special = special_raw

        # [P0] Enforce note length limit per entry
        if len(note) > 500:
            failed.append({"empName": emp_name, "error": "備註不可超過 500 字"})
            continue

        # [P2] Idempotency: silently skip entries already submitted
        if (manager_name, emp_name) in submitted_keys:
            skipped += 1
            continue

        # AC2: validate all 6 items per entry; don't abort the whole batch
        missing = [f"item{i}" for i in range(1, 7) if not scores_raw.get(f"item{i}")]
        if missing:
            failed.append({"empName": emp_name, "error": f"評分項目未填完：{', '.join(missing)}"})
            continue

        try:
            record = build_score_record(
                manager_name, manager_uid, emp_name, section,
                scores_raw, special, note, quarter, responsibilities,
            )
            sheets.upsert_score(record)
            submitted += 1
        except Exception as exc:
            logger.exception("batch_submit failed: %s/%s", manager_name, emp_name)
            failed.append({"empName": emp_name, "error": str(exc)})

    logger.info(
        "AUDIT | route=batch_submit_scores | actor=%s(%s) | action=batch_submit"
        " | quarter=%s | submitted=%d | skipped=%d | failed=%d",
        g.session["name"], g.session["lineUid"], quarter, submitted, skipped, len(failed),
    )
    write_audit_log(
        actor_name=g.session["name"], actor_uid=g.session["lineUid"],
        action="batch_submit_scores",
        details={"quarter": quarter, "submitted": submitted, "skipped": skipped, "failedCount": len(failed)},
        is_test=is_test,
    )  # [P1-AUDIT-01]
    return jsonify({"success": True, "submitted": submitted, "skipped": skipped, "failed": failed})


# ── GET /api/admin/export-csv ──────────────────────────────────────────────

@admin_bp.route("/export-csv", methods=["GET"])
@require_hr
def export_scores_csv():
    """Export all scoring records for a given quarter as CSV."""
    is_test: bool = g.session.get("isTest", False)
    quarter = request.args.get("quarter", "")
    if not quarter:
        return jsonify({"error": "必須提供 quarter 參數"}), 400

    scores = _sheets(is_test).get_all_scores(quarter)
    logger.info(
        "AUDIT | route=export_scores_csv | actor=%s(%s) | action=export_csv | quarter=%s | count=%d",
        g.session["name"], g.session["lineUid"], quarter, len(scores),
    )
    write_audit_log(
        actor_name=g.session["name"], actor_uid=g.session["lineUid"],
        action="export_scores_csv", details={"quarter": quarter, "count": len(scores)}, is_test=is_test,
    )  # [P2-AUDIT-02]
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "季度", "主管", "員工", "科別", "權重",
        "項目1", "項目2", "項目3", "項目4", "項目5", "項目6",
        "原始分", "特殊加減", "調整後分", "加權分", "備註", "狀態", "更新時間",
    ])
    for s in scores:
        scores_map = s.get("scores", {})
        writer.writerow([
            s.get("quarter"), _csv_safe(s.get("managerName")), _csv_safe(s.get("empName")),
            _csv_safe(s.get("section")), s.get("weight"),
            scores_map.get("item1"), scores_map.get("item2"), scores_map.get("item3"),
            scores_map.get("item4"), scores_map.get("item5"), scores_map.get("item6"),
            s.get("rawScore"), s.get("special"), s.get("finalScore"),
            s.get("weightedScore"), _csv_safe(s.get("note")), s.get("status"), s.get("updatedAt"),
        ])

    csv_bytes = output.getvalue().encode("utf-8-sig")  # BOM for Excel
    # [P1] Strip non-digit characters to prevent Content-Disposition header injection
    safe_quarter = re.sub(r"[^0-9]", "", quarter)
    response = make_response(csv_bytes)
    response.headers["Content-Type"] = "text/csv; charset=utf-8-sig"
    response.headers["Content-Disposition"] = (
        f'attachment; filename="scores_{safe_quarter}.csv"'
    )
    return response


# ── GET /api/admin/export-annual-csv ──────────────────────────────────────

@admin_bp.route("/export-annual-csv", methods=["GET"])
@require_hr
def export_annual_scores_csv():
    """
    Export all-employee Q1~Q4 weighted scores as CSV for a given ROC year (AC3).

    Query param: year (ROC year, e.g. 115).
    Columns: 員工, 主管, 科別, Q1加權分 … Q4加權分, 全年加總, 已完成季度數.
    """
    is_test: bool = g.session.get("isTest", False)
    year = request.args.get("year", "").strip()
    if not year:
        return jsonify({"error": "必須提供 year 參數（民國年，如 115）"}), 400
    if not re.match(r"^\d{3}$", year) or not (100 <= int(year) <= 200):
        return jsonify({"error": "year 格式錯誤，請使用民國三位數年份（如 115）"}), 400

    sheets = _sheets(is_test)
    quarters = annual_quarters(int(year))
    all_scores = sheets.get_all_scores_for_year(year)

    emp_manager: dict[str, str] = {}
    emp_section: dict[str, str] = {}
    emp_map: dict[str, dict[str, float | None]] = {}
    for s in all_scores:
        emp = s["empName"]
        if emp not in emp_map:
            emp_map[emp] = {q: None for q in quarters}
            emp_manager[emp] = s["managerName"]
            emp_section[emp] = s["section"]
        if s["status"] == "已送出":
            emp_map[emp][s["quarter"]] = s.get("weightedScore")

    summary = aggregate_annual_scores(emp_map)
    adj_map: dict[str, float] = {
        a["empName"]: a["special"]
        for a in sheets.get_annual_adjustments(year)
    }
    logger.info(
        "AUDIT | route=export_annual_scores_csv | actor=%s(%s) | action=export_annual_csv | year=%s | employees=%d",
        g.session["name"], g.session["lineUid"], year, len(summary),
    )
    write_audit_log(
        actor_name=g.session["name"], actor_uid=g.session["lineUid"],
        action="export_annual_scores_csv", details={"year": year, "employees": len(summary)}, is_test=is_test,
    )  # [P2-AUDIT-02]
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        ["員工", "主管", "科別"]
        + [f"{q}加權分" for q in quarters]
        + ["四季平均", "已完成季度數", "HR年度調整", "最終年度總分", "等級"]
    )
    for emp, data in sorted(summary.items()):
        row = [_csv_safe(emp), _csv_safe(emp_manager.get(emp, "")), _csv_safe(emp_section.get(emp, ""))]
        for q in quarters:
            v = data["quarters"].get(q)
            row.append(v if v is not None else "未評分")
        completed_count: int = data["completedCount"]
        annual_avg = round(data["annualTotal"] / completed_count, 2) if completed_count > 0 else 0.0
        annual_special = adj_map.get(emp, 0.0)
        final_annual_score = round(annual_avg + annual_special, 2)
        grade = _annual_grade(final_annual_score) if completed_count > 0 else "未完成"
        row += [annual_avg, completed_count, annual_special, final_annual_score, grade]
        writer.writerow(row)

    csv_bytes = output.getvalue().encode("utf-8-sig")
    resp = make_response(csv_bytes)
    resp.headers["Content-Type"] = "text/csv; charset=utf-8-sig"
    resp.headers["Content-Disposition"] = (
        f'attachment; filename="annual_{year}.csv"'
    )
    return resp


# ── GET /api/admin/annual-adjust ──────────────────────────────────────────

@admin_bp.route("/annual-adjust", methods=["GET"])
@require_hr
def get_annual_adjust():
    """Return all employees' annual average + HR special adjustment for a given year.

    Query param: year (ROC year, e.g. 115). Defaults to the year of 當前季度.
    Response: { year, rows: [{ empName, annualAvg, completedCount, annualSpecial, finalAnnualScore }] }
    """
    is_test: bool = g.session.get("isTest", False)
    year = request.args.get("year", "").strip()
    if not year:
        settings = _sheets(is_test).get_settings()
        quarter = settings.get("當前季度") or _current_quarter()
        year = quarter[:3]
    if not re.match(r"^\d{3}$", year) or not (100 <= int(year) <= 200):
        return jsonify({"error": "year 格式錯誤，請使用民國三位數年份（如 115）"}), 400

    sheets = _sheets(is_test)
    quarters = annual_quarters(int(year))
    all_scores = sheets.get_all_scores_for_year(year)

    emp_map: dict[str, dict[str, float | None]] = {}
    for s in all_scores:
        emp = s["empName"]
        if emp not in emp_map:
            emp_map[emp] = {q: None for q in quarters}
        if s["status"] == "已送出":
            emp_map[emp][s["quarter"]] = s.get("weightedScore")

    summary = aggregate_annual_scores(emp_map)
    adj_map: dict[str, float] = {
        a["empName"]: a["special"]
        for a in sheets.get_annual_adjustments(year)
    }

    rows = []
    for emp_name, data in sorted(summary.items()):
        completed_count: int = data["completedCount"]
        annual_total: float = data["annualTotal"]
        annual_avg = round(annual_total / completed_count, 2) if completed_count > 0 else 0.0
        annual_special = adj_map.get(emp_name, 0.0)
        rows.append({
            "empName": emp_name,
            "annualAvg": annual_avg,
            "completedCount": completed_count,
            "annualSpecial": annual_special,
            "finalAnnualScore": round(annual_avg + annual_special, 2),
        })

    return jsonify({"year": year, "rows": rows})


# ── POST /api/admin/annual-adjust ─────────────────────────────────────────

@admin_bp.route("/annual-adjust", methods=["POST"])
@require_hr
@limiter.limit("20/hour")
def set_annual_adjust():
    """Set HR annual special adjustment for an employee.

    Body: { year, empName, special, note? }
    """
    is_test: bool = g.session.get("isTest", False)
    body = request.get_json(silent=True) or {}
    year = (body.get("year") or "").strip()
    emp_name = (body.get("empName") or "").strip()
    note = (body.get("note") or "").strip()

    if not year or not emp_name:
        return jsonify({"error": "必須提供 year 與 empName"}), 400
    if not re.match(r"^\d{3}$", year) or not (100 <= int(year) <= 200):
        return jsonify({"error": "year 格式錯誤，請使用民國三位數年份"}), 400

    try:
        special = float(body.get("special", 0))
    except (ValueError, TypeError):
        return jsonify({"error": "special 必須是數字"}), 400

    if not (-20 <= special <= 20):
        return jsonify({"error": "年度加減分必須在 -20 到 20 之間"}), 400
    if len(note) > 500:
        return jsonify({"error": "備註不可超過 500 字"}), 400

    _sheets(is_test).upsert_annual_adjustment(year, emp_name, special, note)
    logger.info(
        "AUDIT | route=set_annual_adjust | actor=%s(%s) | action=annual_adjust"
        " | year=%s | empName=%s | special=%s",
        g.session["name"], g.session["lineUid"], year, emp_name, special,
    )
    write_audit_log(
        actor_name=g.session["name"], actor_uid=g.session["lineUid"],
        action="set_annual_adjust",
        details={"year": year, "empName": emp_name, "special": special},
        is_test=is_test,
    )
    return jsonify({"success": True})


# ── GET /api/admin/score-comparison ──────────────────────────────────────

@admin_bp.route("/score-comparison", methods=["GET"])
@require_hr
def get_score_comparison():
    """Return per-employee manager score vs self-score for a quarter (HR only).

    Query param: quarter (e.g. 115Q1). Defaults to current quarter from settings.
    Response: { quarter, rows: [{ empName, section, managerName, managerRawScore,
                                   selfRawScore, diff, flagged }] }
    flagged = True when |managerRawScore - selfRawScore| >= 15.
    """
    from services.scoring_service import current_quarter as _current_quarter
    session = g.session
    is_test: bool = session.get("isTest", False)
    sheets = _sheets(is_test)
    quarter = request.args.get("quarter", "").strip()
    if not quarter:
        settings = sheets.get_settings()
        quarter = settings.get("當前季度") or _current_quarter()

    submitted_manager_scores = [
        s for s in sheets.get_all_scores(quarter)
        if s["status"] == "已送出"
        and not s["managerName"].startswith("【自評】")
    ]
    self_score_map: dict[str, dict] = {
        s["empName"]: s for s in sheets.get_all_self_scores(quarter)
    }

    rows = []
    for s in submitted_manager_scores:
        emp_name = s["empName"]
        self_rec = self_score_map.get(emp_name)
        manager_raw: float = s["rawScore"]
        self_raw: float | None = self_rec["rawScore"] if self_rec else None
        diff = round(manager_raw - self_raw, 2) if self_raw is not None else None
        rows.append({
            "empName": emp_name,
            "section": s["section"],
            "managerName": s["managerName"],
            "managerRawScore": manager_raw,
            "selfRawScore": self_raw,
            "diff": diff,
            "flagged": diff is not None and abs(diff) >= 15,
        })

    return jsonify({"quarter": quarter, "rows": rows})
