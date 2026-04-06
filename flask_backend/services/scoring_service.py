"""
Pure business logic for scoring calculations.
No I/O — takes dicts in, returns dicts out.
"""

from __future__ import annotations

import math
from datetime import datetime


_GRADE_SCORES: dict[str, float] = {"甲": 95, "乙": 85, "丙": 65, "丁": 35}

# Grade cutoff thresholds per spec: 甲≥90, 乙≥75, 丙≥60, 丁<60
_GRADE_CUTOFF_JIA: int = 90
_GRADE_CUTOFF_YI: int = 75
_GRADE_CUTOFF_BING: int = 60

# Business rule constants — source of truth for validation across routes
SPECIAL_SCORE_MIN: float = -20.0   # 主管/HR 加減分下限
SPECIAL_SCORE_MAX: float = 20.0    # 主管/HR 加減分上限
NOTE_MAX_LENGTH: int = 500          # 備註字數上限（防止無限制儲存與 XSS 面積）
SCORE_DIFF_ALERT_THRESHOLD: int = 15  # |主管原始分 - 自評原始分| 超此值則警示


def grade_to_score(value: str | float) -> float | None:
    """Convert a grade string ('甲'/'乙'/'丙'/'丁') or numeric string to float."""
    if isinstance(value, (int, float)):
        score = float(value)
        if not (0 <= score <= 100):
            return None
        return score
    mapped = _GRADE_SCORES.get(str(value).strip())
    if mapped is not None:
        return mapped
    try:
        score = float(value)
        if not (0 <= score <= 100):
            return None
        return score
    except (ValueError, TypeError):
        return None


def calc_raw_score(scores: dict[str, str]) -> float:
    """Average of the six item scores (only non-empty items counted)."""
    values = [
        grade_to_score(scores.get(f"item{i}", ""))
        for i in range(1, 7)
    ]
    valid = [v for v in values if v is not None and not math.isnan(v)]
    if not valid:
        return 0.0
    return round(sum(valid) / len(valid), 2)


def calc_final_score(raw_score: float, special: float) -> float:
    return round(raw_score + special, 2)


def calc_weighted_score(final_score: float, weight: float) -> float:
    return round(final_score * weight, 2)


def score_grade(score: float) -> str:
    if score >= _GRADE_CUTOFF_JIA:
        return "甲等"
    if score >= _GRADE_CUTOFF_YI:
        return "乙等"
    if score >= _GRADE_CUTOFF_BING:
        return "丙等"
    return "丁等"


def calc_all(scores: dict, special: float, weight: float) -> dict:
    raw_score = calc_raw_score(scores)
    final_score = calc_final_score(raw_score, special)
    weighted_score = calc_weighted_score(final_score, weight)
    return {
        "rawScore": raw_score,
        "finalScore": final_score,
        "weightedScore": weighted_score,
    }


def build_score_record(
    manager_name: str,
    line_uid: str,
    emp_name: str,
    section: str,
    scores_raw: dict,
    special: float,
    note: str,
    quarter: str,
    responsibilities: list[dict],
    status: str = "已送出",
) -> dict:
    """
    Pure function — no I/O.
    Assemble a complete score record dict ready for sheets.upsert_score().
    Weight lookup is performed here so callers don't need to repeat it.
    """
    weight = next(
        (r["weight"] for r in responsibilities
         if r["lineUid"] == line_uid and r["section"] == section),
        0.0,
    )
    calc = calc_all(scores_raw, special, weight)
    return {
        "quarter": quarter,
        "managerName": manager_name,
        "empName": emp_name,
        "section": section,
        "weight": weight,
        "scores": scores_raw,
        "special": special,
        "note": note,
        "status": status,
        **calc,
    }


# ── Annual aggregation ─────────────────────────────────────────────────────

def annual_quarters(roc_year: int) -> list[str]:
    """Return the four quarter keys for a ROC year, e.g. 115 → ['115Q1','115Q2','115Q3','115Q4']."""
    return [f"{roc_year:03d}Q{q}" for q in range(1, 5)]


def aggregate_annual_scores(
    scores_by_emp: dict[str, dict[str, float | None]]
) -> dict[str, dict]:
    """
    Aggregate per-quarter weighted scores into an annual summary.

    Input:  { empName: { "115Q1": 80.5, "115Q2": None, "115Q3": 90.0, "115Q4": None } }
    Output: { empName: { quarters: {...}, annualAvg: float, completedCount: int } }
    annualAvg = avg(completed quarters), per spec: 年度總分 = avg(Q1~Q4 weightedScore).
    None indicates the quarter has not been scored yet.
    """
    result = {}
    for emp_name, q_scores in scores_by_emp.items():
        q_scores_snapshot = dict(q_scores)
        completed = {q: v for q, v in q_scores_snapshot.items() if v is not None}
        count = len(completed)
        quarter_sum = sum(completed.values())
        result[emp_name] = {
            "quarters": q_scores,
            "annualAvg": round(quarter_sum / count, 2) if count > 0 else 0.0,
            "completedCount": count,
        }
    return result


# ── Tenure & eligibility ───────────────────────────────────────────────────

def _parse_date(date_str: str) -> datetime | None:
    """Parse TW-style or ISO-style date strings."""
    if not date_str:
        return None
    for fmt in ("%Y/%m/%d", "%Y-%m-%d", "%Y/%m/%d %H:%M:%S"):
        try:
            return datetime.strptime(date_str.strip(), fmt)
        except ValueError:
            continue
    return None


def calc_tenure(join_date_str: str) -> str:
    join = _parse_date(join_date_str)
    if not join:
        return "-"
    now = datetime.now()
    years = now.year - join.year
    months = now.month - join.month
    if months < 0:
        years -= 1
        months += 12
    if years == 0:
        return f"{months}個月"
    if months == 0:
        return f"{years}年"
    return f"{years}年{months}個月"


def days_since_join(join_date_str: str) -> int:
    join = _parse_date(join_date_str)
    if not join:
        return 0
    return (datetime.now() - join).days


def is_probation(join_date_str: str, probation_days: int = 90) -> bool:
    return days_since_join(join_date_str) < probation_days


def is_eligible(join_date_str: str, min_days: int = 3) -> bool:
    return days_since_join(join_date_str) >= min_days


# ── Quarter helpers ────────────────────────────────────────────────────────

def current_quarter() -> str:
    now = datetime.now()
    roc_year = now.year - 1911
    q = (now.month - 1) // 3 + 1
    return f"{roc_year:03d}Q{q}"


def quarter_to_description(quarter: str) -> str:
    if not quarter or len(quarter) < 5:
        return quarter or ""
    roc_year = quarter[:3]
    try:
        q = int(quarter[4])
    except (ValueError, IndexError):
        return quarter
    ranges = {1: "1~3月", 2: "4~6月", 3: "7~9月", 4: "10~12月"}
    return f"{roc_year}/{ranges.get(q, '')}"


def is_in_scoring_period(settings: dict) -> bool:
    """Return True if today is within the configured scoring window."""
    start_str = settings.get("評分開始日", "")
    end_str = settings.get("評分截止日", "")
    if not start_str or not end_str:
        return True  # No window configured → always open
    start = _parse_date(start_str)
    end = _parse_date(end_str)
    if not start or not end:
        return True
    now = datetime.now()
    return start <= now <= end


def get_available_quarters(roc_year: int) -> list[str]:
    """Return quarters in roc_year that are at or before the current quarter.

    Example: year=115, current quarter=115Q2 → ['115Q1', '115Q2']
    Years prior to the current ROC year return all four quarters.
    """
    cq = current_quarter()
    cq_year = int(cq[:3])
    cq_num = int(cq[4])
    return [
        f"{roc_year:03d}Q{q}"
        for q in range(1, 5)
        if roc_year < cq_year or (roc_year == cq_year and q <= cq_num)
    ]


def is_quarter_fully_submitted(scores: list[dict], employees: list[dict]) -> bool:
    """Return True if every employee in the list has a submitted score.

    Args:
        scores:    List of score records for a single quarter (any status).
        employees: List of employee dicts, each with a 'name' key.
    """
    if not employees:
        return False
    submitted_names = {s["empName"] for s in scores if s.get("status") == "已送出"}
    return all(e["name"] in submitted_names for e in employees)
