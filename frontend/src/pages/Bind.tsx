/**
 * Bind page — new user identity verification + LINE account binding.
 * Flow: verify bind code → enter name + employeeId → bind via LIFF access token
 */

import { useState, useEffect } from "react";
import { liffAdapter } from "../adapters/liff";
import { api } from "../services/api";

const IS_TEST = import.meta.env.VITE_IS_TEST === "true";

type Step = "code" | "identity" | "success";

export default function Bind() {
  const [step, setStep] = useState<Step>("code");
  const [bindCode, setBindCode] = useState("");
  const [name, setName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successName, setSuccessName] = useState("");

  // On mount: if a bind token exists, check whether this LINE display name is
  // already in the employee list — if so, skip the verify-code step.
  useEffect(() => {
    const storedToken = sessionStorage.getItem("line_bind_token");
    if (!storedToken) return;

    api
      .get("/api/auth/bind-check", {
        params: { bindToken: storedToken, isTest: IS_TEST },
      })
      .then(({ data }) => {
        if (data.inEmployeeList) setStep("identity");
      })
      .catch(() => {
        // On error keep the default "code" step
      });
  }, []);

  async function handleVerifyCode() {
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/api/auth/verify-code", {
        code: bindCode.trim(),
        isTest: IS_TEST,
      });
      if (data.valid) {
        setStep("identity");
      } else {
        setError("驗證碼不正確，請聯繫 HR 取得正確驗證碼");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleBind() {
    setError("");
    if (!name.trim() || !employeeId.trim()) {
      setError("請填寫姓名與員工編號");
      return;
    }

    // Resolve LINE identity: LIFF token (inside LINE) or bind token (external browser)
    const isLineApp = /Line\//i.test(navigator.userAgent);
    const accessToken = isLineApp ? liffAdapter.getAccessToken() : null;
    const bindToken = !isLineApp ? sessionStorage.getItem("line_bind_token") : null;

    if (!accessToken && !bindToken) {
      setError("LINE 身份驗證遺失，請重新整理頁面");
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post("/api/auth/bind", {
        ...(accessToken ? { accessToken } : { bindToken }),
        name: name.trim(),
        employeeId: employeeId.trim(),
        isTest: IS_TEST,
      });

      sessionStorage.removeItem("line_bind_token");
      setSuccessName(data.name);
      setStep("success");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function goDashboard() {
    window.location.href = "/";
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (step === "success") {
    return (
      <div className="page-center">
        <div className="card">
          <div className="success-icon">✅</div>
          <h2>綁定成功！</h2>
          <p>歡迎，{successName}，您的帳號已成功綁定。</p>
          <button className="btn-primary" onClick={goDashboard}>
            進入考核評分系統
          </button>
        </div>
      </div>
    );
  }

  if (step === "identity") {
    return (
      <div className="page-center">
        <div className="card">
          <h2>帳號綁定</h2>
          <p className="hint">請輸入您的姓名與員工編號進行身份驗證</p>

          <label>姓名</label>
          <input
            type="text"
            placeholder="請輸入真實姓名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <label>員工編號</label>
          <input
            type="text"
            placeholder="請輸入員工編號"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          />

          {error && <p className="error">{error}</p>}

          <button className="btn-primary" onClick={handleBind} disabled={loading}>
            {loading ? "綁定中…" : "確認綁定"}
          </button>
        </div>
      </div>
    );
  }

  // step === "code"
  return (
    <div className="page-center">
      <div className="card">
        <h2>📋 考核評分系統</h2>
        <p className="hint">請輸入 HR 提供的系統驗證碼</p>

        <label>驗證碼</label>
        <input
          type="text"
          placeholder="例：HR0000"
          value={bindCode}
          onChange={(e) => setBindCode(e.target.value)}
        />

        {error && <p className="error">{error}</p>}

        <button className="btn-primary" onClick={handleVerifyCode} disabled={loading}>
          {loading ? "驗證中…" : "下一步"}
        </button>
      </div>
    </div>
  );
}
