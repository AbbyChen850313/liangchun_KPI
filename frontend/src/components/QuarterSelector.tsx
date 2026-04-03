/**
 * QuarterSelector — pure display component for selecting a quarter.
 * Shows each quarter's completion status as a badge.
 */

import type { QuarterOption } from "../types";

interface Props {
  quarters: QuarterOption[];
  selected: string;
  onChange: (quarter: string) => void;
}

const STATUS_BADGE: Record<string, string> = {
  已完成: "badge-done",
  評分中: "badge-draft",
  未開始: "badge-pending",
};

export default function QuarterSelector({ quarters, selected, onChange }: Props) {
  return (
    <div className="filter-bar">
      {quarters.map((q) => (
        <button
          key={q.quarter}
          className={`filter-btn${selected === q.quarter ? " active" : ""}`}
          onClick={() => onChange(q.quarter)}
          disabled={!q.isAvailable}
          style={!q.isAvailable ? { opacity: 0.45, cursor: "default" } : undefined}
        >
          {q.description}
          <span
            className={`emp-badge ${STATUS_BADGE[q.status] ?? "badge-pending"}`}
            style={{ marginLeft: 6, fontSize: 10 }}
          >
            {q.status}
          </span>
        </button>
      ))}
    </div>
  );
}
