/**
 * ManagerBatch page — supervisor batch scoring in table mode.
 * Pre-fills all employees with 乙 for quick entry; manager adjusts as needed.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import type { BatchSubmitResult, ScoreGrade, ScoreItems } from "../types";
import { TOAST_DISMISS_MS } from "../constants/scoring";

const GRADES: ScoreGrade[] = ["甲", "乙", "丙", "丁"];

const DEFAULT_GRADE: ScoreGrade = "乙";

function emptyScores(): ScoreItems {
  return { item1: "", item2: "", item3: "", item4: "", item5: "", item6: "" };
}

interface QuarterEmployeesResponse {
  quarter: string;
  employees: Array<{ name: string; section: string; scoreStatus: string }>;
}

type ScoreMap = Record<string, ScoreItems>;
type NoteMap = Record<string, string>;

export default function ManagerBatch() {
  const navigate = useNavigate();

  const { data, loading, error } = useApi<QuarterEmployeesResponse>(
    () => api.get("/api/scoring/quarter-employees").then((r) => r.data)
  );

  const [scores, setScores] = useState<ScoreMap>({});
  const [notes, setNotes] = useState<NoteMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BatchSubmitResult | null>(null);
  const [toast, setToast] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), TOAST_DISMISS_MS);
  }

  function getScores(empName: string): ScoreItems {
    return scores[empName] ?? emptyScores();
  }

  function setGrade(empName: string, item: keyof ScoreItems, grade: ScoreGrade) {
    setScores((prev) => ({
      ...prev,
      [empName]: { ...(prev[empName] ?? emptyScores()), [item]: grade },
    }));
  }

  function fillAllWithDefault() {
    if (!data) return;
    setScores((prev) => {
      const next = { ...prev };
      data.employees.forEach((emp) => {
        if (emp.scoreStatus !== "已送出") {
          // Only fill items that are still empty
          const current = next[emp.name] ?? emptyScores();
          const filled: ScoreItems = { ...current };
          (Object.keys(filled) as Array<keyof ScoreItems>).forEach((k) => {
            if (!filled[k]) filled[k] = DEFAULT_GRADE;
          });
          next[emp.name] = filled;
        }
      });
      return next;
    });
    showToast("已將空白項目填入乙等");
  }

  async function handleSubmit() {
    if (submitting || !data) return; // Prevent double-submit

    const entries = data.employees
      .filter((emp) => emp.scoreStatus !== "已送出")
      .map((emp) => ({
        empName: emp.name,
        section: emp.section,
        scores: scores[emp.name] ?? emptyScores(),
        special: 0,
        note: notes[emp.name] ?? "",
      }))
      .filter((e) => Object.values(e.scores).every((v) => v !== ""));

    if (!entries.length) {
      showToast("❌ 尚無填寫完整的評分（請先點「預設乙等」或逐一填寫）");
      return;
    }

    setSubmitting(true);
    try {
      const { data: res } = await api.post("/api/scoring/manager-batch-submit", {
        quarter: data.quarter,
        entries,
      });
      setResult(res);
      showToast(`✅ 送出完成：${res.submitted} 筆成功，${res.failed.length} 筆失敗`);
    } catch (err: any) {
      showToast(`❌ ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="loading"><div className="spinner" />載入中...</div>;
  if (error) return <div className="error-page">{error}</div>;
  if (!data) return null;

  const pendingEmployees = data.employees.filter((e) => e.scoreStatus !== "已送出");
  const doneCount = data.employees.length - pendingEmployees.length;

  return (
    <div className="page">
      <div className="header" style={{ cursor: "pointer" }} onClick={() => navigate("/")}>
        <div>
          <h1>📋 考核評分系統</h1>
          <div className="subtitle">← 返回</div>
        </div>
      </div>

      <div className="admin-section">
        <div className="section-header">
          <div>
            <h3>批次評分（{data.quarter}）</h3>
            <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>
              待評分 {pendingEmployees.length} 人 · 已完成 {doneCount} 人
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              className="btn-secondary"
              onClick={fillAllWithDefault}
              style={{ width: "auto", padding: "8px 14px", fontSize: 13 }}
            >
              預設乙等快速填入
            </button>
            <button
              className="btn-primary"
              onClick={handleSubmit}
              disabled={submitting}
              style={{ width: "auto", padding: "8px 16px", fontSize: 13 }}
            >
              {submitting ? "送出中…" : "批量送出"}
            </button>
          </div>
        </div>

        {data.employees.length === 0 ? (
          <div className="hint-center">目前沒有需要評分的員工</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  <th style={thStyle}>員工</th>
                  <th style={thStyle}>科別</th>
                  <th style={thStyle}>狀態</th>
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <th key={i} style={thStyle}>項目{i}</th>
                  ))}
                  <th style={thStyle}>備註</th>
                </tr>
              </thead>
              <tbody>
                {data.employees.map((emp) => {
                  const locked = emp.scoreStatus === "已送出";
                  const empScores = getScores(emp.name);
                  const allFilled = Object.values(empScores).every((v) => v !== "");
                  return (
                    <tr
                      key={emp.name}
                      style={{
                        borderBottom: "1px solid #eee",
                        background: locked ? "#f9f9f9" : allFilled ? "#f0fff4" : "white",
                        opacity: locked ? 0.6 : 1,
                      }}
                    >
                      <td style={tdStyle}>{emp.name}</td>
                      <td style={tdStyle}>{emp.section}</td>
                      <td style={tdStyle}>
                        <span className={`emp-badge ${
                          emp.scoreStatus === "已送出" ? "badge-done"
                          : emp.scoreStatus === "草稿" ? "badge-draft"
                          : "badge-pending"
                        }`}>
                          {emp.scoreStatus}
                        </span>
                      </td>
                      {[1, 2, 3, 4, 5, 6].map((i) => {
                        const itemKey = `item${i}` as keyof ScoreItems;
                        return (
                          <td key={i} style={tdStyle}>
                            <select
                              value={empScores[itemKey]}
                              onChange={(e) => setGrade(emp.name, itemKey, e.target.value as ScoreGrade)}
                              disabled={locked}
                              style={{ fontSize: 13, padding: "2px 4px" }}
                            >
                              <option value="">-</option>
                              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                            </select>
                          </td>
                        );
                      })}
                      <td style={tdStyle}>
                        <input
                          type="text"
                          maxLength={100}
                          value={notes[emp.name] ?? ""}
                          onChange={(e) => setNotes((prev) => ({ ...prev, [emp.name]: e.target.value }))}
                          disabled={locked}
                          placeholder="選填"
                          style={{ fontSize: 12, padding: "2px 6px", width: 100 }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

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
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: "6px 10px" };
