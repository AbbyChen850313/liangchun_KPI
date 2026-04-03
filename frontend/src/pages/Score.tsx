/**
 * Score page — fill in the 6 scoring items for one employee.
 */

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import { refreshRole } from "../services/authRefresh";
import type { ScoreGrade, ScoreItem, ScoreItems } from "../types";

const GRADES: ScoreGrade[] = ["甲", "乙", "丙", "丁"];
const GRADE_SCORES: Record<ScoreGrade, number> = {
  甲: 95,
  乙: 85,
  丙: 65,
  丁: 35,
  "": 0,
};

export default function Score() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const empName = decodeURIComponent(params.get("name") ?? "");
  const section = decodeURIComponent(params.get("section") ?? "");
  const quarter = decodeURIComponent(params.get("quarter") ?? "");

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
  const { data: myScores } = useApi<Record<string, any>>(
    () => api.get(`/api/scoring/my-scores${quarter ? `?quarter=${encodeURIComponent(quarter)}` : ""}`).then((r) => r.data),
    [quarter]
  );

  // Pre-fill existing scores
  useEffect(() => {
    if (myScores?.[empName]) {
      const existing = myScores[empName];
      setScores(existing.scores);
      setSpecial(existing.special ?? 0);
      setNote(existing.note ?? "");
    }
  }, [myScores, empName]);

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
      const endpoint = submit ? "/api/scoring/submit" : "/api/scoring/draft";
      await api.post(endpoint, {
        empName,
        section,
        scores,
        special,
        note,
        ...(quarter && { quarter }),
      });
      showToast(submit ? "✅ 評分已送出" : "💾 草稿已儲存");
      if (submit) setTimeout(() => navigate("/"), 1200);
    } catch (err: any) {
      showToast(`❌ ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  const rawScore = calcRaw();
  const finalScore = rawScore + special;

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
                <div className="grade-buttons">
                  {GRADES.map((g) => (
                    <button
                      key={g}
                      className={`grade-btn${scores[key] === g ? " selected" : ""}`}
                      onClick={() => setScores((s) => ({ ...s, [key]: g }))}
                    >
                      {g}
                    </button>
                  ))}
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
            onChange={(e) => setSpecial(Number(e.target.value))}
          />
        </div>

        <div className="score-note">
          <label>備註</label>
          <textarea
            rows={3}
            placeholder="選填"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="score-summary">
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
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

