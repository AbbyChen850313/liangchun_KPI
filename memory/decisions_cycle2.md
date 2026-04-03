---
name: Cycle 2 架構決策
description: KPI系統四季評分實現週期的架構選擇、放棄的替代方案、與決策理由
type: project
---

## 決策 1: 四季評分隔離模型（Quarter-Based Isolation）

**決策：** 使用 Quarter 作為評分作用域單位，不同季度評分互相獨立存儲與計算

**理由：**
- HR 需求：每季年度考績獨立進行，評分標準/評分者可能變化
- 數據完整性：防止跨季度評分互相覆蓋（A 改了 Q1 的評分不影響 Q2）
- 查詢效率：按季度分批讀 Sheets，減少單次查詢負擔

**放棄的替代方案：**
- 全局評分表：無法區分季度，修改時無法追溯歷史
- 時間戳版本控制：複雜度高，難以維護線性歷史
- 完全無狀態（計算型）：無法記錄評分者決策過程

**實現：**
- Sheets 側：每季度獨立 worksheet（Q1_Scores, Q2_Scores, Q3_Scores, Q4_Scores）
- API 側：所有 scoring API 接受 `quarter` 參數，路由到對應 worksheet
- 前端側：QuarterSelector 組件控制季度切換

**文件：**
- `flask_backend/routes/scoring.py` (L10-50 quarter 參數驗證)
- `frontend/src/components/QuarterSelector.tsx` (React 季度選擇器)
- `frontend/src/pages/SeasonScore.tsx` (季度評分專頁)

---

## 決策 2: 年度加總快照模式（Annual Summary Snapshot）

**決策：** 年度加總是四季評分的只讀快照（由 batch-submit 觸發一次性計算）

**理由：**
- 合規需求：年度考績應在「全部季度提交完成」後才生成，不能邊改邊加總
- 防止數據不一致：快照確保「這份年度總結基於哪個時間點的季度評分」可追溯
- 簡化計算：年度加總邏輯單純（sum 四季評分），不需複雜增量更新

**放棄的替代方案：**
- 實時計算：每次編輯季度評分時計算年度加總 → 低效且易出現部分計算
- 觸發器模式（webhook）：Sheets 不支援 webhook，需額外中間層
- 分布式鎖：過度設計，當前規模不需

**實現：**
- API: `POST /api/scores/batch-submit` 中額外調用 `_compute_annual_summary()`
- 防護：在 batch-submit 前檢查四季是否都已經有有效評分
- 只讀：前端年度總結頁面無編輯功能，防止手動修改

**文件：**
- `flask_backend/routes/scoring.py` (L150-200 batch-submit 邏輯)
- `flask_backend/services/scoring_service.py` (L100-150 _compute_annual_summary)
- `frontend/src/pages/Dashboard.tsx` (年度加總只讀展示)

---

## 決策 3: 評分狀態機（Scoring State Machine）

**決策：** 評分生命周期遵循 draft → submitted → history 三態，草稿不覆蓋已提交

**理由：**
- UX 需求：評分者可能「草稿儲存」多次，但一旦提交不應被覆蓋
- 審計追蹤：區分「草稿版本」和「正式提交版本」，便於事後調查
- 防止誤操作：避免用戶不小心覆蓋已提交的評分

**放棄的替代方案：**
- 無狀態：所有評分一律覆蓋 → 易誤操作，無審計線索
- 版本控制表：複雜度高，query 時需 JOIN 多表
- 軟刪除：只標記刪除而不清理 → 磁盤浪費，查詢需加過濾

**實現：**
- Sheets 側：評分表新增 `status` 欄（draft / submitted）
- API 邏輯：
  - PUT 更新：只能更新 status=draft 的評分
  - POST submit：批量設 status=submitted，移動到 history worksheet
- 前端側：已提交評分顯示「已提交」標記，禁用編輯

**文件：**
- `flask_backend/routes/scoring.py` (L50-80 狀態檢查)
- `flask_backend/tests/test_four_seasons.py` (狀態遷移測試)

---

## 決策 4: 員工清單版本化（Employee List Versioning by Quarter）

**決策：** 每季度維護一份員工清單快照，評分時只能評該季度有效員工

**理由：**
- 組織變化：員工可能在年度中途入職/離職，評分時需對應該季度的有效名單
- 數據完整性：防止「評分一個根本不屬於該季度的員工」
- 合規需求：年度考績需明確「該年度評分對象是誰」

**放棄的替代方案：**
- 全年固定員工名單：無法應對人事變動
- 當前動態名單：無法追溯歷史（員工A 在 Q1 評了，Q2 離職，無法追蹤）
- 完全去中心化（前端選員工）：易被繞過，安全風險

**實現：**
- Sheets 側：HR_Employees_Q1, HR_Employees_Q2 等表
- API 側：提交評分前檢查 `emp_name in HR_Employees_{quarter}`
- 前端側：QuarterSelector 改變時，employee list 重新從 API 讀取

**文件：**
- `flask_backend/services/sheets_service.py` (L200+ get_quarter_employees)
- `frontend/src/pages/SeasonScore.tsx` (季度切換時重新讀員工)

---

## 決策 5: LIFF 測試環境路由（LIFF_ENDPOINT 環境變數）

**決策：** 使用 `VITE_IS_TEST` 環境變數控制 LIFF_ENDPOINT，區分測試/正式 LIFF URL

**理由：**
- 開發流程：測試環境需測試 LIFF 流程，但不能污染正式 LIFF token
- 隔離原則：LINE bot 正式帳號與測試帳號應完全隔離
- 快速迭代：開發者無需手動切換 URL，build 時自動選擇

**放棄的替代方案：**
- 運行時動態判斷：增加 API 調用，延遲 LIFF 初始化
- 本地 mock：無法測試真實 LINE Webhook 流程
- 手動切換環境變數：容易忘記，易推到錯環境

**實現：**
- 前端 build：`VITE_IS_TEST=true npm run build` → LIFF_ENDPOINT 指向測試
- 後端：API 檢查 isTest query param，路由到 test/prod sheets
- CI/CD：cloudbuild 根據 branch (test vs. main) 自動設定 VITE_IS_TEST

**文件：**
- `frontend/src/adapters/liff.ts` (LIFF_ENDPOINT 選擇邏輯)
- `cloudbuild-frontend.yaml` (VITE_IS_TEST 環境變數注入)
- `flask_backend/config.py` (isTest 參數處理)

---

## 跨決策影響分析

| 決策 | 依賴關係 | 被依賴者 | 耦合度 | 備註 |
|------|---------|---------|--------|------|
| 四季隔離 | 無 | 年度加總、評分狀態機 | 高 | 所有評分 API 都需傳遞 quarter |
| 年度加總快照 | 四季隔離、評分狀態機 | 無 | 中 | 必須在全季度 submitted 才能觸發 |
| 評分狀態機 | 四季隔離 | 年度加總、員工清單版本化 | 高 | status 欄影響所有查詢 |
| 員工清單版本化 | 四季隔離 | 評分狀態機、安全驗證 | 中 | 評分前檢查員工有效性 |
| LIFF 路由 | 無 | 前端所有 API 呼叫 | 低 | 獨立開發測試環境 |

---

## 核心設計權衡

### 1. 一致性 vs 性能
- **選擇**：一致性優先（四季隔離、快照模式）
- **理由**：HR 考績系統要求數據準確，暫時性能開銷可接受（1000+ 員工 × 4 季度仍在 API quota 內）

### 2. 簡化 vs 靈活性
- **選擇**：簡化優先（三態機、只讀快照）
- **理由**：減少狀態組合爆炸，便於測試與維運

### 3. 中心化驗證 vs 邊界驗證
- **選擇**：中心化（API 側驗證員工）
- **理由**：安全考量，不信任前端數據

---

## 未來影響

- **縱向擴展**：若引入多年度支持，需考慮 Year 維度拆分（Year_Q1_Scores 等）
- **橫向擴展**：若多公司共用此系統，需加 company_id 隔離層
- **架構演進**：後續若引入複雜評分規則（加權、自定義維度），可考慮策略模式或狀態模式重構

