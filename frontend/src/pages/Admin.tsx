/**
 * Admin page — HR management panel.
 * Tabs: 評分進度 | 系統設定 | 員工名單
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import type { Settings } from "../types";

type Tab = "progress" | "settings" | "employees";

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
        {(["progress", "settings", "employees"] as Tab[]).map((t) => (
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
  return { progress: "評分進度", settings: "系統設定", employees: "員工名單" }[t];
}
