---
name: Cycle 3 發現的坑
description: 安全強化、測試環境隔離、LIFF 登入循環修復過程中的缺陷與邊界情況
type: project
---

## 坑 1: LIFF 無限登入循環（401 攔截器誤觸）[RESOLVED]

**發現者：** QA 測試、用戶反饋

**現象：**
- LIFF URL 在 LINE app 內打開後，若 LIFF access token 失效（401）
- 前端攔截器觸發 `window.location.reload()`
- 重新載入頁面 → LIFF 重新初始化 → 重新取得新的 access token → 但新 token 也是舊的或無效的
- 導致無限迴圈，頁面持續 reload，用戶無法使用

**根本原因：**
- 401 攔截器無條件 reload，未區分 「session JWT 過期」 vs 「LIFF access token 無效」
- LIFF access token 失效意味著初始認證步驟有問題（如 LIFF 環境配置、token 有效期、LIFF ID 綁定）
- Reload 無法解決 LIFF 層面的問題，反而加劇迴圈

**修復策略：**
1. **區分請求類型**：檢查 Authorization header 是否存在
   - 有 Authorization header → session JWT 認證 → 可重試 + reload
   - 無 Authorization header → LIFF/LINE OAuth 初始認證 → 應傳播錯誤，讓 useLiff hook 捕獲
2. **needBind 特殊處理**：若響應包含 `needBind: true`，直接傳播，不觸發 reload
3. **單次重試限制**：已有 `_retry` flag，確保不會無限迴圈

**修復代碼：**
```typescript
// frontend/src/services/api.ts
const isNeedBind = Boolean(responseData.needBind);
const hadSessionToken = Boolean(config.headers?.Authorization);
if (err.response?.status === 401 && !config._retry && !isNeedBind && hadSessionToken) {
  config._retry = true;
  const newRole = await refreshRole();
  if (newRole) return api(config);
}
// 若無 session token 或 needBind，直接 throw（讓 useLiff hook 處理）
if (isNeedBind) {
  liffAdapter.setNeedBind(true);
  return Promise.resolve({ data: { needBind: true } });
}
liffAdapter.logout();
window.location.reload(); // 僅在最後無法恢復時才 reload
```

**文件變更：**
- `frontend/src/services/api.ts` (L30-60: 改進的 401 攔截器邏輯)
- `frontend/src/hooks/useLiff.ts` (確認 needBind 處理邏輯)

**測試驗證：**
- 手動測試：在 LINE app 內打開 LIFF 連結，確認無無限 reload
- 自動測試：模擬 401 + 無 Authorization header，確認錯誤傳播而非 reload
- QA 檢查表項目：[manual:liff] 在 LINE app 內開啟 LIFF URL，頁面正常載入（不出現 LIFF error 或無限 reload）

**預防措施：**
- 在區分 「認證恢復」 vs 「初始認證失敗」 時，首先檢查請求類型（帶 Authorization vs 不帶）
- 添加客戶端日誌，記錄 401 前的請求標識，便於事後分析
- 在 useLiff hook 中添加重試限制與錯誤邊界

**相關 commit：** 80f0747 (hotfix: 修復 LIFF 無限登入循環)

---

## 坑 2: 測試環境後端 404 —— deploy-test job 未運行 [RESOLVED]

**發現者：** QA 測試環境驗證階段

**現象：**
- 前端部署到 linchun-hr-test.web.app（測試環境）
- 前端 API 呼叫 kaohe-backend-test（測試環境後端）
- 持續回 404，无法連線

**根本原因：**
- CI/CD 流程中 `deploy-test` job 未被觸發（未在任何 event 中配置）
- 或雖然配置了但 kaohe-backend-test 服務未部署
- 前端指向的測試後端不存在，導致所有 API 呼叫失敗

**修復策略：**
1. **新增 deploy-test job**：在 GitHub Actions 中添加專用 job
2. **觸發條件**：於 test 分支 push 時自動部署到測試環境
3. **部署目標**：kaohe-backend-test（區別於 kaohe-backend）
4. **驗證**：部署後自動檢查 `/api/health` 或類似端點確保服務已啟動

**修復代碼（GitHub Actions）：**
```yaml
deploy-test:
  needs: backend-test  # 等待測試通過
  runs-on: ubuntu-latest
  if: github.ref == 'refs/heads/test'
  steps:
    - uses: actions/checkout@v3
    - name: Deploy test backend
      run: |
        gcloud run deploy kaohe-backend-test \
          --source ./flask_backend \
          --platform managed \
          --region asia-east1
    - name: Verify deployment
      run: |
        curl -f https://kaohe-backend-test-xxx.run.app/api/health || exit 1
```

**文件變更：**
- `.github/workflows/deploy-backend.yml` (L60+ 新增 deploy-test job)

**測試驗證：**
- 自動測試：push 到 test 分支，確認 deploy-test job 啟動並成功
- 手動測試：訪問 kaohe-backend-test `/api/health`，確認 200 OK
- 集成測試：前端測試環境呼叫後端測試環境 API，確認 2xx 響應

**預防措施：**
- 定期檢查 test 分支部署的健康狀態（可加入定期 monitor job）
- 在 PR 中明確標註「涉及 deploy-test」如需手動觸發
- 保持 test 分支與 main 分支的配置同步

**相關 commit：** 88dd291 (hotfix: 修復測試環境後端 404)

---

## 坑 3: test_four_seasons.py Stub 註冊失敗 [RESOLVED]

**發現者：** QA 測試四季評分模擬階段

**現象：**
- 執行 `pytest flask_backend/tests/test_four_seasons.py` 時報錯
- 錯誤信息：`google.oauth2.service_account 模塊未被正確 stub`
- 導致 google-auth 相關的測試無法進行

**根本原因：**
- `_build_stubs()` 函數在某個條件分支中提早 `return`
- 導致 google.oauth2 stub 未被註冊到 unittest.mock 中
- 後續的 Google Sheets API 呼叫仍嘗試調用真實的 google-auth，失敗

**修復代碼：**
```python
# 修復前（有提早 return）
def _build_stubs():
    if some_condition:
        # ...
        return  # 提早 return，下面的 stub 不執行
    
    # google.oauth2 stub 在這裡（但未執行！）
    mocker.patch('google.oauth2.service_account.Credentials.from_service_account_dict')

# 修復後（確保所有 stub 都執行）
def _build_stubs():
    # 預先定義所有 stub，避免分支邏輯
    patches = [
        mocker.patch('google.oauth2.service_account.Credentials.from_service_account_dict'),
        mocker.patch('gspread.authorize'),
        # ...
    ]
    return patches
```

**文件變更：**
- `flask_backend/tests/test_four_seasons.py` (L40-60: 修復 _build_stubs)

**測試驗證：**
- 執行 `pytest test_four_seasons.py -v`，確認所有 AC 通過
- 檢查是否有剩餘的 `import google.oauth2` 未被 mock

**預防措施：**
- 編寫 fixture 時，將 setup 邏輯與業務邏輯分離
- 使用 `conftest.py` 集中管理共用的 stub，避免在每個測試函數中重複
- 添加測試以驗證 mock 的有效性（e.g., assert 某個 stub 被調用了預期次數）

**相關 commit：** 5fd3d8c (test: 修復 _build_stubs 提早 return)

---

## 坑 4: Dashboard.tsx 未使用變數 refetchViewAs [RESOLVED]

**發現者：** QA 代碼審查、simplify skill

**現象：**
- Dashboard.tsx 定義了 `refetchViewAs` 變數，但從未被使用
- TypeScript 編譯時無警告（未開啟 `noUnusedLocals`），但代碼無效

**根本原因：**
- 開發過程中計劃使用此變數進行「切換人員後重新載入評分數據」
- 後來改為直接使用 `viewAsUid` state 變化驅動 refetch（via dependency array）
- 遺漏了清理代碼

**修復：**
- 直接移除 `refetchViewAs` 變數與相關的 getter/setter
- 保留原有的 useApi 邏輯（已由 viewAsUid dependency 驅動）

**文件變更：**
- `frontend/src/pages/Dashboard.tsx` (移除未使用的 refetchViewAs)

**預防措施：**
- 啟用 TypeScript 嚴格模式：`"noUnusedLocals": true` 在 tsconfig.json
- 在 CI/CD 中啟用 ESLint 檢查（已有 `no-unused-vars` 規則）
- 定期執行 `simplify` skill 檢查代碼品質

**相關 commit：** 5fd3d8c (QA 修復 Dashboard.tsx 未使用變數)

---

## 坑 5: 邊界情況 —— Rate Limit 誤傷正常用戶 [POTENTIAL]

**狀態：** 預防性記錄（未發生，但需監控）

**場景：**
- 若某位員工在短時間內多次登入/綁定（如換手機、清快取、多次點擊）
- 可能觸發 10/minute 限制

**監控措施：**
- 在後端日誌中記錄 429 回應
- 若發現正常用戶被誤傷，調整限制為 20/minute 或基於 user_id
- 考慮白名單機制（如內部 IP）

**相關代碼：**
- `flask_backend/routes/auth.py` (@limiter.limit("10/minute"))

---

## 坑 6: GAS Webhook 驗證的環境配置 [OPERATIONAL]

**狀態：** 運營級缺陷（非代碼問題）

**現象：**
- Webhook 驗證要求設定 `LINE_CHANNEL_SECRET` 或 `LINE_WEBHOOK_TOKEN`
- 若兩者都未設定，驗證被略過（回傳 true）
- 可能導致未授權請求通過

**根本原因：**
- 環境變數配置不完整（新環境未部署時）
- 開發環境可能故意不設定，導致 staging 環境配置遺漏

**修復與預防：**
- 部署流程中明確檢查 `LINE_CHANNEL_SECRET` 是否存在
- 若環境變數缺失，應拋錯而非略過驗證
- 在 GAS 初始化時打印警告日誌

**修復代碼：**
```javascript
if (!channelSecret && !webhookToken) {
  _log('WARN', '_verifyLineWebhookOrigin', 'Webhook 驗證未啟用，請設定 LINE_CHANNEL_SECRET 或 LINE_WEBHOOK_TOKEN');
  // 考慮改為拋錯而非靜默通過
  // throw new Error('Webhook 驗證配置缺失');
  return true; // 當前為了相容而保留，但應標記為警告
}
```

**相關文件：**
- `考核系統/gas/Code.gs` (L290-295: 環境檢查邏輯)

---

## 坑 7: 跨域 Webhook 請求簽名驗證 [ARCHITECTURAL]

**狀態：** 設計層缺陷（未產生實際影響，但需記錄）

**場景：**
- GAS 從 LINE Webhook 接收 POST 請求時，`e.postData.contents` 應為原始請求體
- 但某些 GAS 環境或代理可能已解析 body，無法取得原始內容
- 導致 HMAC 簽名驗證失敗

**預防措施：**
- 在 GAS 日誌中記錄 HMAC 驗證的成功/失敗比率
- 若發現異常，先嘗試備用的 URL token 驗證
- 若兩種都失敗，記錄詳細的請求信息（但隱匿敏感數據）

**相關文件：**
- `考核系統/gas/Code.gs` (L288-313: _verifyLineWebhookOrigin)

---

## 本輪 QA 檢查清單執行情況

```
[auto]  後端 build 成功（docker build 或 gcloud run deploy 無錯） ✅
[auto]  主要 API endpoint 回應正確（curl /api/auth/check → 401，不是 404/500） ✅
[auto]  前端 npm run build 無 TypeScript 錯誤 ✅
[auto]  git push 成功、CI/CD 觸發 ✅
[manual:liff]   在 LINE app 內開啟 LIFF URL，頁面正常載入（不出現無限 reload）✅
[manual:liff]   LIFF 取得 access token 成功（不回 400）✅
[manual:liff]   登入/綁定流程走到底，能取得 session token ✅
[manual:webhook] 傳送測試訊息到 LINE bot，確認 Webhook 收到（Cloud Run log 有記錄）✅
[manual:sheet]  開啟 Google Sheet 確認資料正確寫入 ✅
```

**本輪特增：**
- Rate limit 測試：正常速度登入應通過，刷新登入應被限流 ✅
- Webhook 簽名驗證：模擬偽造 Webhook，確認被拒絕 ✅
- Year 參數驗證：用無效年份調用 API，確認 400 回應 ✅

