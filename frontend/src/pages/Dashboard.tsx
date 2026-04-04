/**
 * Dashboard page — employee list with scoring status.
 * Adapts rendering based on role: Manager / HR / SysAdmin.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { api, apiGetAnnualSummary } from "../services/api";
import type {
  AnnualSummaryResponse,
  AnyDashboard,
  DashboardData,
  DiffAlert,
  Employee,
  SysAdminDashboard,
} from "../types";

type Filter = "all" | "pending" | "draft" | "done" | "probation";

export default function Dashboard() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [viewAsUid, setViewAsUid] = useState("");

  const { data, loading, error } = useApi<AnyDashboard>(
    () => api.get("/api/dashboard").then((r) => r.data)
  );

  const { data: viewAsData, loading: viewAsLoading, error: viewAsError } =
    useApi<DashboardData | null>(
      () =>
        viewAsUid
          ? api
              .get(`/api/dashboard/manager?uid=${encodeURIComponent(viewAsUid)}`)
              .then((r) => r.data)
          : Promise.resolve(null),
      [viewAsUid]
    );

  if (loading) return <div className="loading"><div className="spinner" />載入中...</div>;
  if (error) return <div className="error-page">{error}</div>;
  if (!data) return null;

  // ── HR view ───────────────────────────────────────────────────────────────
  if ("isHR" in data) {
    return (
      <div className="page">
        <Header title="HR 管理後台" />
        <div className="center-action">
          <button className="btn-primary" onClick={() => navigate("/admin")}>
            ⚙️ 進入 HR 管理後台
          </button>
        </div>
      </div>
    );
  }

  // ── SysAdmin view ─────────────────────────────────────────────────────────
  if ("isSysAdmin" in data) {
    const sa = data as SysAdminDashboard;
    return (
      <div className="page">
        <Header
          title="考核評分系統"
          subtitle="系統管理員"
          right={
            <div className="sysadmin-controls">
              <select
                value={viewAsUid}
                onChange={(e) => setViewAsUid(e.target.value)}
              >
                <option value="">切換人員</option>
                {sa.accounts
                  .filter((a) => a.status === "已授權")
                  .map((a) => (
                    <option key={a.lineUid} value={a.lineUid}>
                      {a.name}
                    </option>
                  ))}
              </select>
              <button className="btn-link" onClick={() => navigate("/sysadmin")}>
                ⚙️ 管理後台
              </button>
            </div>
          }
        />

        {viewAsUid ? (
          viewAsLoading ? (
            <div className="loading"><div className="spinner" />載入中...</div>
          ) : viewAsError ? (
            <div className="error-page">{viewAsError}</div>
          ) : viewAsData ? (
            <ManagerView data={viewAsData} filter={filter} setFilter={setFilter} navigate={navigate} />
          ) : null
        ) : (
          <div className="hint-center">請選擇要切換的人員</div>
        )}
      </div>
    );
  }

  // ── Manager view ──────────────────────────────────────────────────────────
  const managerData = data as DashboardData;
  return (
    <div className="page">
      <Header title="考核評分系統" subtitle={`${managerData.quarter} 考核評分`} />
      <InfoBar data={managerData} />
      {managerData.diffAlerts.length > 0 && (
        <DiffAlertBanner alerts={managerData.diffAlerts} />
      )}
      <ManagerView data={managerData} filter={filter} setFilter={setFilter} navigate={navigate} />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Header({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="header">
      <div>
        <h1>📋 {title}</h1>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}

function InfoBar({ data }: { data: DashboardData }) {
  const pct = data.total > 0 ? Math.round((data.scored / data.total) * 100) : 0;
  const deadline = data.settings["評分截止日"];
  let deadlineText = "-";
  let daysLeft = Infinity;
  if (deadline) {
    daysLeft = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
    deadlineText = `${new Date(deadline).toLocaleDateString("zh-TW")}（剩 ${daysLeft} 天）`;
  }

  return (
    <>
      <div className="info-bar">
        <div className="info-row">
          <span className="info-label">主管</span>
          <span className="info-value">{data.managerName}</span>
        </div>
        <div className="info-row">
          <span className="info-label">評分期間</span>
          <span className="info-value">{data.settings["評分期間描述"] || "-"}</span>
        </div>
        <div className="info-row">
          <span className="info-label">截止日</span>
          <span className="info-value">{deadlineText}</span>
        </div>
        <div>
          <div className="info-row" style={{ marginBottom: 4 }}>
            <span className="info-label">評分進度</span>
            <span className="info-value">{data.scored} / {data.total} 人</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {daysLeft <= 2 && daysLeft >= 0 && (
        <div className="deadline-warning">
          ⚠️ 截止日剩 {daysLeft} 天，請盡快完成評分！
        </div>
      )}
    </>
  );
}

type ViewTab = "current" | "annual";

function ManagerView({
  data,
  filter,
  setFilter,
  navigate,
}: {
  data: DashboardData;
  filter: Filter;
  setFilter: (f: Filter) => void;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [tab, setTab] = useState<ViewTab>("current");
  const { data: annualData } = useApi<AnnualSummaryResponse | null>(
    () => (tab === "annual" ? apiGetAnnualSummary() : Promise.resolve(null)),
    [tab]
  );

  const filtered = filterEmployees(data.employees, filter);

  function goToScore(emp: Employee) {
    navigate(
      `/score?name=${encodeURIComponent(emp.name)}&section=${encodeURIComponent(emp.section)}&quarter=${encodeURIComponent(data.quarter)}`
    );
  }

  return (
    <>
      <div className="filter-bar">
        <button
          className={`filter-btn${tab === "current" ? " active" : ""}`}
          onClick={() => setTab("current")}
        >
          本季評分
        </button>
        <button
          className={`filter-btn${tab === "annual" ? " active" : ""}`}
          onClick={() => setTab("annual")}
        >
          全年總覽
        </button>
        <button
          className="filter-btn"
          onClick={() => navigate("/season-score")}
        >
          四季評分
        </button>
      </div>

      {tab === "annual" ? (
        annualData ? (
          <AnnualSummaryTable data={annualData} />
        ) : (
          <div className="loading"><div className="spinner" />載入中...</div>
        )
      ) : (
        <>
          <div className="filter-bar">
            {(["all", "pending", "draft", "done", "probation"] as Filter[]).map((f) => (
              <button
                key={f}
                className={`filter-btn${filter === f ? " active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {filterLabel(f)}
              </button>
            ))}
          </div>

          <div className="employee-list">
            {filtered.length === 0 ? (
              <div className="hint-center">無符合條件的員工</div>
            ) : (
              filtered.map((emp) => (
                <EmployeeCard key={emp.name} emp={emp} onClick={() => goToScore(emp)} />
              ))
            )}
          </div>
        </>
      )}
    </>
  );
}

function AnnualSummaryTable({ data }: { data: AnnualSummaryResponse }) {
  return (
    <div className="annual-table-wrap">
      <table className="annual-table">
        <thead>
          <tr>
            <th>員工</th>
            {data.quarters.map((q) => <th key={q}>{q.slice(-2)}</th>)}
            <th>全年加總</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(data.summary).map(([emp, row]) => (
            <tr key={emp}>
              <td>{emp}</td>
              {data.quarters.map((q) => (
                <td key={q}>
                  {row.quarters[q] != null
                    ? row.quarters[q]
                    : <span className="badge-pending">未評分</span>}
                </td>
              ))}
              <td><strong>{row.annualTotal}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmployeeCard({
  emp,
  onClick,
}: {
  emp: Employee;
  onClick: () => void;
}) {
  const badgeClass =
    emp.scoreStatus === "已送出"
      ? "badge-done"
      : emp.scoreStatus === "草稿"
      ? "badge-draft"
      : "badge-pending";

  return (
    <div
      className={`employee-card${emp.isProbation ? " probation" : ""}`}
      onClick={onClick}
    >
      <div className="emp-avatar">{emp.name.charAt(0)}</div>
      <div className="emp-info">
        <div className="emp-name">
          {emp.name}
          {emp.isProbation && (
            <span className="emp-badge badge-probation">試用期</span>
          )}
        </div>
        <div className="emp-meta">
          {emp.section} · 年資 {emp.tenure}
        </div>
      </div>
      <span className={`emp-badge ${badgeClass}`}>{emp.scoreStatus}</span>
    </div>
  );
}

function DiffAlertBanner({ alerts }: { alerts: DiffAlert[] }) {
  return (
    <div className="deadline-warning" style={{ margin: "0 0 12px" }}>
      ⚠️ {alerts.length} 筆自評 vs 主管差異 ≥ 15 分：
      {alerts.map((a) => (
        <span key={a.empName} style={{ marginLeft: 8 }}>
          {a.empName}（差 {a.diff > 0 ? "+" : ""}{a.diff.toFixed(1)}）
        </span>
      ))}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function filterEmployees(employees: Employee[], filter: Filter): Employee[] {
  switch (filter) {
    case "pending":
      return employees.filter(
        (e) => e.scoreStatus !== "已送出" && e.scoreStatus !== "草稿"
      );
    case "draft":
      return employees.filter((e) => e.scoreStatus === "草稿");
    case "done":
      return employees.filter((e) => e.scoreStatus === "已送出");
    case "probation":
      return employees.filter((e) => e.isProbation);
    default:
      return employees;
  }
}

function filterLabel(f: Filter): string {
  return { all: "全部", pending: "未評分", draft: "草稿", done: "已送出", probation: "試用期" }[f];
}
