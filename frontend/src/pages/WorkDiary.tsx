/**
 * WorkDiary page — employees write daily/weekly work logs; managers view subordinates.
 *
 * Route: /diary
 * - All roles: read/write own diary entries
 * - 主管 / HR / 系統管理員: additionally search and read any employee's diary (read-only)
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import {
  apiCreateLog,
  apiDeleteLog,
  apiGetEmployeeLogs,
  apiGetMyLogs,
  apiUpdateLog,
} from "../services/api";
import { SESSION_KEY } from "../services/authRefresh";
import type { WorkLog } from "../types";

type ManagerRole = "主管" | "HR" | "系統管理員";

function decodeRole(): string {
  const token = localStorage.getItem(SESSION_KEY);
  if (!token) return "";
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.role ?? "";
  } catch {
    return "";
  }
}

function isManagerRole(role: string): role is ManagerRole {
  return role === "主管" || role === "HR" || role === "系統管理員";
}

export default function WorkDiary() {
  const navigate = useNavigate();
  const role = decodeRole();
  const [activeTab, setActiveTab] = useState<"my" | "employee">("my");

  return (
    <div className="page">
      <div className="header">
        <div>
          <h1>📓 工作日誌</h1>
        </div>
        <button className="btn-link" onClick={() => navigate("/")}>← 返回</button>
      </div>

      {isManagerRole(role) && (
        <div className="filter-bar">
          <button
            className={`filter-btn${activeTab === "my" ? " active" : ""}`}
            onClick={() => setActiveTab("my")}
          >
            我的日誌
          </button>
          <button
            className={`filter-btn${activeTab === "employee" ? " active" : ""}`}
            onClick={() => setActiveTab("employee")}
          >
            查看員工日誌
          </button>
        </div>
      )}

      {activeTab === "my" ? <MyDiaryPanel /> : <EmployeeDiaryPanel />}
    </div>
  );
}

// ── My Diary Panel ─────────────────────────────────────────────────────────

function MyDiaryPanel() {
  const today = new Date().toISOString().slice(0, 10);
  const [editingLog, setEditingLog] = useState<WorkLog | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const { data: logs, loading, error, refetch } = useApi<WorkLog[]>(() => apiGetMyLogs());

  function openCreateForm() {
    setEditingLog(null);
    setShowForm(true);
    setSubmitError("");
  }

  function openEditForm(log: WorkLog) {
    setEditingLog(log);
    setShowForm(true);
    setSubmitError("");
  }

  async function handleSave(date: string, content: string) {
    setSubmitError("");
    try {
      if (editingLog) {
        await apiUpdateLog(editingLog.id, date, content);
      } else {
        await apiCreateLog(date, content);
      }
      setShowForm(false);
      setEditingLog(null);
      refetch();
    } catch (err: any) {
      setSubmitError(err.message ?? "儲存失敗");
    }
  }

  async function handleDelete(log: WorkLog) {
    if (!confirm(`確定要刪除 ${log.date} 的日誌？`)) return;
    try {
      await apiDeleteLog(log.id);
      refetch();
    } catch (err: any) {
      alert(err.message ?? "刪除失敗");
    }
  }

  if (loading) return <div className="loading"><div className="spinner" />載入中...</div>;
  if (error) return <div className="error-page">{error}</div>;

  return (
    <>
      {!showForm && (
        <div style={{ padding: "0 0 12px" }}>
          <button className="btn-primary" onClick={openCreateForm}>＋ 新增日誌</button>
        </div>
      )}

      {showForm && (
        <DiaryForm
          defaultDate={editingLog?.date ?? today}
          defaultContent={editingLog?.content ?? ""}
          submitLabel={editingLog ? "儲存修改" : "新增日誌"}
          errorMsg={submitError}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditingLog(null); }}
        />
      )}

      <LogList
        logs={logs ?? []}
        readOnly={false}
        onEdit={openEditForm}
        onDelete={handleDelete}
      />
    </>
  );
}

// ── Employee Diary Panel (manager/HR view) ─────────────────────────────────

function EmployeeDiaryPanel() {
  const [searchName, setSearchName] = useState("");
  const [queriedName, setQueriedName] = useState("");
  const [queryError, setQueryError] = useState("");
  const [logs, setLogs] = useState<WorkLog[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleSearch() {
    const name = searchName.trim();
    if (!name) return;
    setQueryError("");
    setLoading(true);
    try {
      const result = await apiGetEmployeeLogs(name);
      setLogs(result.logs);
      setQueriedName(result.empName);
    } catch (err: any) {
      setQueryError(err.message ?? "查詢失敗");
      setLogs([]);
      setQueriedName("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="filter-bar" style={{ alignItems: "center", gap: 8 }}>
        <input
          className="input"
          placeholder="員工姓名"
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          style={{ flex: 1, maxWidth: 200 }}
        />
        <button className="btn-primary" onClick={handleSearch} disabled={loading}>
          查詢
        </button>
      </div>

      {queryError && <p className="error">{queryError}</p>}

      {loading && <div className="loading"><div className="spinner" />載入中...</div>}

      {queriedName && !loading && (
        <>
          <p style={{ padding: "4px 0 8px", color: "#666" }}>
            {queriedName} 的工作日誌（{logs.length} 筆）
          </p>
          <LogList logs={logs} readOnly={true} />
        </>
      )}
    </>
  );
}

// ── DiaryForm ──────────────────────────────────────────────────────────────

function DiaryForm({
  defaultDate,
  defaultContent,
  submitLabel,
  errorMsg,
  onSave,
  onCancel,
}: {
  defaultDate: string;
  defaultContent: string;
  submitLabel: string;
  errorMsg: string;
  onSave: (date: string, content: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [content, setContent] = useState(defaultContent);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !content.trim()) return;
    setSaving(true);
    await onSave(date, content.trim());
    setSaving(false);
  }

  return (
    <form className="card" onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <div className="info-row" style={{ marginBottom: 8 }}>
        <label className="info-label">日期</label>
        <input
          type="date"
          className="input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          style={{ flex: 1 }}
        />
      </div>
      <div style={{ marginBottom: 8 }}>
        <textarea
          className="input"
          placeholder="記錄今日 / 本週工作內容..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={5}
          maxLength={2000}
          required
          style={{ width: "100%", resize: "vertical" }}
        />
        <div style={{ textAlign: "right", fontSize: 12, color: "#999" }}>
          {content.length} / 2000
        </div>
      </div>
      {errorMsg && <p className="error">{errorMsg}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "儲存中..." : submitLabel}
        </button>
        <button type="button" className="btn-link" onClick={onCancel}>取消</button>
      </div>
    </form>
  );
}

// ── LogList ────────────────────────────────────────────────────────────────

function LogList({
  logs,
  readOnly,
  onEdit,
  onDelete,
}: {
  logs: WorkLog[];
  readOnly: boolean;
  onEdit?: (log: WorkLog) => void;
  onDelete?: (log: WorkLog) => void;
}) {
  if (logs.length === 0) {
    return <div className="hint-center">尚無日誌記錄</div>;
  }

  return (
    <div className="employee-list">
      {logs.map((log) => (
        <LogCard
          key={log.id}
          log={log}
          readOnly={readOnly}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function LogCard({
  log,
  readOnly,
  onEdit,
  onDelete,
}: {
  log: WorkLog;
  readOnly: boolean;
  onEdit?: (log: WorkLog) => void;
  onDelete?: (log: WorkLog) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = log.content.length > 80 ? log.content.slice(0, 80) + "…" : log.content;

  return (
    <div className="employee-card" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
      <div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600 }}>{log.date}</span>
        {!readOnly && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-link" onClick={() => onEdit?.(log)}>編輯</button>
            <button className="btn-link" style={{ color: "#e53e3e" }} onClick={() => onDelete?.(log)}>刪除</button>
          </div>
        )}
      </div>
      <p
        style={{ margin: 0, whiteSpace: "pre-wrap", cursor: log.content.length > 80 ? "pointer" : "default", color: "#333" }}
        onClick={() => log.content.length > 80 && setExpanded((v) => !v)}
      >
        {expanded ? log.content : preview}
      </p>
      {log.content.length > 80 && (
        <button className="btn-link" style={{ fontSize: 12 }} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "收起" : "展開"}
        </button>
      )}
    </div>
  );
}
