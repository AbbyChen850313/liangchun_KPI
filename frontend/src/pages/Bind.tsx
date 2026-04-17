/**
 * Bind page — new user identity verification + LINE account binding.
 * Flow: verify bind code (optional) → fill dynamic identity fields → bind via LIFF
 *
 * Field definitions are fetched from /api/auth/bind-fields and rendered dynamically,
 * so new projects can customise identity fields without touching this component.
 */

import { useState, useEffect } from "react";
import { liffAdapter } from "../adapters/liff";
import { api } from "../services/api";

const IS_TEST = import.meta.env.VITE_IS_TEST === "true";

type Step = "choice" | "code" | "identity" | "success";

interface BindField {
  key: string;
  label: string;
  type: "text" | "select" | "phone";
  placeholder?: string;
  required?: boolean;
  options?: string[];
}

interface BindConfig {
  useVerifyCode: boolean;
  fields: BindField[];
}

const DEFAULT_CONFIG: BindConfig = {
  useVerifyCode: true,
  fields: [
    { key: "name", label: "姓名", type: "text", placeholder: "請輸入真實姓名", required: true },
    { key: "employeeId", label: "員工編號", type: "text", placeholder: "請輸入員工編號", required: true },
  ],
};

export default function Bind() {
  const [step, setStep] = useState<Step>("choice");
  const [bindConfig, setBindConfig] = useState<BindConfig>(DEFAULT_CONFIG);
  const [bindCode, setBindCode] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successName, setSuccessName] = useState("");

  // Fetch bind field config on mount (identity fields only; routing is now explicit).
  useEffect(() => {
    api
      .get<BindConfig>("/api/auth/bind-fields", { params: { isTest: IS_TEST } })
      .then(({ data }) => setBindConfig(data))
      .catch((e: any) => {
        console.warn("[Bind] fetch bind-fields failed, using defaults:", e?.message);
      });
  }, []);

  function setField(key: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleVerifyCode() {
    if (loading) return; // Prevent double-submit
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
    if (loading) return; // Prevent double-submit
    setError("");

    for (const field of bindConfig.fields) {
      if (field.required && !(fieldValues[field.key] || "").trim()) {
        setError(`請填寫${field.label}`);
        return;
      }
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
        ...Object.fromEntries(
          Object.entries(fieldValues).map(([k, v]) => [k, v.trim()])
        ),
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

  // Auto-redirect after 1.5s so user sees the success message briefly
  useEffect(() => {
    if (step !== "success") return;
    const t = setTimeout(() => { window.location.href = "/"; }, 1500);
    return () => clearTimeout(t);
  }, [step]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (step === "success") {
    return (
      <div className="page-center">
        <div className="card">
          <div className="success-icon">✅</div>
          <h2>綁定成功！</h2>
          <p>歡迎，{successName}，正在進入系統…</p>
        </div>
      </div>
    );
  }

  if (step === "identity") {
    return (
      <div className="page-center">
        <div className="card">
          <h2>帳號綁定</h2>
          <p className="hint">請輸入您的資料進行身份驗證</p>

          {bindConfig.fields.map((field) => (
            <div key={field.key}>
              <label>{field.label}</label>
              {field.type === "select" ? (
                <select
                  value={fieldValues[field.key] ?? ""}
                  onChange={(e) => setField(field.key, e.target.value)}
                >
                  <option value="">請選擇</option>
                  {(field.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === "phone" ? "tel" : "text"}
                  placeholder={field.placeholder ?? ""}
                  value={fieldValues[field.key] ?? ""}
                  onChange={(e) => setField(field.key, e.target.value)}
                />
              )}
            </div>
          ))}

          {error && <p className="error">{error}</p>}

          <button className="btn-primary" onClick={handleBind} disabled={loading}>
            {loading ? "綁定中…" : "確認綁定"}
          </button>
        </div>
      </div>
    );
  }

  if (step === "choice") {
    return (
      <div className="page-center">
        <div className="card">
          <h2>📋 考核評分系統</h2>
          <p className="hint">請選擇您的身份</p>

          <button
            className="btn-primary"
            style={{ marginBottom: "12px" }}
            onClick={() => setStep("identity")}
          >
            我是現有員工
          </button>

          <button
            className="btn-secondary"
            onClick={() => setStep("code")}
          >
            我是新入職
          </button>
        </div>
      </div>
    );
  }

  // step === "code" (新入職路徑)
  return (
    <div className="page-center">
      <div className="card">
        <h2>新入職驗證</h2>
        <p className="hint">請輸入 HR 提供的系統驗證碼</p>
        <p className="hint" style={{ fontSize: "12px", color: "#888" }}>
          <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => setStep("choice")}>
            ← 返回
          </span>
        </p>

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
