---
name: Cycle 1 架構決策
description: KPI系統第一輪四層審查的架構選擇、放棄的替代方案、與決策理由
type: project
---

## 決策 1: Rate Limiting 單例化（flask-limiter）

**決策：** 在 `extensions.py` 創建 limiter 單例，預設無全局限制，路由opt-in via `@limiter.limit(...)`

**理由：** 
- 防止 API 濫用，特別是認證端點（verify-code 暴力破解、bind 大量嘗試）
- 不同路由有不同限制需求（verify-code 需嚴格限制，get-settings 無需限制）

**放棄的替代方案：**
- 全局 rate limit：太粗糙，會限制正常用戶
- 無限制：安全風險，易被暴力破解
- 應用層自實現計數器：重複造輪子，flask-limiter 已有 Redis/Memory 支援

**文件：** `flask_backend/extensions.py` (L10)

---

## 決策 2: Gspread 429/503 重試機制（_with_retry）

**決策：** 使用指數退避重試（1s → 2s → 4s）處理 Google Sheets API 配額錯誤

**理由：**
- Google Sheets API 有嚴格 quota（per-user 300 req/min），高並發會觸發 429
- 暴力重試會加重 quota，指數退避給 API 冷卻時間
- QA 測試中發現在批量操作時出現 429 錯誤

**放棄的替代方案：**
- 即時失敗：用戶體驗差（「操作失敗請重試」循環）
- 固定延迟重試：無法適應不同 quota 狀況，浪費時間
- 隊列系統（Celery）：過度設計，當前規模不需

**文件：** `flask_backend/services/sheets_service.py` (L78-97)

---

## 決策 3: 審計日誌（AUDIT logs）

**決策：** 在所有關鍵寫操作記錄 AUDIT 日誌，格式：`AUDIT | route=<> | actor=<name>(<uid>) | action=<> | details`

**理由：**
- 符合合規要求（HR/SysAdmin 操作需可追溯）
- 綁定、重設、權限刷新、批量操作都涉及用戶權限變動，需要審計線索
- 用於事後調查異常操作（誰何時改了什麼）

**放棄的替代方案：**
- 無日誌：合規風險，無法追溯問題
- 資料庫 Audit 表：過度設計，Cloud Logging 已夠用
- 應用層自實現記錄：flask logger 就足夠，避免重複

**文件：** `flask_backend/routes/auth.py` (L188+), `routes/admin.py` (L54-57, L78-81, L112-115, L132-135)

---

## 決策 4: 跨部門權限驗證（P0-1 Employee-Section Binding）

**決策：** 在評分提交時進行雙重驗證：
1. 主管有該科別的評分權限 → `manager_sections`
2. 員工確實屬於該科別 → `section_employee_names`

**理由：**
- **P0 安全漏洞**：Security 審查發現可繞過權限驗證提交他人數據
- 防止跨部門數據竄改（e.g. 人資部主管評分銷售部員工）
- 資料完整性保證（員工-科別映射不能偏離 HR 記錄）

**放棄的替代方案：**
- 客戶端驗證：易被繞過，不安全
- 信任前端提交的 section：無防守，用戶可改變 request body
- 單層驗證（只驗 manager 權限）：遺漏員工跨科別的邊界情況

**文件：** `flask_backend/routes/scoring.py` (L83-92)

---

## 決策 5: CSV 注入防護（_csv_safe）

**決策：** 在 CSV 導出時對公式注入前缀 `=, +, -, @, \t, \r` 加單引號前缀

**理由：**
- **OWASP 風險**：評分備註或員工姓名可能被注入 Excel 公式
- 防止用戶打開 CSV 時被惡意公式執行（e.g. `=cmd|'/c calc'!A1`）
- CSV 導出涉及敏感數據（評分、員工資訊），必須防護

**放棄的替代方案：**
- 完全禁用特殊字符：影響用戶體驗，部分用戶需要 `=` 在備註中表示公式
- 強制 Excel 安全模式：無法保證用戶端設置
- 不防護：安全風險

**文件：** `flask_backend/routes/admin.py` (L20-28), 應用於 CSV 導出時 (L？-?)

---

## 決策 6: 緩存 TTL 優化（30s → 10s）

**決策：** 將 worksheet 緩存 TTL 從 30s 降至 10s

**理由：**
- 多用戶高並發場景下，30s TTL 導致數據不一致（A 改後 B 看不到）
- 10s 平衡「Sheets API quota」與「數據新鮮度」
- Sheets API quota = 300 req/min，10s TTL 意味著每 worksheet 每 10s 最多重新讀一次

**放棄的替代方案：**
- 更長 TTL（60s+）：數據陳舊風險，用戶抱怨「改了但沒生效」
- 無緩存：打爆 API quota，成本增加，服務變慢
- 基於事件的無效化（webhook）：過度工程

**文件：** `flask_backend/services/sheets_service.py` (cache TTL 調整位置)

---

## 跨決策影響

| 決策 | 依賴 | 被依賴 | 備註 |
|------|------|--------|------|
| Rate Limiting | - | Auth routes | 需在 verify-code 等敏感端點啟用 |
| _with_retry | - | Sheets Service | 所有讀寫都經過 _with_retry 包裝 |
| AUDIT logs | limiter? | 後續合規審計 | 日誌持久化（Cloud Logging） |
| P0-1 驗證 | get_all_employees() | batch_submit 也需同樣驗證 | 需確保批量操作不破壞此驗證 |
| _csv_safe | - | 所有 CSV 導出 | admin.py 兩個 CSV export route 都用上 |
| TTL 優化 | - | AUDIT 日誌準確性 | TTL 降低後，AUDIT 日誌時間戳更準確 |
