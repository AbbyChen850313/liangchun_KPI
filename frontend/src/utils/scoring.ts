import { GRADE_SCORE_MAP } from "../constants/scoring";
import type { ScoreGrade, ScoreItems } from "../types";

/**
 * Calculate the raw average score from a set of six grade items.
 * Items left blank ("") are excluded from the average.
 * Returns 0 if no items are filled.
 */
export function calculateRawScore(scores: ScoreItems): number {
  const filledGradeScores = (Object.values(scores) as ScoreGrade[])
    .filter((g) => g !== "")
    .map((g) => GRADE_SCORE_MAP[g]);
  if (!filledGradeScores.length) return 0;
  return (
    Math.round(
      (filledGradeScores.reduce((sum, s) => sum + s, 0) / filledGradeScores.length) * 100
    ) / 100
  );
}
