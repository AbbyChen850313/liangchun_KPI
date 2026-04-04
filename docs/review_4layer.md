# 四層團隊系統審查報告
日期: 2026-04-04

---

## Layer 1: PM/UX

| 項目 | 狀態 | 說明 |
|------|------|------|
| 員工自評後端 | ✅ | `/api/scoring/self-submit`、`/api/scoring/my-self-score` 已建置 |
| 員工自評前端 | ❌ | `/self-score` 路由缺失，`App.tsx` 無此 Route → **Task 9 待補** |
| 主管評分並列自評 | ✅ | `Score.tsx` 顯示 `selfRawScore` 欄位 |
| 差異警示 ≥15 | ✅ | `diffAlerts` 在 dashboard API 已計算並回傳 |
| HR 年度調整介面 | ✅ | `/api/admin/annual-adjust` 完整 GET/POST |
| 員工儀表板 UX | ⚠️ | 同仁角色看到空白主管儀表板，應導向自評入口 |

---

## Layer 2: Architecture

| 項目 | 狀態 | 說明 |
|------|------|------|
| 分層架構 | ✅ | routes → services → SheetsService 職責清晰 |
| 評分計算純函式 | ✅ | `scoring_service.py` 無 I/O，易於單元測試 |
| 測試/正式環境隔離 | ✅ | `isTest` JWT flag 貫通所有服務 |
| Database 單點故障 | ⚠️ | Google Sheets 為唯一資料源；Quota 耗盡會全面失敗 |
| 無異步任務佇列 | ⚠️ | 所有操作同步；LINE 推播失敗不重試 |
| DRY 違反 | 🔵 | `_YEAR_PATTERN` 驗證邏輯在 `scoring.py` 和 `admin.py` 重複 3 次 |

---

## Layer 3: Dev (Security)

| 項目 | 狀態 | 說明 |
|------|------|------|
| `.notify_secret` git 洩漏 | 🔴→✅ | **已修**: `git rm --cached .notify_secret`；歷史記錄殘留需輪換 secret |
| `finalScore` 不外洩員工 | ✅ | 只在 `@require_manager` 路由回傳 |
| Section 隔離 | ✅ | `scoring.py:107-115` 驗證主管只評自己科別員工 |
| 重複送出防護 | ✅ | 409 guard on "已送出" status |
| CSV 注入防護 | ✅ | `_csv_safe()` 前置 `'` |
| Header 注入防護 | ✅ | `safe_quarter = re.sub(r"[^0-9]", "", quarter)` |
| 備註長度限制 | ✅ | `note > 500` → 400 |
| special 範圍限制 | ✅ | `-20 ≤ special ≤ 20` |
| CSRF 防護 | ❌ | Flask 無 CSRF token；POST endpoints 無雙提交 Cookie |
| JWT localStorage | ⚠️ | XSS 可讀；CSP 已設 (`default-src 'self'`) 降低風險 |
| JWT 有效期 | ⚠️ | 24 小時；建議縮短為 8 小時 + refresh token |

---

## Layer 4: QA

| 項目 | 狀態 | 說明 |
|------|------|------|
| 後端單元測試 | ✅ | `test_endpoints.py`、`test_four_seasons.py` |
| 評分計算驗證 | ✅ | `test_four_seasons.py` 模擬四季完整流程 |
| E2E 測試 | ❌ | **Task 5 待完成** |
| 員工自評前端測試 | ❌ | 前端頁面尚未建置 |
| QA Checklist | ✅ | `CLAUDE.md` 已定義 `[auto]` / `[manual]` 項目 |

---

## 行動項目（優先序）

1. **[P0] 輪換 `NOTIFY_SECRET`** — 舊值 `3edb14fc...` 已在 git 歷史，部署前必須換新值並更新 GAS
2. **[P1] 完成 Task 9** — 前端新增 `/self-score` 頁面，員工自評入口
3. **[P1] 修正 `同仁` 角色儀表板** — 應顯示自評入口而非空白主管儀表板
4. **[P2] 加入 CSRF 防護** — Flask-WTF 或 double-submit cookie
5. **[P2] DRY: 提煉 `_validated_year`** — `scoring.py` → `scoring_service.py` 共用
6. **[P3] 完成 Task 5** — E2E 測試覆蓋自評流程、HR 調整、CSV 匯出
