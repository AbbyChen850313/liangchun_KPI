"""
/api/admin  — HR and SysAdmin management operations.
"""

from __future__ import annotations

import csv
import io
import logging

from flask import Blueprint, g, jsonify, request, make_response

from services.auth_service import require_hr, require_sysadmin
from services.sheets_service import SheetsService

logger = logging.getLogger(__name__)
admin_bp = Blueprint("admin", __name__)


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
    _sheets(is_test).update_settings(body)
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
    return jsonify({"success": True, "updatedCount": updated_count})


# ── POST /api/admin/batch-reset ────────────────────────────────────────────

@admin_bp.route("/batch-reset", methods=["POST"])
@require_hr
def batch_reset_scores():
    """Reset scoring records for a list of employee names in the current quarter."""
    is_test: bool = g.session.get("isTest", False)
    body = request.get_json(silent=True) or {}
    emp_names: list[str] = body.get("empNames", [])
    quarter: str = body.get("quarter", "")
    if not emp_names or not quarter:
        return jsonify({"error": "必須提供 empNames 與 quarter"}), 400
    reset_count = _sheets(is_test).reset_scores_for_employees(quarter, emp_names)
    return jsonify({"success": True, "resetCount": reset_count})


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
            s.get("quarter"), s.get("managerName"), s.get("empName"),
            s.get("section"), s.get("weight"),
            scores_map.get("item1"), scores_map.get("item2"), scores_map.get("item3"),
            scores_map.get("item4"), scores_map.get("item5"), scores_map.get("item6"),
            s.get("rawScore"), s.get("special"), s.get("finalScore"),
            s.get("weightedScore"), s.get("note"), s.get("status"), s.get("updatedAt"),
        ])

    csv_bytes = output.getvalue().encode("utf-8-sig")  # BOM for Excel
    response = make_response(csv_bytes)
    response.headers["Content-Type"] = "text/csv; charset=utf-8-sig"
    response.headers["Content-Disposition"] = (
        f'attachment; filename="scores_{quarter}.csv"'
    )
    return response
