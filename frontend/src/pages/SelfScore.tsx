/**
 * SelfScore page — employee fills in their own 6-item self-assessment.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useAutoSave } from "../hooks/useAutoSave";
import { api } from "../services/api";
import type { ScoreItem, ScoreItems, SelfScoreRecord } from "../types";
import {
  POST_SUBMIT_REDIRECT_MS,
  SCORE_GRADES,
  TOAST_DISMISS_MS,
} from "../constants/scoring";
import { calculateRawScore } from "../utils/scoring";

export default function SelfScore() {
  const navigate = useNavigate();

  const [scores, setScores] = useState<ScoreItems>({
    item1: "", item2: "", item3: "",
    item4: "", item5: "", item6: "",
  });
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [dirty, setDirty] = useState(false);

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


  // Silent draft save for auto-save (no toast).
  async function saveSelfDraftSilently() {
    if (saving) return;
    await api.post("/api/scoring/self-draft", { scores, note });
  }

  const isSubmitted = existing?.status === "已送出";

  const { lastSavedAt } = useAutoSave(
    saveSelfDraftSilently,
    [scores, note],
    !dirty || isSubmitted
  );

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), TOAST_DISMISS_MS);
  }

  async function handleSave(submit: boolean) {
    if (saving) return; // Prevent double-submit

    if (submit) {
      const missingItemKeys = Object.entries(scores)
        .filter(([, grade]) => !grade)
        .map(([itemKey]) => itemKey);
      if (missingItemKeys.length) {
        showToast(`請填寫所有評分項目（缺少：${missingItemKeys.join(", ")}）`);
        return;
      }
    }

    setSaving(true);
    try {
      const endpoint = submit ? "/api/scoring/self-submit" : "/api/scoring/self-draft";
      await api.post(endpoint, { scores, note });
      showToast(submit ? "✅ 自評已送出" : "💾 草稿已儲存");
      if (submit) setTimeout(() => navigate("/"), POST_SUBMIT_REDIRECT_MS);
    } catch (saveErr: any) {
      showToast(`❌ ${saveErr.message}`);
    } finally {
      setSaving(false);
    }
  }

  const rawScore = calculateRawScore(scores);

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
                    {SCORE_GRADES.map((g) => (
                      <button
                        key={g}
                        className={`grade-btn${scores[key] === g ? " selected" : ""}`}
                        onClick={() => { if (!isSubmitted) { setScores((s) => ({ ...s, [key]: g })); setDirty(true); } }}
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
            onChange={(e) => { if (!isSubmitted) { setNote(e.target.value); setDirty(true); } }}
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
        {lastSavedAt && (
          <div style={{ fontSize: "0.75rem", color: "#9ca3af", textAlign: "center", marginTop: 6 }}>
            已自動儲存 {lastSavedAt.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
