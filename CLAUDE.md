# 開發準則

## 1. Clean Code & Architecture
- **意圖導向命名**：拒絕 `data`、`temp`、`list1`。變數名描述「為什麼存在」而非「它是什麼類型」
- **函式原子性**：嚴守 SRP。超過 20 行或含 if-else 分支邏輯，考慮 Extract Method
- **低耦合**：優先介面與抽象，實踐 DIP，確保易於單元測試且具備擴展性

## 2. Refactoring & Code Smells
- **DRY**：發現重複邏輯立即提煉通用組件
- Data Clumps → 引入 Parameter Object；Shotgun Surgery → 重新分配職責
- 三次法則：加新功能前先做必要的結構調整

## 3. 系統架構守則
- 程式碼是負債，優先評估現成工具或 No-code
- **YAGNI**：不預寫猜測的需求
- 先正確、再好維護、最後求快（拒絕過早最佳化）
- 高內聚、低耦合

## 4. 程式實作守則
- 可讀性絕對大於炫技
- 好的變數與函式命名就是最好的註解
- **防禦性編程**：預設外部 API 與資料庫隨時會崩潰，必須處理邊界情況

## 5. 測試與維運
- 沒有測試的程式碼預設就是壞的
- 重複超過三次的人工部署或環境建置，必須自動化（CI/CD）
- **部署完必須自己測完沒問題，才請用戶測試**

## 6. LINE 環境規則（本專案）
- 任何測試必須在測試 Channel（2008337190）進行，禁止動正式帳號
- 做 Rich Menu、綁定等大動作前，先用關鍵字（`ping`）確認 Webhook 接到正確帳號
- `_getBotToken()` 若 `使用測試Channel != true` 會拋錯，這是刻意的保護

## 7. QA Checklist

每次任務完成後，QA agent 必須對照此清單，標記每項是否適用並執行。
- `[auto]`：可用 curl / script / build 自動驗證
- `[manual]`：需要真人在 LINE 或手機上操作才能驗，loop 推通知給用戶但不等待

```
[auto]  後端 build 成功（docker build 或 gcloud run deploy 無錯）
[auto]  主要 API endpoint 回應正確（curl /api/auth/check → 401，不是 404/500）
[auto]  前端 npm run build 無 TypeScript 錯誤
[auto]  git push 成功、CI/CD 觸發
[manual:liff]   在 LINE app 內開啟 LIFF URL，頁面正常載入（不出現 LIFF error）
[manual:liff]   LIFF 取得 access token 成功（不回 400）
[manual:liff]   登入/綁定流程走到底，能取得 session token
[manual:webhook] 傳送測試訊息到 LINE bot，確認 Webhook 收到（Cloud Run log 有記錄）
[manual:sheet]  開啟 Google Sheet 確認資料正確寫入
```

**規則：**
- `[auto]` 項目 QA agent 必須全部執行，任何失敗都要修復再繼續
- `[manual]` 項目 QA agent 評估本次修改是否觸及該項（例如只改 CSS 不需驗 webhook），觸及的才列出推通知
- QA agent 輸出格式：`MANUAL_QA: <項目1> | <項目2>` 或 `MANUAL_QA: none`
