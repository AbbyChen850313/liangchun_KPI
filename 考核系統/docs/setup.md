# 考核系統部署說明

## 需要準備的東西

| 項目 | 說明 |
|------|------|
| Google 帳號 | 用來建立 Apps Script 和 Google Sheets |
| LINE Developers 帳號 | 建立 LINE Login Channel 和 LINE Bot |
| 這份程式碼 | gas/ 和 liff/ 資料夾 |

---

## STEP 1：建立 Google Sheets（考核系統後台）

1. 開啟 Google Sheets，建立一個新的試算表
2. 命名為「考核系統後台」
3. 複製網址列中的 Spreadsheet ID（`/d/` 後面那一串）

   ```
   https://docs.google.com/spreadsheets/d/【這裡是你的ID】/edit
   ```

4. 同樣方式，找到你的 **HR 員工基本資料 Sheet** 的 Spreadsheet ID

---

## STEP 2：建立 Google Apps Script 專案

1. 開啟 [script.google.com](https://script.google.com) → 新增專案
2. 命名為「考核系統」
3. 把 `gas/` 資料夾中的所有 `.gs` 檔案複製進去（每個檔案對應一個 GAS 腳本檔）
4. 把 `liff/` 資料夾中的所有 `.html` 檔案複製進去（選「HTML」格式）
5. 修改 `appsscript.json`（點選左側「專案設定」→「在編輯器中顯示 appsscript.json」）

---

## STEP 3：填入設定值

在 `Code.gs` 最上方找到 `CONFIG` 區塊，填入你的值：

```javascript
const CONFIG = {
  SPREADSHEET_ID: '考核系統後台的Sheet ID',   // Step 1 取得
  HR_SPREADSHEET_ID: 'HR員工資料的Sheet ID', // Step 1 取得
  LINE_BOT_TOKEN: 'LINE Bot Channel Access Token', // Step 5 取得
  LIFF_ID: 'LIFF App ID',                    // Step 4 取得
};
```

---

## STEP 4：建立 LINE Login Channel（LIFF）

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)
2. 建立新 Provider（或選已有的）
3. 建立「LINE Login」Channel
4. 在 Channel 頁面 → 「LIFF」標籤 → 新增 LIFF App
   - Size: Full
   - Endpoint URL: 先暫時填任意網址，部署後再更新
   - Scope: `profile`, `openid`
5. 複製 **LIFF ID**（格式：`1234567890-xxxxxxxx`）

---

## STEP 5：建立 LINE Bot（Messaging API）

1. 在同一 Provider 下，建立「Messaging API」Channel
2. 在「Messaging API」標籤 → 取得 **Channel Access Token**（長期）
3. 將此 Token 填入 `CONFIG.LINE_BOT_TOKEN`

---

## STEP 6：部署 GAS Web App

1. 在 Apps Script 編輯器 → 右上角「部署」→「新增部署」
2. 選擇類型：**網頁應用程式**
3. 設定：
   - 執行身份：**我（部署者）**
   - 誰可以存取：**所有人（甚至匿名使用者）**
4. 點「部署」→ 複製 **Web App URL**
5. 回到 LINE Developers Console，更新 LIFF 的 Endpoint URL 為這個 Web App URL

---

## STEP 7：初始化工作表

1. 在 Apps Script 編輯器中，選擇函式 `initAllSheets`
2. 點「執行」（第一次會要求授權，請全部允許）
3. 執行後，Google Sheets 會自動建立所有需要的工作表

---

## STEP 8：設定主管權重

1. 開啟「考核系統後台」Sheets
2. 找到「主管權重」工作表
3. 在每個主管名稱對應的 `主管LINE_UID` 欄位填入對應的 LINE UID
   - 主管可以先到 LIFF 頁面登入，系統會自動記錄其 UID 到「LINE帳號」工作表

---

## STEP 9：HR 授權主管帳號

1. 主管開啟 LIFF 連結後，系統會自動記錄其帳號
2. 開啟「LINE帳號」工作表，找到對應主管
3. 將「狀態」欄改為「已授權」
4. 確認「主管姓名」欄與「主管權重」表中的姓名一致

---

## STEP 10：設定定時通知觸發器

1. 在 Apps Script 編輯器，執行 `setupTriggers` 函式
2. 這會設定每天早上9點自動檢查通知時間點

---

## STEP 11：設定評分期間

1. 開啟「系統設定」工作表，或透過 HR 管理後台設定
2. 填入評分期間、截止日、通知時間點等資訊

---

## 使用方式

| 角色 | 操作 |
|------|------|
| 主管 | 在 LINE 收到通知 → 點選連結 → 進入評分介面 |
| HR | 開啟 LIFF 連結（?page=admin&uid=自己的UID）→ 管理後台 |

---

## HR Sheet 欄位說明

系統從 HR 員工資料 Sheet 讀取以下欄位：

| GAS欄位名稱 | Excel欄位 | 說明 |
|-----------|---------|------|
| COL_NAME = 1 | B欄 | 姓名（請依實際欄位調整） |
| COL_DEPT = 3 | D欄 | 部門 |
| COL_SECTION = 4 | E欄 | 科別 |
| COL_JOIN = 28 | AC欄 | 到職日 |
| COL_LEAVE = 30 | AE欄 | 離職日 |
| COL_INCLUDE = 36 | AK欄 | 算入考核（填「算入考核」） |

> ⚠️ 如果 HR Sheet 欄位位置不同，請修改 `Employees.gs` 中的 `COL_*` 常數。

---

## 常見問題

**Q: 為什麼主管看不到員工？**
A: 確認「主管權重」表中的 LINE_UID 已填入，且「LINE帳號」表中的狀態為「已授權」。

**Q: 評分送出後無法修改？**
A: 確認目前在評分截止日之前，且在「系統設定」中的日期正確。

**Q: LINE Bot 通知發送失敗？**
A: 確認 Channel Access Token 正確，且主管有加入 LINE Bot 為好友。

**Q: 財務科的計算方式為何？**
A: 永續發展科經理 × 70% + 業務人員平均分數 × 30%。業務人員為所有評了財務科的業務主管的平均值。
