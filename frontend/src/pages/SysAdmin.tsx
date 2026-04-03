/**
 * SysAdmin page — system administrator panel.
 * Account management: view, reset bindings.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import type { Account } from "../types";

export default function SysAdmin() {
  const navigate = useNavigate();
  const [toast, setToast] = useState("");

  const { data, loading, error, refetch } = useApi<Account[]>(
    () => api.get("/api/auth/accounts").then((r) => r.data)
  );

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function handleReset(account: Account) {
    if (!window.confirm(`確認要解除 ${account.name} 的帳號綁定嗎？`)) return;
    try {
      await api.post("/api/auth/reset", { targetLineUid: account.lineUid });
      showToast(`✅ 已解除 ${account.name} 的綁定`);
      refetch();
    } catch (err: any) {
      showToast(`❌ ${err.message}`);
    }
  }

  if (loading) return <div className="loading"><div className="spinner" />載入中...</div>;
  if (error) return <div className="error-page">{error}</div>;

  const accounts = data ?? [];
  const bound = accounts.filter((a) => a.status === "已授權");
  const unbound = accounts.filter((a) => a.status !== "已授權");

  return (
    <div className="page">
      <div className="header" style={{ cursor: "pointer" }} onClick={() => navigate("/")}>
        <div>
          <h1>📋 考核評分系統</h1>
          <div className="subtitle">← 系統管理員</div>
        </div>
      </div>

      <div className="admin-section">
        <h3>已綁定帳號（{bound.length} 人）</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>姓名</th>
              <th>角色</th>
              <th>職稱</th>
              <th>綁定時間</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {bound.map((a) => (
              <tr key={a.lineUid}>
                <td>{a.name}</td>
                <td>{a.role}</td>
                <td>{a.jobTitle}</td>
                <td>{a.boundAt}</td>
                <td>
                  <button
                    className="btn-danger-sm"
                    onClick={() => handleReset(a)}
                  >
                    解除綁定
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unbound.length > 0 && (
        <div className="admin-section">
          <h3>未綁定帳號（{unbound.length} 人）</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>角色</th>
                <th>職稱</th>
              </tr>
            </thead>
            <tbody>
              {unbound.map((a) => (
                <tr key={a.name}>
                  <td>{a.name}</td>
                  <td>{a.role}</td>
                  <td>{a.jobTitle}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
