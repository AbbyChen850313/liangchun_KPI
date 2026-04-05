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

type Step = "code" | "identity" | "success";

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
  const [step, setStep] = useState<Step>("code");
  const [bindConfig, setBindConfig] = useState<BindConfig>(DEFAULT_CONFIG);
  const [bindCode, setBindCode] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successName, setSuccessName] = useState("");

  // Fetch bind field config on mount; also check whether to skip verify-code step.
  useEffect(() => {
    api
      .get<BindConfig>("/api/auth/bind-fields", { params: { isTest: IS_TEST } })
      .then(({ data }) => {
        setBindConfig(data);
        if (!data.useVerifyCode) setStep("identity");
      })
      .catch(() => {
        // Keep defaults on error
      });

    const storedToken = sessionStorage.getItem("line_bind_token");
    if (!storedToken) return;

    api
      .get("/api/auth/bind-check", {
        params: { bindToken: storedToken, isTest: IS_TEST },
      })
      .then(({ data }) => {
        if (data.inEmployeeList) setStep("identity");
      })
      .catch(() => {});
  }, []);

  function setField(key: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }

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
