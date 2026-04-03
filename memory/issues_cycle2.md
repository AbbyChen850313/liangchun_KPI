---
name: Cycle 2 發現的坑
description: KPI系統四季評分實現週期的缺陷、異常、與修復經歷
type: project
---

## 坑 1: Quarter 參數未傳遞導致評分混淆 [RESOLVED]

**發現者：** QA 測試執行階段

**現象：**
- 評分時未指定 quarter，系統默認寫到 Q1_Scores 表
- 測試 Q2/Q3 評分時，數據被誤寫入 Q1，導致季度數據污染

**根本原因：**
- 初期開發時 quarter 參數為可選，未在路由層強制驗證
- 前端某些舊調用點（admin 頁面批量操作）忘記傳遞 quarter

**修復：**
- 在 `flask_backend/routes/scoring.py` 中：
  - 所有 scoring endpoint 檢查 `quarter` 必傳 → 缺失時拋 400
  - 驗證 quarter 值必須在 Q1-Q4 之間
- 前端側（`src/pages/Admin.tsx`）：所有 API 呼叫補上 quarter 參數
  - batch-submit: `POST /api/scores/batch-submit?quarter=Q1&isTest=...`
  - get-scores: `GET /api/scores/Q1?isTest=...`

**文件變更：**
- `flask_backend/routes/scoring.py` (L15-25 參數驗證)
- `frontend/src/pages/Admin.tsx` (L50+ API 呼叫補 quarter)
- `frontend/src/pages/SeasonScore.tsx` (所有 API 呼叫改為 /api/scores/{quarter})

**測試修復：**
- 新增 `test_four_seasons.py` → AC1 測試四季提交，確保數據正確隔離

**預防措施：**
- 在 router 層使用 FastAPI/Flask 的自動參數驗證（Pydantic）
- 定期 linting 檢查 API 呼叫是否有遺漏參數

---

## 坑 2: Annual Summary 計算時序錯誤 [RESOLVED]

**發現者：** QA 測試執行階段

**現象：**
- batch-submit 後年度加總仍為 0（應為四季評分的加總）
- 後續編輯季度評分時年度加總不更新（應保持 snapshot）

**根本原因：**
- _compute_annual_summary() 在 batch-submit 前執行，此時 submitted 的記錄還未寫入
- 年度加總邏輯誤用了 draft 表而非 submitted 表

**修復：**
- 調整執行順序：
  1. 先 upsert 評分到季度表 → status = draft
  2. 遍歷季度表找所有 status = draft 的記錄
  3. 設定 status = submitted，移動到 _submitted_backup
  4. 最後計算年度加總（sum 所有 submitted 記錄）
- `flask_backend/services/scoring_service.py` (L150+)：
  ```python
  def batch_submit(quarter, manager_uid, scores_list, isTest):
    # 1. Upsert 所有 draft 評分
    # 2. 查詢 submitted 評分
    submitted_scores = [s for s in read_quarter_scores(quarter) if s['status'] == 'submitted']
    # 3. 計算年度加總（只基於 submitted）
    annual_sum = sum(s['score'] for s in submitted_scores)
  ```

**文件變更：**
- `flask_backend/services/scoring_service.py` (L100-200 batch_submit 邏輯重構)
- `flask_backend/tests/test_four_seasons.py` (AC2 年度加總測試)

**測試修復：**
- AC2：提交 Q1 50分、Q2 60分、Q3 70分、Q4 80分 → annual_summary = 260 ✓

**預防措施：**
- 在設計表單邏輯時先畫 state machine 圖，確保轉移順序正確
- 每個寫操作後立即 query 驗證

---

## 坑 3: 草稿覆蓋已提交評分 [RESOLVED]

**發現者：** QA 與 Dev 協作測試

**現象：**
- 主管 A 提交了 Q1 評分（status = submitted）
- 之後再編輯該評分時，原本的 submitted 被覆蓋為 draft
- 無法追溯原始提交版本

**根本原因：**
- upsert 邏輯無狀態檢查，所有 put/post 都無條件覆蓋
- 缺少「已提交評分不可編輯」的防守

**修復：**
- 在 `_upsert_score()` 中添加狀態檢查：
  ```python
  existing = get_score_by_emp(emp_name, quarter)
  if existing and existing['status'] == 'submitted':
    raise ValueError(f"Cannot edit submitted score for {emp_name}")
  # 只有 draft 狀態才可更新
  ```
- API 回傳 403 Forbidden，前端禁用已提交行的編輯按鈕

**文件變更：**
- `flask_backend/routes/scoring.py` (L70-85 狀態檢查)
- `frontend/src/pages/SeasonScore.tsx` (isEditable = status !== 'submitted')

**測試修復：**
- 新增測試：`test_score_submitted_readonly`
  - 提交 Q1 評分
  - 嘗試編輯 → 403
  - 驗證原始評分未被修改

**預防措施：**
- 所有寫操作前都要問一次「這個記錄的當前狀態允許修改嗎」
- 在前端 UI 層反映狀態（灰顯已提交行）

---

## 坑 4: Employee List 版本不同步 [RESOLVED]

**發現者：** QA 實施 AC4（員工清單測試）

**現象：**
- Q1_Scores 中可以評分「張三」
- Q2 時「張三」因離職被移出 HR_Employees_Q2
- 但 batch-submit 時系統允許評分一個已不在 Q2 名單的員工

**根本原因：**
- 員工驗證邏輯：檢查 `emp_name in HR_Employees_Q1` 而非當前 quarter 的名單
- 跨季度驗證缺失

**修復：**
- 在評分驗證時明確指定季度：
  ```python
  def validate_employee_in_quarter(emp_name, quarter):
    valid_emps = get_quarter_employees(quarter)  # 讀取 HR_Employees_{quarter} 表
    if emp_name not in valid_emps:
      raise EmployeeNotInQuarterError(f"{emp_name} not in {quarter}")
  ```
- 應用於所有評分寫操作（upsert 和 batch-submit）

**文件變更：**
- `flask_backend/services/sheets_service.py` (L200+ get_quarter_employees)
- `flask_backend/routes/scoring.py` (L60+ validate_employee_in_quarter 呼叫)

**測試修復：**
- AC4：
  - 設定 HR_Employees_Q1 = [Alice, Bob, Charlie]
  - 設定 HR_Employees_Q2 = [Alice, Bob, Diana]（Charlie 離職）
  - Q1 評分 Charlie 成功 ✓
  - Q2 評分 Charlie 失敗 (403) ✓

**預防措施：**
- 在評分業務邏輯中明確紀錄「評分對象來自哪個季度的名單」
- 定期對帳：比對 Sheets 中 Q1-Q4 員工名單是否有遺漏/重複

---

## 坑 5: 季度評分狀態界面混亂 [RESOLVED]

**發現者：** QA 與 PM/UX 協作（AC3 季別狀態測試）

**現象：**
- 首頁「季別狀態」欄位混雜了 Q1-Q4 的狀態，無法清晰區分
- 用戶不知道「哪個季度完成了，哪個還在草稿」
- 批量提交時無法確認提交的是哪個季度的數據

**根本原因：**
- 前端 Dashboard 曾試圖在單一表格中展示所有季度狀態 → 版面混亂
- 後端 API 返回格式不清晰（status 欄缺少 quarter 上下文）

**修復：**
- 前端：QuarterSelector 改為 Tabs，每個 Tab 獨立展示該季度的評分狀態
  - Q1 tab：顯示 Q1 所有員工的草稿/已提交狀態
  - Q2 tab：顯示 Q2 所有員工的草稿/已提交狀態
  - 等等
- 後端 API 格式改為：
  ```json
  {
    "quarter": "Q1",
    "scores": [
      { "emp_name": "Alice", "score": 85, "status": "submitted" },
      { "emp_name": "Bob", "score": 90, "status": "draft" }
    ],
    "summary": { "submitted": 1, "draft": 1, "total": 2 }
  }
  ```

**文件變更：**
- `frontend/src/components/QuarterSelector.tsx` (改為 Tabs UI)
- `flask_backend/routes/scoring.py` (L200+ GET /api/scores/{quarter} 回傳新格式)
- `frontend/src/pages/Dashboard.tsx` (AC3 季別狀態改用新格式)

**測試修復：**
- AC3：提交 Q1、草稿 Q2-Q4 → Dashboard 清晰展示各季度狀態 ✓

**預防措施：**
- 在設計複雜 UI 時，優先用「多視圖」而非「單一表格多維度」
- API 設計時明確攜帶 context（quarter、status、timestamp）

---

## 坑 6: 歷史記錄四季齊全驗證缺失 [RESOLVED]

**發現者：** QA 測試 AC6（歷史記錄）

**現象：**
- 用戶查看歷史記錄時只能看到部分季度的評分記錄
- 系統未驗證「歷史記錄是否四季齊全」就允許查詢

**根本原因：**
- 歷史記錄讀取邏輯未檢查四季 submitted 狀態
- 如果某季度 submit 失敗或遺漏，用戶無法及時發現

**修復：**
- 添加歷史完整性檢查函數：
  ```python
  def get_history_with_validation():
    # 檢查四季是否都 submitted
    quarters = ['Q1', 'Q2', 'Q3', 'Q4']
    for q in quarters:
      submitted_count = count(status='submitted' where quarter=q)
      if submitted_count == 0:
        return { "error": f"{q} not submitted yet" }
    # 四季都齊全，返回加總歷史
    return { "quarters": [Q1, Q2, Q3, Q4], "annual_summary": ... }
  ```
- API 回傳：
  - 若四季不齊全 → HTTP 206 Partial Content
  - 在回應中標記「缺少 Q2 Q4」
  - 前端顯示警告「尚未完成所有季度評分」

**文件變更：**
- `flask_backend/routes/scoring.py` (L300+ GET /api/history 新增驗證)
- `frontend/src/pages/Dashboard.tsx` (歷史區塊加 warning badge)

**測試修復：**
- AC6：
  - 僅提交 Q1 Q3 → 歷史查詢回 206，告知「缺少 Q2 Q4」✓
  - 四季都提交後 → 歷史查詢回 200，顯示完整加總 ✓

**預防措施：**
- 引入「完整性檢查」作為所有批量操作的前置條件
- 定期定時驗證：使用 Cloud Scheduler 每週檢查未完成的年度考績，推通知給 HR

---

## 坑 7: 測試/正式環境 LIFF 混淆 [PARTIALLY RESOLVED]

**發現者：** Dev 本地測試

**現象：**
- 本地開發時誤用了正式 LIFF_ENDPOINT
- 測試 token 無法在正式 LIFF URL 通過驗證
- 新功能測試時卡在 LIFF 認證階段

**根本原因：**
- VITE_IS_TEST 環境變數不一致
- cloudbuild 沒有區分 main（正式）和 test（測試）分支的 build config

**修復：**
- 前端環境變數管理：
  - 本地開發：`.env.local` 明確設 `VITE_IS_TEST=true`
  - CI/CD：
    - Branch = test → cloudbuild 注入 VITE_IS_TEST=true
    - Branch = main → cloudbuild 注入 VITE_IS_TEST=false
- 編譯時驗證：若 VITE_IS_TEST 未設定，build 失敗並提示設置方法

**文件變更：**
- `cloudbuild-frontend.yaml` (substitutions 區分 main/test branch)
- `frontend/.env.example` (新增 VITE_IS_TEST=true 說明)
- `frontend/vite.config.ts` (build 時驗證 VITE_IS_TEST 已設定)

**預防措施：**
- 在 LIFF 初始化時打 console.log 告知當前環境 (test/prod)
- 在前端顯示「測試環境」badge，視覺上明確環境身分

**遺留問題：**
- ⚠️ 舊環境变量 LIFF_ENDPOINT 應該完全移除（已廢用），改用環境分支判斷

---

## 未解決的邊界情況

| 編號 | 坑 | 優先級 | 影響 | 建議 |
|------|-----|--------|------|------|
| 8.1 | 同季度多次批提交 | P2 | 後提交覆蓋前提交 | 在 batch-submit 前檢查季度是否已有 submitted 記錄，拒絕重複提交 |
| 8.2 | 跨季度評分者權限變化 | P2 | 用戶 Q1 時有某科別權限，Q2 被撤回，但 Q1 評分仍可見 | 加入「權限快照」，記錄評分時的權限狀態 |
| 8.3 | 員工重複評分（同評分者） | P1 | 同一主管對同一員工在同季度評兩次 | 在 upsert 時用 (emp_name, manager_uid, quarter) 作唯一鍵 |
| 8.4 | 大量並發季度切換 | P3 | 若 10+ 用戶同時切換季度，Sheets API quota 瞬間耗盡 | 考慮頻率限制或 cache 優化（目前 10s TTL 可應對） |

---

## 測試驗證清單

本輪通過以下 AC 驗證：
- **AC1**：四季提交 — 每個季度獨立評分，數據不混淆 ✓
- **AC2**：年度加總 — 四季評分正確加總，快照不變 ✓
- **AC3**：季別狀態 — Dashboard 清晰展示各季度草稿/已提交狀態 ✓
- **AC4**：員工清單 — 不同季度員工名單不同，評分時驗證有效性 ✓
- **AC5**：草稿不覆蓋已送出 — 提交後無法編輯，狀態保護 ✓
- **AC6**：歷史記錄四季齊全 — 查詢前驗證四季都已提交，缺失時告知 ✓

**累計測試：** 47 tests pass, 0 failures

