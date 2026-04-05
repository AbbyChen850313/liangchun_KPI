/**
 * Admin page — HR management panel.
 * Tabs: 評分進度 | 系統設定 | 員工名單
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import type { Settings, ScoreGrade, ScoreItems, BatchScoreEntry, BatchSubmitResult, ScoreComparisonRow, AnnualAdjustRow } from "../types";

type Tab = "progress" | "settings" | "employees" | "batch" | "comparison" | "annual" | "push";

export default function Admin() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("progress");

  return (
    <div className="page">
      <div className="header" style={{ cursor: "pointer" }} onClick={() => navigate("/")}>
        <div>
          <h1>📋 考核評分系統</h1>
          <div className="subtitle">← HR 管理後台</div>
        </div>
      </div>

      <div className="tab-bar">
        {(["progress", "settings", "employees", "batch", "comparison", "annual", "push"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`tab-btn${tab === t ? " active" : ""}`}
            onClick={() => setTab(t)}
          >
            {tabLabel(t)}
          </button>
        ))}
      </div>

      {tab === "progress" && <ProgressTab />}
      {tab === "settings" && <SettingsTab />}
      {tab === "employees" && <EmployeesTab />}
      {tab === "batch" && <BatchScoringTab />}
      {tab === "comparison" && <ScoreComparisonTab />}
      {tab === "annual" && <AnnualAdjustTab />}
      {tab === "push" && <PushWizardTab />}
    </div>
  );
}

// ── Progress tab ──────────────────────────────────────────────────────────

function ProgressTab() {
  const { data, loading, error } = useApi(
    () => api.get("/api/scoring/all-status").then((r) => r.data)
  );

  if (loading) return <div className="loading"><div className="spinner" />載入中...</div>;
  if (error) return <div className="error-page">{error}</div>;

  return (
    <div className="admin-section">
      <h3>各主管評分進度</h3>
      <div className="progress-list">
        {(data as any[]).map((m: any) => {
          const pct = m.total > 0 ? Math.round((m.scored / m.total) * 100) : 0;
          return (
            <div key={m.lineUid} className="progress-row">
              <div className="progress-name">{m.managerName}</div>
              <div className="progress-count">{m.scored}/{m.total}</div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────

function SettingsTab() {
  const { data, loading, error, refetch } = useApi<Settings>(
    () => api.get("/api/admin/settings").then((r) => r.data)
  );
  const [edits, setEdits] = useState<Settings>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const EDITABLE_KEYS = [
    "當前季度",
    "評分期間描述",
    "評分開始日",
    "評分截止日",
    "試用期天數",
    "最低評分天數",
    "綁定驗證碼",
    "通知時間點1",
    "通知時間點2",
  ];

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.post("/api/admin/settings", edits);
      showToast("✅ 設定已更新");
      setEdits({});
      refetch();
    } catch (err: any) {
      showToast(`❌ ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading"><div className="spinner" />載入中...</div>;
  if (error) return <div className="error-page">{error}</div>;

  return (
    <div className="admin-section">
      <h3>系統設定</h3>
      {EDITABLE_KEYS.map((key) => (
        <div key={key} className="setting-row">
          <label>{key}</label>
          <input
            type="text"
            value={key in edits ? edits[key] : (data?.[key] ?? "")}
            onChange={(e) => setEdits((s) => ({ ...s, [key]: e.target.value }))}
          />
        </div>
      ))}
      <button className="btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? "儲存中…" : "儲存設定"}
      </button>
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

// ── Employees tab ─────────────────────────────────────────────────────────

function EmployeesTab() {
  const { data: settingsData } = useApi<Settings>(
    () => api.get("/api/admin/settings").then((r) => r.data)
  );
  const { data, loading, error, refetch } = useApi(
    () => api.get("/api/admin/employees").then((r) => r.data)
  );
  const [syncing, setSyncing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState("");
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());

  const employees: any[] = (data as any[]) ?? [];
  const allSelected = employees.length > 0 && selectedNames.size === employees.length;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedNames(new Set());
    } else {
      setSelectedNames(new Set(employees.map((e) => e.name)));
    }
  }

  function toggleEmployee(name: string) {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const { data: res } = await api.post("/api/admin/employees/sync");
      showToast(`✅ 同步完成，共 ${res.count} 位員工`);
      setSelectedNames(new Set());
      refetch();
    } catch (err: any) {
      showToast(`❌ ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }

  async function handleBatchReset() {
    const quarter = settingsData?.["當前季度"] ?? "";
    if (!quarter) { showToast("❌ 無法取得當前季度，請先設定系統設定"); return; }
    if (selectedNames.size === 0) { showToast("請先勾選要重置的員工"); return; }
    setResetting(true);
    try {
      const { data: res } = await api.post("/api/admin/batch-reset", {
        quarter,
        empNames: Array.from(selectedNames),
      });
      showToast(`✅ 已重置 ${res.resetCount} 筆評分記錄`);
    } catch (err: any) {
      showToast(`❌ ${err.message}`);
    } finally {
      setResetting(false);
    }
  }

  async function handleExportCsv() {
    const quarter = settingsData?.["當前季度"] ?? "";
    if (!quarter) { showToast("❌ 無法取得當前季度，請先設定系統設定"); return; }
    setExporting(true);
    try {
      const response = await api.get("/api/admin/export-csv", {
        params: { quarter },
        responseType: "blob",
      });
      const url = URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `scores_${quarter}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      showToast("✅ CSV 匯出完成");
    } catch (err: any) {
      showToast(`❌ ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <div className="loading"><div className="spinner" />載入中...</div>;
  if (error) return <div className="error-page">{error}</div>;

  return (
    <div className="admin-section">
      <div className="section-header">
        <h3>員工名單（{employees.length} 人）</h3>
        <button className="btn-secondary" onClick={handleSync} disabled={syncing}
          style={{ width: "auto", padding: "8px 14px", fontSize: "13px" }}>
          {syncing ? "同步中…" : "🔄 從 HR 同步"}
        </button>
      </div>

      {/* ── Bulk action bar ── */}
      <div className="bulk-bar">
        <label>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
          />
          全選（{selectedNames.size}/{employees.length}）
        </label>
        <button
          className="bulk-btn bulk-btn-reset"
          onClick={handleBatchReset}
          disabled={resetting || selectedNames.size === 0}
        >
          {resetting ? "重置中…" : "🗑 批量重置評分"}
        </button>
        <button
          className="bulk-btn bulk-btn-export"
          onClick={handleExportCsv}
          disabled={exporting}
        >
          {exporting ? "匯出中…" : "📥 匯出 CSV"}
        </button>
      </div>

      {/* ── Employee card list ── */}
      <div className="emp-card-list">
        {employees.map((emp: any) => {
          const selected = selectedNames.has(emp.name);
          return (
            <div
              key={emp.employeeId ?? emp.name}
              className="emp-card-item"
              style={{ borderLeft: selected ? "3px solid #2196f3" : "3px solid transparent", cursor: "pointer" }}
              onClick={() => toggleEmployee(emp.name)}
            >
              <div className="emp-card-row">
                <span className="emp-card-name">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleEmployee(emp.name)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginRight: 8 }}
                  />
                  {emp.name}
                </span>
                <span className="emp-card-id">{emp.employeeId}</span>
              </div>
              <div className="emp-card-meta">
                {emp.dept}・{emp.section}・到職 {emp.joinDate || "-"}
              </div>
            </div>
          );
        })}
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

// ── Push Wizard tab ───────────────────────────────────────────────────────

function PushWizardTab() {
  const { data, loading, error, refetch } = useApi<Settings>(
    () => api.get("/api/admin/settings").then((r) => r.data)
  );
  // Manager reminder dates
  const [notify1, setNotify1] = useState("");
  const [notify2, setNotify2] = useState("");
  // Employee self-assessment reminder dates
  const [empNotify1, setEmpNotify1] = useState("");
  const [empNotify2, setEmpNotify2] = useState("");

  const [savingManager, setSavingManager] = useState(false);
  const [savingEmployee, setSavingEmployee] = useState(false);
  const [triggeringManager, setTriggeringManager] = useState(false);
  const [triggeringEmployee, setTriggeringEmployee] = useState(false);
  const [toast, setToast] = useState("");

  // Sync local state from fetched settings once
  const notify1Value = notify1 !== "" ? notify1 : (data?.["通知時間點1"] ?? "");
  const notify2Value = notify2 !== "" ? notify2 : (data?.["通知時間點2"] ?? "");
  const empNotify1Value = empNotify1 !== "" ? empNotify1 : (data?.["員工通知時間點1"] ?? "");
  const empNotify2Value = empNotify2 !== "" ? empNotify2 : (data?.["員工通知時間點2"] ?? "");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  async function handleSaveManagerDates() {
    setSavingManager(true);
    try {
      await api.post("/api/admin/settings", {
        ...(notify1 !== "" ? { "通知時間點1": notify1 } : {}),
        ...(notify2 !== "" ? { "通知時間點2": notify2 } : {}),
      });
      showToast("✅ 主管通知日期已儲存");
      setNotify1("");
      setNotify2("");
      refetch();
    } catch (err: any) {
      showToast(`❌ ${err.message}`);
    } finally {
      setSavingManager(false);
    }
  }

  async function handleSaveEmployeeDates() {
    setSavingEmployee(true);
    try {
      await api.post("/api/admin/settings", {
        ...(empNotify1 !== "" ? { "員工通知時間點1": empNotify1 } : {}),
        ...(empNotify2 !== "" ? { "員工通知時間點2": empNotify2 } : {}),
      });
      showToast("✅ 員工通知日期已儲存");
      setEmpNotify1("");
      setEmpNotify2("");
      refetch();
    } catch (err: any) {
      showToast(`❌ ${err.message}`);
    } finally {
      setSavingEmployee(false);
    }
  }

  async function handleTriggerManagerNow(isTest: boolean) {
    setTriggeringManager(true);
    try {
      const { data: res } = await api.post("/api/admin/trigger-reminder", { isTest });
      showToast(`✅ 已發送提醒給 ${res.notifiedCount} 位主管`);
    } catch (err: any) {
      showToast(`❌ ${err.message}`);
    } finally {
      setTriggeringManager(false);
    }
  }

  async function handleTriggerEmployeeNow(isTest: boolean) {
    setTriggeringEmployee(true);
    try {
      const { data: res } = await api.post("/api/admin/trigger-employee-reminder", { isTest });
      showToast(`✅ 已發送自評提醒給 ${res.notifiedCount} 位員工`);
    } catch (err: any) {
      showToast(`❌ ${err.message}`);
    } finally {
      setTriggeringEmployee(false);
    }
  }

  if (loading) return <div className="loading"><div className="spinner" />載入中...</div>;
  if (error) return <div className="error-page">{error}</div>;

  const hasManagerDirty = notify1 !== "" || notify2 !== "";
  const hasEmployeeDirty = empNotify1 !== "" || empNotify2 !== "";

  return (
    <div className="admin-section">
      <h3>推播精靈</h3>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>
        設定定時提醒日期，或立即手動發送 LINE 通知。
      </p>

      {/* ── Manager reminder section ── */}
      <div style={{ background: "#f9f9f9", borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>主管評分提醒</div>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
          向所有尚未完成評分的主管發送 LINE Flex Message 提醒。
        </p>
        <div className="setting-row">
          <label>通知時間點1</label>
          <input
            type="date"
            value={notify1Value}
            onChange={(e) => setNotify1(e.target.value)}
            style={{ padding: "6px 8px", fontSize: 14 }}
          />
        </div>
        <div className="setting-row">
          <label>通知時間點2</label>
          <input
            type="date"
            value={notify2Value}
            onChange={(e) => setNotify2(e.target.value)}
            style={{ padding: "6px 8px", fontSize: 14 }}
          />
        </div>
        <button
          className="btn-primary"
          onClick={handleSaveManagerDates}
          disabled={savingManager || !hasManagerDirty}
          style={{ marginTop: 8, marginBottom: 12 }}
        >
          {savingManager ? "儲存中…" : "儲存日期設定"}
        </button>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="btn-secondary"
            onClick={() => handleTriggerManagerNow(true)}
            disabled={triggeringManager}
            style={{ flex: 1, fontSize: 13 }}
          >
            {triggeringManager ? "發送中…" : "🧪 測試發送"}
          </button>
          <button
            className="btn-primary"
            onClick={() => handleTriggerManagerNow(false)}
            disabled={triggeringManager}
            style={{ flex: 1, fontSize: 13 }}
          >
            {triggeringManager ? "發送中…" : "📣 正式發送"}
          </button>
        </div>
      </div>

      {/* ── Employee self-assessment reminder section ── */}
      <div style={{ background: "#f9f9f9", borderRadius: 8, padding: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>員工自評提醒</div>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
          向所有尚未完成自評的員工發送 LINE Flex Message 提醒。
        </p>
        <div className="setting-row">
          <label>員工通知時間點1</label>
          <input
            type="date"
            value={empNotify1Value}
            onChange={(e) => setEmpNotify1(e.target.value)}
            style={{ padding: "6px 8px", fontSize: 14 }}
          />
        </div>
        <div className="setting-row">
          <label>員工通知時間點2</label>
          <input
            type="date"
            value={empNotify2Value}
            onChange={(e) => setEmpNotify2(e.target.value)}
            style={{ padding: "6px 8px", fontSize: 14 }}
          />
        </div>
        <button
          className="btn-primary"
          onClick={handleSaveEmployeeDates}
          disabled={savingEmployee || !hasEmployeeDirty}
          style={{ marginTop: 8, marginBottom: 12 }}
        >
          {savingEmployee ? "儲存中…" : "儲存日期設定"}
        </button>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="btn-secondary"
            onClick={() => handleTriggerEmployeeNow(true)}
            disabled={triggeringEmployee}
            style={{ flex: 1, fontSize: 13 }}
          >
            {triggeringEmployee ? "發送中…" : "🧪 測試發送"}
          </button>
          <button
            className="btn-primary"
            onClick={() => handleTriggerEmployeeNow(false)}
            disabled={triggeringEmployee}
            style={{ flex: 1, fontSize: 13 }}
          >
            {triggeringEmployee ? "發送中…" : "📣 正式發送"}
          </button>
        </div>
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

function tabLabel(t: Tab): string {
  return { progress: "評分進度", settings: "系統設定", employees: "員工名單", batch: "批量評分", comparison: "雙評比較", annual: "年度調整", push: "推播精靈" }[t]!;
}

// ── Score Comparison tab ──────────────────────────────────────────────────

function ScoreComparisonTab() {
  const { data: settings } = useApi<Settings>(
    () => api.get("/api/admin/settings").then((r) => r.data)
  );
  const [quarter, setQuarter] = useState("");
  const effectiveQuarter = quarter || settings?.["當前季度"] || "";

  const { data, loading, error, refetch } = useApi<{ quarter: string; rows: ScoreComparisonRow[] }>(
    () =>
      effectiveQuarter
        ? api.get(`/api/admin/score-comparison?quarter=${encodeURIComponent(effectiveQuarter)}`).then((r) => r.data)
        : Promise.resolve(null),
    [effectiveQuarter]
  );

  const rows: ScoreComparisonRow[] = data?.rows ?? [];
  const flaggedCount = rows.filter((r) => r.flagged).length;
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const displayRows = showFlaggedOnly ? rows.filter((r) => r.flagged) : rows;

  return (
    <div className="admin-section">
      <div className="section-header">
        <h3>自評 vs 主管評分比較</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            placeholder={settings?.["當前季度"] ?? "季度，如 115Q1"}
            value={quarter}
            onChange={(e) => setQuarter(e.target.value)}
            style={{ width: 100, padding: "6px 8px", fontSize: 13 }}
          />
          <button className="btn-secondary" onClick={refetch}
            style={{ width: "auto", padding: "8px 12px", fontSize: 13 }}>
            重新載入
          </button>
          <button
            className={`btn-secondary${showFlaggedOnly ? " active" : ""}`}
            onClick={() => setShowFlaggedOnly((v) => !v)}
            style={{ width: "auto", padding: "8px 12px", fontSize: 13 }}
          >
            {showFlaggedOnly ? "顯示全部" : "僅看差異"}
          </button>
        </div>
      </div>

      {flaggedCount > 0 && (
        <div className="deadline-warning" style={{ margin: "0 0 12px" }}>
          ⚠️ 共 {flaggedCount} 筆差異 ≥ 15 分，請關注
        </div>
      )}

      {loading && <div className="loading"><div className="spinner" />載入中...</div>}
      {error && <div className="error-page">{error}</div>}
      {!loading && !error && (
        <div style={{ overflowX: "auto" }}>
          <table className="comparison-table">
            <thead>
              <tr>
                <th>員工</th>
                <th>科別</th>
                <th>主管</th>
                <th>自評分</th>
                <th>主管分</th>
                <th>差異</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "#999", padding: 20 }}>尚無資料</td></tr>
              ) : displayRows.map((row) => (
                <tr key={`${row.managerName}|${row.empName}`} className={row.flagged ? "flagged" : ""}>
                  <td>{row.empName}</td>
                  <td>{row.section}</td>
                  <td>{row.managerName}</td>
                  <td>{row.selfRawScore != null ? row.selfRawScore.toFixed(1) : "—"}</td>
                  <td>{row.managerRawScore.toFixed(1)}</td>
                  <td>
                    {row.diff != null ? (
                      <>
                        {row.diff > 0 ? "+" : ""}{row.diff.toFixed(1)}
                        {row.flagged && <span className="flag-icon">!</span>}
                      </>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Batch Scoring tab ─────────────────────────────────────────────────────

const GRADES: ScoreGrade[] = ["甲", "乙", "丙", "丁"];

function BatchScoringTab() {
  const { data: settings } = useApi<Settings>(
    () => api.get("/api/admin/settings").then((r) => r.data)
  );
  const { data: statusData, loading } = useApi(
    () => api.get("/api/scoring/all-status").then((r) => r.data)
  );
  const { data: employees } = useApi(
    () => api.get("/api/admin/employees").then((r) => r.data)
  );
  const { data: responsibilities } = useApi(
    () => api.get("/api/admin/responsibilities").then((r) => r.data)
  );

  const [quarter, setQuarter] = useState("");
  const [entries, setEntries] = useState<Record<string, Partial<BatchScoreEntry>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BatchSubmitResult | null>(null);
  const [toast, setToast] = useState("");

  function rowKey(managerName: string, empName: string) {
    return `${managerName}|${empName}`;
  }

  function setGrade(key: string, item: string, grade: ScoreGrade) {
    setEntries((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        scores: { ...(prev[key]?.scores ?? emptyScores()), [item]: grade } as ScoreItems,
      },
    }));
  }

  const candidateRows: Array<{ managerName: string; managerLineUid: string; empName: string; section: string }> = [];
  if (statusData && employees && responsibilities) {
    const respMap: Record<string, any[]> = {};
    (responsibilities as any[]).forEach((r: any) => {
      respMap[r.lineUid] = [...(respMap[r.lineUid] ?? []), r];
    });
    (statusData as any[]).forEach((mgr: any) => {
      const myResp = respMap[mgr.lineUid] ?? [];
      const mySections = new Set(myResp.map((r: any) => r.section));
      (employees as any[])
        .filter((e: any) => mySections.has(e.section))
        .forEach((e: any) => {
          candidateRows.push({
            managerName: mgr.managerName,
            managerLineUid: mgr.lineUid,
            empName: e.name,
            section: e.section,
          });
        });
    });
  }

  async function handleSubmit() {
    const q = quarter || settings?.["當前季度"] || "";
    if (!q) { setToast("❌ 請先選擇或確認當前季度"); return; }

    const payload: BatchScoreEntry[] = candidateRows
      .map((row) => {
        const key = rowKey(row.managerName, row.empName);
        const entry = entries[key];
        return {
          ...row,
          scores: (entry?.scores ?? emptyScores()) as ScoreItems,
          special: 0,
          note: "",
        };
      })
      .filter((e) => Object.values(e.scores).every((v) => v !== ""));

    if (!payload.length) { setToast("❌ 尚無填寫完整的評分"); return; }

    setSubmitting(true);
    try {
      const { data } = await api.post("/api/admin/batch-submit", { quarter: q, entries: payload });
      setResult(data);
      setToast(`✅ 送出完成：${data.submitted} 筆成功，${data.failed.length} 筆失敗`);
    } catch (err: any) {
      setToast(`❌ ${err.message}`);
    } finally {
      setSubmitting(false);
      setTimeout(() => setToast(""), 4000);
    }
  }

  if (loading) return <div className="loading"><div className="spinner" />載入中...</div>;

  return (
    <div className="admin-section">
      <div className="section-header">
        <h3>批量評分代理</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            placeholder={settings?.["當前季度"] ?? "季度，如 115Q1"}
            value={quarter}
            onChange={(e) => setQuarter(e.target.value)}
            style={{ width: 100, padding: "6px 8px", fontSize: 13 }}
          />
          <button className="btn-primary" onClick={handleSubmit} disabled={submitting}
            style={{ width: "auto", padding: "8px 16px" }}>
            {submitting ? "送出中…" : "批量送出"}
          </button>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              <th style={thStyle}>主管</th>
              <th style={thStyle}>員工</th>
              <th style={thStyle}>科別</th>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <th key={i} style={thStyle}>項目{i}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {candidateRows.map((row) => {
              const key = rowKey(row.managerName, row.empName);
              const rowScores = entries[key]?.scores ?? emptyScores();
              const allFilled = Object.values(rowScores).every((v) => v !== "");
              return (
                <tr key={key} style={{ borderBottom: "1px solid #eee", background: allFilled ? "#f0fff4" : "white" }}>
                  <td style={tdStyle}>{row.managerName}</td>
                  <td style={tdStyle}>{row.empName}</td>
                  <td style={tdStyle}>{row.section}</td>
                  {[1, 2, 3, 4, 5, 6].map((i) => {
                    const itemKey = `item${i}` as keyof ScoreItems;
                    return (
                      <td key={i} style={tdStyle}>
                        <select
                          value={rowScores[itemKey]}
                          onChange={(e) => setGrade(key, itemKey, e.target.value as ScoreGrade)}
                          style={{ fontSize: 13, padding: "2px 4px" }}
                        >
                          <option value="">-</option>
                          {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {result && result.failed.length > 0 && (
        <div className="error-page" style={{ marginTop: 12 }}>
          <strong>失敗明細：</strong>
          <ul>
            {result.failed.map((f, i) => (
              <li key={i}>{f.empName}：{f.error}</li>
            ))}
          </ul>
        </div>
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

// ── Annual Adjust tab ─────────────────────────────────────────────────────

function AnnualAdjustTab() {
  const { data: settings } = useApi<Settings>(
    () => api.get("/api/admin/settings").then((r) => r.data)
  );
  const defaultYear = (settings?.["當前季度"] ?? "").slice(0, 3);
  const [year, setYear] = useState("");
  const effectiveYear = year || defaultYear;

  const { data, loading, error, refetch } = useApi<{ year: string; rows: AnnualAdjustRow[] }>(
    () =>
      effectiveYear
        ? api.get(`/api/admin/annual-adjust?year=${encodeURIComponent(effectiveYear)}`).then((r) => r.data)
        : Promise.resolve(null),
    [effectiveYear]
  );

  const [edits, setEdits] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  async function handleSave(empName: string) {
    const special = edits[empName] ?? 0;
    setSaving(empName);
    try {
      await api.post("/api/admin/annual-adjust", { year: effectiveYear, empName, special });
      showToast(`✅ ${empName} 年度調整已儲存`);
      refetch();
    } catch (err: any) {
      showToast(`❌ ${err.message}`);
    } finally {
      setSaving(null);
    }
  }

  const rows: AnnualAdjustRow[] = data?.rows ?? [];

  return (
    <div className="admin-section">
      <div className="section-header">
        <h3>年度調整</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            placeholder={defaultYear || "年份，如 115"}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            style={{ width: 80, padding: "6px 8px", fontSize: 13 }}
          />
          <button className="btn-secondary" onClick={refetch}
            style={{ width: "auto", padding: "8px 12px", fontSize: 13 }}>
            重新載入
          </button>
        </div>
      </div>

      {loading && <div className="loading"><div className="spinner" />載入中...</div>}
      {error && <div className="error-page">{error}</div>}
      {!loading && !error && (
        <div style={{ overflowX: "auto" }}>
          <table className="comparison-table">
            <thead>
              <tr>
                <th>員工</th>
                <th>已完成季數</th>
                <th>年度平均分</th>
                <th>HR 加減分</th>
                <th>最終年度分</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "#999", padding: 20 }}>尚無資料</td></tr>
              ) : rows.map((row) => {
                const displaySpecial = edits[row.empName] ?? row.annualSpecial;
                const displayFinal = row.annualAvg + displaySpecial;
                const isDirty = row.empName in edits;
                return (
                  <tr key={row.empName}>
                    <td style={tdStyle}>{row.empName}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{row.completedCount} / 4</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{row.annualAvg.toFixed(2)}</td>
                    <td style={tdStyle}>
                      <input
                        type="number"
                        step="0.5"
                        min={-20}
                        max={20}
                        value={displaySpecial}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [row.empName]: Number(e.target.value) }))}
                        style={{ width: 70, padding: "3px 6px", fontSize: 13, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: isDirty ? 600 : 400 }}>
                      {displayFinal.toFixed(2)}
                    </td>
                    <td style={tdStyle}>
                      <button
                        className="btn-primary"
                        onClick={() => handleSave(row.empName)}
                        disabled={saving === row.empName || !isDirty}
                        style={{ width: "auto", padding: "4px 12px", fontSize: 12 }}
                      >
                        {saving === row.empName ? "儲存中…" : "儲存"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: "6px 10px" };

function emptyScores(): ScoreItems {
  return { item1: "", item2: "", item3: "", item4: "", item5: "", item6: "" };
}
