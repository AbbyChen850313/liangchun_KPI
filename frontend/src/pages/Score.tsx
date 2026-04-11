/**
 * Score page — fill in the 6 scoring items for one employee.
 */

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import { refreshRole } from "../services/authRefresh";
import type { ScoreItem, ScoreItems, ScoreRecord } from "../types";
import {
  POST_SUBMIT_REDIRECT_MS,
  SCORE_GRADES,
  TOAST_DISMISS_MS,
} from "../constants/scoring";
import { calculateRawScore } from "../utils/scoring";

export default function Score() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const empName = decodeURIComponent(params.get("name") ?? "");
  const section = decodeURIComponent(params.get("section") ?? "");
  const quarter = decodeURIComponent(params.get("quarter") ?? "");
  const isLocked = params.get("isLocked") === "true";
  const actAs = decodeURIComponent(params.get("actAs") ?? "");

  const [scores, setScores] = useState<ScoreItems>({
    item1: "", item2: "", item3: "",
    item4: "", item5: "", item6: "",
  });
  const [special, setSpecial] = useState(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  // AC1: refresh role on every Score page mount (covers SPA navigation where useLiff does not re-run)
  useEffect(() => {
    refreshRole();
  }, []);

  // Load score items definitions
  const { data: scoreItems } = useApi<ScoreItem[]>(
    () => api.get("/api/scoring/items").then((r) => r.data)
  );

  // Load existing scores for this employee (scoped to the correct quarter)
  const { data: myScores } = useApi<Record<string, ScoreRecord>>(
    () => api.get(`/api/scoring/my-scores${quarter ? `?quarter=${encodeURIComponent(quarter)}` : ""}`).then((r) => r.data),
    [quarter]
  );

  const historyYear = quarter ? quarter.slice(0, 3) : "";
  const { data: empHistory } = useApi<{ empName: string; year: string; quarters: Record<string, number | null> }>(
    () =>
      empName && historyYear
        ? api.get(`/api/scoring/employee-history?empName=${encodeURIComponent(empName)}&year=${encodeURIComponent(historyYear)}`).then((r) => r.data)
        : Promise.resolve(null),
    [empName, historyYear]
  );

  // Pre-fill existing scores — must be declared before any early return (Rules of Hooks)
  useEffect(() => {
    if (myScores?.[empName]) {
      const existing = myScores[empName];
      setScores(existing.scores);
      setSpecial(existing.special ?? 0);
      setNote(existing.note ?? "");
    }
  }, [myScores, empName]);

  // Guard: empName is required — without it we cannot load or submit scores.
  // Placed after all hooks to comply with Rules of Hooks.
  if (!empName) {
    return (
      <div className="page-center">
        <div className="card">
          <p className="error">⚠️ 缺少員工參數，請從主畫面選擇員工後再進入此頁。</p>
          <button className="btn-primary" onClick={() => navigate("/")}>返回主畫面</button>
        </div>
      </div>
    );
  }


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
      const endpoint = submit ? "/api/scoring/submit" : "/api/scoring/draft";
      await api.post(endpoint, {
        empName,
        section,
        scores,
        special,
        note,
        ...(quarter && { quarter }),
        ...(actAs && { actAs }),
      });
      showToast(submit ? "✅ 評分已送出" : "💾 草稿已儲存");
      if (submit) setTimeout(() => navigate("/"), POST_SUBMIT_REDIRECT_MS);
    } catch (saveErr: any) {
      showToast(`❌ ${saveErr.message}`);
    } finally {
      setSaving(false);
    }
  }

  const rawScore = calculateRawScore(scores);
  const finalScore = rawScore + special;
  const selfScores = myScores?.[empName]?.selfScores ?? null;
  const selfRawScore = myScores?.[empName]?.selfRawScore ?? null;

  return (
    <div className="page">
      <div className="header" style={{ cursor: "pointer" }} onClick={() => navigate("/")}>
        <div>
          <h1>📋 考核評分系統</h1>
          <div className="subtitle">← 返回</div>
        </div>
      </div>

      <div className="score-card">
        <div className="score-emp-header">
          <div className="emp-avatar large">{empName.charAt(0)}</div>
          <div>
            <div className="emp-name">{empName}</div>
            <div className="emp-meta">{section}</div>
          </div>
        </div>

        {empHistory?.quarters && (
          <div className="history-strip">
            <div className="history-strip-title">本年加權分歷史</div>
            <div className="history-strip-quarters">
              {Object.entries(empHistory.quarters).map(([q, score]) => (
                <div
                  key={q}
                  className={`history-chip${q === quarter ? " current" : ""}`}
                >
                  <span className="history-chip-label">{q.slice(-2)}</span>
                  <span className="history-chip-score">
                    {score != null ? score.toFixed(1) : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isLocked && (
          <div className="deadline-warning" style={{ margin: "12px 0 0" }}>
            此季度已全員完成評分，僅供檢視。
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
                  {selfScores && (
                    <div className="self-grade-display">
                      <span className="self-grade-label">自評</span>
                      <span className={`self-grade-chip grade-${selfScores[key]}`}>
                        {selfScores[key] || "—"}
                      </span>
                    </div>
                  )}
                  <div className="grade-buttons">
                    {SCORE_GRADES.map((g) => (
                      <button
                        key={g}
                        className={`grade-btn${scores[key] === g ? " selected" : ""}`}
                        onClick={() => !isLocked && setScores((s) => ({ ...s, [key]: g }))}
                        disabled={isLocked}
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

        <div className="score-special">
          <label>特殊加減分</label>
          <input
            type="number"
            step="1"
            value={special}
            onChange={(e) => !isLocked && setSpecial(Number(e.target.value))}
            readOnly={isLocked}
          />
        </div>

        <div className="score-note">
          <label>備註</label>
          <textarea
            rows={3}
            placeholder="選填"
            maxLength={500}
            value={note}
            onChange={(e) => !isLocked && setNote(e.target.value)}
            readOnly={isLocked}
          />
        </div>

        <div className="score-summary">
          {selfRawScore != null && (
            <div className="score-row">
              <span>員工自評均分</span>
              <span>{selfRawScore.toFixed(1)}</span>
            </div>
          )}
          <div className="score-row">
            <span>原始平均分</span>
            <span>{rawScore || "-"}</span>
          </div>
          <div className="score-row">
            <span>特殊加減分</span>
            <span>{special >= 0 ? `+${special}` : special}</span>
          </div>
          <div className="score-row total">
            <span>調整後分數</span>
            <span>{rawScore ? finalScore.toFixed(2) : "-"}</span>
          </div>
        </div>

        {!isLocked && (
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
              ✅ 送出評分
            </button>
          </div>
        )}
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

