/**
 * Admin page — HR management panel.
 * Tabs: 評分進度 | 系統設定 | 員工名單
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import type { Settings, ScoreGrade, ScoreItems, BatchScoreEntry, BatchSubmitResult } from "../types";

type Tab = "progress" | "settings" | "employees" | "batch";

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
        {(["progress", "settings", "employees", "batch"] as Tab[]).map((t) => (
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

function tabLabel(t: Tab): string {
  return { progress: "評分進度", settings: "系統設定", employees: "員工名單", batch: "批量評分" }[t];
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

const thStyle: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: "6px 10px" };

function emptyScores(): ScoreItems {
  return { item1: "", item2: "", item3: "", item4: "", item5: "", item6: "" };
}
