/**
 * SeasonScore page — select a quarter, then view and score its employees.
 * State machine: idle → loading → loaded → error
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import QuarterSelector from "../components/QuarterSelector";
import { useApi } from "../hooks/useApi";
import {
  apiGetQuarterEmployees,
  apiGetSeasonStatus,
  type QuarterEmployeesResponse,
} from "../services/api";
import type { QuarterOption, SeasonScoreStatus } from "../types";

export default function SeasonScore() {
  const navigate = useNavigate();
  const [selectedQuarter, setSelectedQuarter] = useState("");

  const {
    data: seasonStatus,
    loading: seasonLoading,
    error: seasonError,
  } = useApi<SeasonScoreStatus>(() => apiGetSeasonStatus());

  // Default to the first available quarter once season status is loaded
  useEffect(() => {
    if (seasonStatus && !selectedQuarter) {
      const firstAvailable = seasonStatus.quarters.find((q) => q.isAvailable);
      if (firstAvailable) setSelectedQuarter(firstAvailable.quarter);
    }
  }, [seasonStatus, selectedQuarter]);

  const {
    data: quarterData,
    loading: employeesLoading,
    error: employeesError,
  } = useApi<QuarterEmployeesResponse | null>(
    () =>
      selectedQuarter
        ? apiGetQuarterEmployees(selectedQuarter)
        : Promise.resolve(null),
    [selectedQuarter]
  );

  function goToScore(empName: string, section: string, isLocked: boolean) {
    const params = new URLSearchParams({
      name: empName,
      section,
      quarter: selectedQuarter,
      ...(isLocked && { isLocked: "true" }),
    });
    navigate(`/score?${params.toString()}`);
  }

  function selectedQuarterOption(): QuarterOption | undefined {
    return seasonStatus?.quarters.find((q) => q.quarter === selectedQuarter);
  }

  return (
    <div className="page">
      <div
        className="header"
        style={{ cursor: "pointer" }}
        onClick={() => navigate("/")}
      >
        <div>
          <h1>📋 考核評分系統</h1>
          <div className="subtitle">← 四季評分</div>
        </div>
      </div>

      {seasonLoading ? (
        <div className="loading">
          <div className="spinner" />
          載入季度資料…
        </div>
      ) : seasonError ? (
        <div className="error-page">{seasonError}</div>
      ) : !seasonStatus ? null : (
        <>
          <QuarterSelector
            quarters={seasonStatus.quarters}
            selected={selectedQuarter}
            onChange={setSelectedQuarter}
          />

          <SeasonProgressBar option={selectedQuarterOption()} />

          {employeesLoading ? (
            <div className="loading">
              <div className="spinner" />
              載入員工資料…
            </div>
          ) : employeesError ? (
            <div className="error-page">{employeesError}</div>
          ) : quarterData ? (
            <EmployeeList
              employees={quarterData.employees}
              isQuarterLocked={selectedQuarterOption()?.status === "已完成"}
              onSelect={goToScore}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SeasonProgressBar({ option }: { option: QuarterOption | undefined }) {
  if (!option) return null;
  const pct =
    option.totalCount > 0
      ? Math.round((option.scoredCount / option.totalCount) * 100)
      : 0;

  return (
    <div className="info-bar">
      <div className="info-row">
        <span className="info-label">季度</span>
        <span className="info-value">{option.description}</span>
      </div>
      <div className="info-row">
        <span className="info-label">狀態</span>
        <span className="info-value">{option.status}</span>
      </div>
      <div>
        <div className="info-row" style={{ marginBottom: 4 }}>
          <span className="info-label">評分進度</span>
          <span className="info-value">
            {option.scoredCount} / {option.totalCount} 人
          </span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

function EmployeeList({
  employees,
  isQuarterLocked,
  onSelect,
}: {
  employees: { name: string; dept: string; section: string; joinDate: string; scoreStatus: string }[];
  isQuarterLocked: boolean;
  onSelect: (name: string, section: string, isLocked: boolean) => void;
}) {
  if (employees.length === 0) {
    return <div className="hint-center">此季度無員工資料</div>;
  }

  return (
    <div className="employee-list">
      {employees.map((emp) => {
        const scoreStatus = emp.scoreStatus as "未評分" | "草稿" | "已送出";
        const badgeClass =
          scoreStatus === "已送出"
            ? "badge-done"
            : scoreStatus === "草稿"
            ? "badge-draft"
            : "badge-pending";

        return (
          <div
            key={emp.name}
            className="employee-card"
            onClick={() => onSelect(emp.name, emp.section, isQuarterLocked)}
          >
            <div className="emp-avatar">{emp.name.charAt(0)}</div>
            <div className="emp-info">
              <div className="emp-name">{emp.name}</div>
              <div className="emp-meta">{emp.section}</div>
            </div>
            <span className={`emp-badge ${badgeClass}`}>{scoreStatus}</span>
          </div>
        );
      })}
    </div>
  );
}
