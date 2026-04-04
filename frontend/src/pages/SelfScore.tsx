/**
 * SelfScore page — employee fills in their own 6-item self-assessment.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import type { ScoreGrade, ScoreItem, ScoreItems, SelfScoreRecord } from "../types";

const GRADES: ScoreGrade[] = ["甲", "乙", "丙", "丁"];
const GRADE_SCORES: Record<ScoreGrade, number> = {
  甲: 95,
  乙: 85,
  丙: 65,
  丁: 35,
  "": 0,
};

export default function SelfScore() {
  const navigate = useNavigate();

  const [scores, setScores] = useState<ScoreItems>({
    item1: "", item2: "", item3: "",
    item4: "", item5: "", item6: "",
  });
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const { data: scoreItems } = useApi<ScoreItem[]>(
    () => api.get("/api/scoring/items").then((r) => r.data)
  );

  const { data: existing } = useApi<SelfScoreRecord | null>(
    () => api.get("/api/scoring/my-self-score").then((r) => r.data)
  );

  // Pre-fill saved scores
  useEffect(() => {
    if (existing) {
      setScores(existing.scores);
      setNote(existing.note ?? "");
    }
  }, [existing]);

  function calcRaw(): number {
    const vals = (Object.values(scores) as ScoreGrade[])
      .filter((g) => g !== "")
      .map((g) => GRADE_SCORES[g]);
    if (!vals.length) return 0;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  const isSubmitted = existing?.status === "已送出";

  async function handleSave(submit: boolean) {
    if (submit) {
      const missing = Object.entries(scores)
        .filter(([, v]) => !v)
        .map(([k]) => k);
      if (missing.length) {
        showToast(`請填寫所有評分項目（缺少：${missing.join(", ")}）`);
        return;
      }
    }

    setSaving(true);
    try {
      const endpoint = submit ? "/api/scoring/self-submit" : "/api/scoring/self-draft";
      await api.post(endpoint, { scores, note });
      showToast(submit ? "✅ 自評已送出" : "💾 草稿已儲存");
      if (submit) setTimeout(() => navigate("/"), 1200);
    } catch (err: any) {
      showToast(`❌ ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  const rawScore = calcRaw();

  return (
    <div className="page">
      <div className="header" style={{ cursor: "pointer" }} onClick={() => navigate("/")}>
        <div>
          <h1>📋 考核自評</h1>
          <div className="subtitle">← 返回</div>
        </div>
      </div>

      <div className="score-card">
        {isSubmitted && (
          <div className="deadline-warning" style={{ margin: "0 0 12px" }}>
            自評已送出，僅供檢視。
          </div>
        )}

        {existing && (
          <div className="info-bar" style={{ marginBottom: 12 }}>
            <div className="info-row">
              <span className="info-label">季度</span>
              <span className="info-value">{existing.quarter}</span>
            </div>
            <div className="info-row">
              <span className="info-label">狀態</span>
              <span className="info-value">{existing.status}</span>
            </div>
          </div>
        )}

        <div className="score-items">
          {!scoreItems ? (
            <div className="loading-hint">載入評分項目中…</div>
          ) : scoreItems.map((item, idx) => {
            const key = `item${idx + 1}` as keyof ScoreItems;
            return (
              <div key={item.code} className="score-item">
                <div className="score-item-name">{item.name}</div>
                {item.description && (
                  <div className="score-item-desc">{item.description}</div>
                )}
                <div className="score-item-row">
                  <div className="grade-buttons">
                    {GRADES.map((g) => (
                      <button
                        key={g}
                        className={`grade-btn${scores[key] === g ? " selected" : ""}`}
                        onClick={() => !isSubmitted && setScores((s) => ({ ...s, [key]: g }))}
                        disabled={isSubmitted}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="score-note">
          <label>備註</label>
          <textarea
            rows={3}
            placeholder="選填"
            maxLength={500}
            value={note}
            onChange={(e) => !isSubmitted && setNote(e.target.value)}
            readOnly={isSubmitted}
          />
        </div>

        <div className="score-summary">
          <div className="score-row total">
            <span>自評均分</span>
            <span>{rawScore || "-"}</span>
          </div>
        </div>

        {!isSubmitted && (
          <div className="score-actions">
            <button
              className="btn-secondary"
              onClick={() => handleSave(false)}
              disabled={saving}
            >
              💾 儲存草稿
            </button>
            <button
              className="btn-primary"
              onClick={() => handleSave(true)}
              disabled={saving}
            >
              ✅ 送出自評
            </button>
          </div>
        )}
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
