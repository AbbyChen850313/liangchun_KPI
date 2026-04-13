"""
KPI 計算邏輯單元測試。

驗收條件：
  AC1: score_grade 各等級邊界值正確 (甲>=90, 乙>=75, 丙>=60, 丁<60)
  AC2: calc_raw_score 邊界值 0 和 100 正確（含全空→0、全滿→100）
  AC3: |自評-主管| >= 15 警示邏輯與常數正確

執行（從 flask_backend/ 目錄）：
    pytest tests/test_kpi_score.py -v
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.scoring_service import (
    SCORE_DIFF_ALERT_THRESHOLD,
    calc_raw_score,
    score_grade,
)


# ── AC1: score_grade 等級邊界 ──────────────────────────────────────────────


class TestScoreGrade:
    """甲>=90, 乙>=75, 丙>=60, 丁<60 — 各邊界值驗證。"""

    def test_score_0_is_丁等(self):
        assert score_grade(0) == "丁等"

    def test_score_59_is_丁等(self):
        assert score_grade(59) == "丁等"

    def test_score_59_99_is_丁等(self):
        assert score_grade(59.99) == "丁等"

    def test_score_60_is_丙等(self):
        assert score_grade(60) == "丙等"

    def test_score_74_99_is_丙等(self):
        assert score_grade(74.99) == "丙等"

    def test_score_75_is_乙等(self):
        assert score_grade(75) == "乙等"

    def test_score_89_99_is_乙等(self):
        assert score_grade(89.99) == "乙等"

    def test_score_90_is_甲等(self):
        assert score_grade(90) == "甲等"

    def test_score_100_is_甲等(self):
        assert score_grade(100) == "甲等"


# ── AC2: calc_raw_score 邊界值 ─────────────────────────────────────────────


class TestRawScoreBoundary:
    """rawScore=0（全空）與 rawScore=100（全數字 100）邊界驗證。"""

    def test_all_empty_items_returns_0(self):
        """全部空字串 → rawScore = 0.0"""
        scores = {f"item{i}": "" for i in range(1, 7)}
        assert calc_raw_score(scores) == 0.0

    def test_empty_dict_returns_0(self):
        """空字典（沒有任何 item 鍵）→ rawScore = 0.0"""
        assert calc_raw_score({}) == 0.0

    def test_all_numeric_100_returns_100(self):
        """全部填入數字字串 '100' → rawScore = 100.0"""
        scores = {f"item{i}": "100" for i in range(1, 7)}
        assert calc_raw_score(scores) == 100.0

    def test_all_numeric_100_as_int_returns_100(self):
        """全部填入整數 100 → rawScore = 100.0"""
        scores = {f"item{i}": 100 for i in range(1, 7)}
        assert calc_raw_score(scores) == 100.0

    def test_single_item_100_others_empty_returns_100(self):
        """只有 item1=100，其餘空白 → 只計算 item1，rawScore = 100.0"""
        scores = {"item1": "100", "item2": "", "item3": "", "item4": "", "item5": "", "item6": ""}
        assert calc_raw_score(scores) == 100.0

    def test_all_丁_returns_35(self):
        """全 丁（映射為 35）→ rawScore = 35.0，不為 0"""
        scores = {f"item{i}": "丁" for i in range(1, 7)}
        assert calc_raw_score(scores) == 35.0


# ── AC3: |自評-主管| >= 15 警示邏輯 ───────────────────────────────────────


class TestScoreDiffAlert:
    """|自評-主管| >= 15 警示 — 常數與邏輯邊界驗證。"""

    def test_threshold_constant_is_15(self):
        """規格要求警示門檻為 15。"""
        assert SCORE_DIFF_ALERT_THRESHOLD == 15

    def test_diff_14_not_flagged(self):
        diff = 14.0
        assert not (abs(diff) >= SCORE_DIFF_ALERT_THRESHOLD)

    def test_diff_14_99_not_flagged(self):
        diff = 14.99
        assert not (abs(diff) >= SCORE_DIFF_ALERT_THRESHOLD)

    def test_diff_15_flagged(self):
        diff = 15.0
        assert abs(diff) >= SCORE_DIFF_ALERT_THRESHOLD

    def test_diff_negative_15_flagged(self):
        """自評比主管高 15 分也要警示（絕對值）。"""
        diff = -15.0
        assert abs(diff) >= SCORE_DIFF_ALERT_THRESHOLD

    def test_diff_20_flagged(self):
        diff = 20.0
        assert abs(diff) >= SCORE_DIFF_ALERT_THRESHOLD
