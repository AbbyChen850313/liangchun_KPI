---
name: Cycle 1 發現的坑
description: KPI系統第一輪四層審查過程中發現的缺陷、異常、與修復經歷
type: project
---

## 坑 1: Gspread 429 錯誤未處理 [RESOLVED]

**發現者：** QA / Dev 實施階段

**現象：** 
- 批量操作（batch-submit、sync-employees）時隨機出現 HTTP 429（Too Many Requests）
- 錯誤訊息：`gspread.exceptions.APIError: 429 - Quota exceeded`
- 發生在 Google Sheets API 高並發場景

**根本原因：**
- 初期未實作重試機制，Sheets API quota 耗盡時直接拋錯
- Google Sheets 配額 = 300 req/user/min，多用戶同時操作會觸發限制

**修復：**
- 實作 `_with_retry()` 函數，指數退避重試（1s → 2s → 4s）
- 捕捉 gspread.exceptions.APIError，檢查 status_code 是否為 429/503
- 應用於所有 Sheets 讀寫操作（via `SheetsService` 包裝）

**文件變更：**
- `flask_backend/services/sheets_service.py` (L78-97 新增 `_with_retry`)
- `flask_backend/app.py` 所有 sheets.<method> 呼叫自動經過 _with_retry

**預防措施：**
- 明確在 requirements.txt 記錄 gspread 版本以確保例外處理一致
- 定期監控 Cloud Logging 中的 429 出現頻率

---

## 坑 2: 跨部門權限驗證遺漏 [P0 SECURITY] [RESOLVED]

**發現者：** Security 審查階段

**現象：**
- 主管 A（銷售部）可提交主管 B（人資部）的員工評分
- 員工列表驗證缺失 → 無法檢驗「員工是否真的屬於該科別」
- 只驗證了「主管是否有該科別權限」，但沒驗證「員工是否在該科別」

**根本原因：**
- 開發時遺漏了數據完整性邊界檢查
- Sheets 中有多份員工清單（HR 記錄 vs 權重表），未進行交叉驗證

**修復：**
- 在 `_upsert_score()` 中新增雙重驗證：
  1. `manager_sections = {r["section"] for r in responsibilities if r["lineUid"] == line_uid}`
  2. `section_employee_names = {e["name"] for e in all_employees if e["section"] == section}`
  3. 檢驗 `emp_name in section_employee_names`

**文件變更：**
- `flask_backend/routes/scoring.py` (L83-92 新增雙重驗證)
- `flask_backend/services/scoring_service.py` (無變更，驗證邏輯在 route layer)

**測試修復：**
- `flask_backend/tests/test_endpoints.py` 新增 P0-1 用例：
  - test_score_submit_cross_dept_forbidden：主管A評分主管B的員工 → 403
  - test_score_submit_employee_not_in_section：員工不屬於該科別 → 403

**預防措施：**
- 在 Security 審查清單中加入「權限邊界」檢查項
- 每次涉及跨表驗證的操作都必須 Security 過目

---

## 坑 3: CSV 注入（Excel 公式執行）[RESOLVED]

**發現者：** Security 審查階段

**現象：**
- 員工備註中若包含 `=cmd|'/c calc'!A1` 或 `@SUM(...)` 等前缀
- 導出 CSV 後用 Excel 打開會直接執行公式
- 導致資訊洩漏或命令執行風險

**根本原因：**
- 批量導出 CSV 時未對用戶輸入進行編碼
- Excel/LibreOffice 視 `=, +, -, @` 開頭的字符串為公式

**修復：**
- 在 `routes/admin.py` 新增 `_csv_safe()` 函數
  - 檢驗字符串首字符是否為 `=, +, -, @, \t, \r`
  - 若是，前綴加上單引號 `'` → Excel 視為字符串，不執行
- 應用於所有 CSV 導出行（get_employee_csv、get_score_csv）

**文件變更：**
- `flask_backend/routes/admin.py` (L20-28 新增 `_csv_safe`, L? L? 應用於導出)

**測試修復：**
- `flask_backend/tests/test_endpoints.py` 新增用例：
  - test_csv_export_formula_injection：備註含 `=...` → 檢驗導出時被加單引號

**預防措施：**
- Security 審查時檢查所有涉及用戶輸入的導出功能
- 定期掃描 OWASP Top 10

---

## 坑 4: 測試環境 gspread mock 缺失 [RESOLVED]

**發現者：** QA 測試執行階段

**現象：**
- pytest 執行時拋 AttributeError：`module 'gspread' has no attribute 'exceptions'`
- 測試環境的 gspread mock 未正確包含 exceptions 子模組

**根本原因：**
- 測試 stub 在 `conftest.py` 中 mock 了 gspread，但沒 mock `gspread.exceptions.APIError`
- `_with_retry()` 試圖捕捉 `gspread.exceptions.APIError` 時失敗

**修復：**
- 在 `tests/conftest.py` (或相關 fixture) 中補全 mock：
  ```python
  mock_gspread.exceptions = Mock()
  mock_gspread.exceptions.APIError = gspread.exceptions.APIError
  ```
- 或改用 `patch('gspread.exceptions.APIError')`

**文件變更：**
- `flask_backend/tests/test_endpoints.py` (fixture 補全)

**預防措施：**
- Mock 外部模組時必須 mock 其所有被引用的子模組
- 在 Dev QA 移交前先跑一次本地 pytest

---

## 坑 5: Rate Limit 邊界情況 [PARTIAL RESOLVED]

**發現者：** QA 與 Dev 實施階段

**現象：**
- verify-code 端點需要嚴格限制（防暴力破解），但初期沒配置
- session 端點被限制後，正常用戶切換網絡時觸發限制

**根本原因：**
- Rate limit 配置粗糙：要麼全部 opt-in、要麼全部有限制
- 沒有區分「認證敏感」與「查詢無害」的端點

**修復（部分）：**
- `routes/auth.py` 中 verify-code 端點加 `@limiter.limit("5 per minute")`
- session 端點保持無限制（opt-in 架構）

**遺留問題：**
- ⚠️ 其他 admin 端點的 rate limit 邊界值未確定（需業務確認）
- batch-submit 是否應該有限制？（目前無）

**文件變更：**
- `flask_backend/routes/auth.py` (verify-code 加 `@limiter.limit(...)`)

**預防措施：**
- 在 Security 審查清單中加入「rate limit 覆蓋率」檢查
- 定期審計 admin 端點是否需要限制

---

## 坑 6: 測試用例資料不完整 [RESOLVED]

**發現者：** QA 測試執行階段

**現象：**
- P0-1 交叉部門驗證用例中，fixture 提供的 mock worksheet 資料不完整
- 缺少 `section_employee_names` 或權重表資料，導致用例失敗

**根本原因：**
- 新增驗證邏輯後，test fixture 未同步更新
- `conftest.py` 中的 mock sheets 資料不包含所有必要的工作表

**修復：**
- 補全 fixture：添加 mock employees 工作表（包含 section 欄位）
- P0-1 用例中提供完整的 test data：
  - Manager A 有 sales section 權限
  - Employee X 屬於 sales section
  - Employee Y 屬於 hr section
  
**文件變更：**
- `flask_backend/tests/conftest.py` (fixture 補全)
- `flask_backend/tests/test_endpoints.py` (P0-1 用例補全)

**預防措施：**
- 在 Dev 向 QA 移交時，同時提交 test data 變更清單
- QA 執行前檢查 fixture 版本與代碼匹配

---

## 坑 7: 未處理的邊界情況

**列表（非本輪修復，需後續評估）：**

| 編號 | 坑 | 優先級 | 影響 | 建議 |
|------|-----|--------|------|------|
| 7.1 | Push message failure 無重試 | P1 | LINE 通知可能丟失 | 實作 push_message retry |
| 7.2 | Bind 時員工編號不存在 | P2 | 允許綁定無效員工 | 在 bind 時驗證 employeeId 在 HR 記錄中存在 |
| 7.3 | 批量操作無原子性 | P3 | 部分失敗無法回滾 | 考慮分區事務（per-quarter） |
| 7.4 | 緩存 TTL 10s 仍可能不同步 | P2 | 極端並發下數據重複或遺漏 | 實作 worksheet-level lock 或 last-write-wins |

