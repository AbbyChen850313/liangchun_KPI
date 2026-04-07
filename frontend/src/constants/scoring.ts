import type { ScoreGrade } from "../types";

/** Ordered list of valid KPI grade values. */
export const SCORE_GRADES: ScoreGrade[] = ["甲", "乙", "丙", "丁"];

/**
 * Numeric score for each grade, used to calculate the raw average.
 * Source: KPI spec — 甲(95) 乙(85) 丙(65) 丁(35)
 */
export const GRADE_SCORE_MAP: Record<ScoreGrade, number> = {
  甲: 95,
  乙: 85,
  丙: 65,
  丁: 35,
  "": 0,
};

/** Milliseconds per day — used for deadline countdowns. */
export const MS_PER_DAY = 86_400_000;

/** Minimum score difference (self vs manager) that triggers an alert banner. */
export const SCORE_DIFF_ALERT_THRESHOLD = 15;

/** Toast auto-dismiss duration in milliseconds. */
export const TOAST_DISMISS_MS = 3_000;

/** HR/manager special score adjustment bounds (mirrors backend SPECIAL_SCORE_MIN/MAX). */
export const SPECIAL_SCORE_MIN = -20;
export const SPECIAL_SCORE_MAX = 20;

/** Redirect delay after a successful submit, giving the user time to read the toast. */
export const POST_SUBMIT_REDIRECT_MS = 1_200;

/** Days remaining before deadline that triggers the urgent deadline warning banner. */
export const DEADLINE_WARNING_DAYS = 2;
