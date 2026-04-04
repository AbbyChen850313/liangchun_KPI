---
name: Cycle 3 架構決策
description: 安全性強化、測試環境隔離、LIFF 登入流程修復的架構選擇
type: project
---

## 決策 1: API 端點 Rate Limiting（認證層）

**決策：** 在 `/api/auth/session`、`/api/auth/line-oauth`、`/api/auth/bind` 三個認證端點實施 10 req/minute 速率限制

**理由：**
- 安全需求：防止暴力破解（brute force）與 DoS 攻擊
- 業務防護：防止自動化掃描與異常流量
- 合規性：符合 OWASP 認證端點安全建議

**放棄的替代方案：**
- 無限制：容易被濫用，風險高
- 基於 IP 的限流：無法區分同一 NAT/代理後的合法用戶
- 指數退避：實現複雜，且對正常用戶體驗差

**實現：**
- 使用 Flask-Limiter 在 route decorator 層實施
- 限流粒度：基於客戶端 IP（預設行為）
- 超限回應：429 Too Many Requests

**文件：**
- `flask_backend/routes/auth.py` (L69, L88, L114: @limiter.limit("10/minute"))

---

## 決策 2: Year 參數防注入驗證

**決策：** 在 scoring API 中使用 `_validated_year()` 函數驗證民國年份格式，必須為三位數字（範圍 100-200）

**理由：**
- 安全需求：防止 SQL 注入與格式驗證繞過
- 數據完整性：確保年份參數不會因格式問題被誤解
- 邊界檢查：民國 100-200 涵蓋實務範圍，超過則為異常

**放棄的替代方案：**
- 無驗證：直接使用用戶輸入 → 注入風險
- 白名單式（枚舉有效年份）：難以維護，不可擴展
- 單純長度檢查：無法防止非數字輸入

**實現：**
```python
_YEAR_PATTERN = re.compile(r"^\d{3}$")
def _validated_year(year_str: str) -> tuple[int, None] | tuple[None, tuple]:
    if not _YEAR_PATTERN.match(year_str) or not (100 <= int(year_str) <= 200):
        return None, (jsonify({"error": "year 參數格式錯誤..."}), 400)
    return int(year_str), None
```

**文件：**
- `flask_backend/routes/scoring.py` (L35-41: _YEAR_PATTERN 與 _validated_year)

---

## 決策 3: LINE Webhook 原點驗證（GAS-SEC-02）

**決策：** 在 GAS `doPost()` 中新增 `_verifyLineWebhookOrigin()` 函數，以 HMAC-SHA256 或 URL token 方式驗證 LINE Webhook 請求的合法性

**理由：**
- 安全需求：防止偽造的 Webhook 事件（man-in-the-middle、重放攻擊）
- LINE 官方建議：使用 X-Line-Signature header 驗證 HMAC-SHA256
- 備用機制：URL token 用於無法設定 header 的環境（如某些 CDN）

**放棄的替代方案：**
- 無驗證：任何人都能向 GAS 發送 Webhook 事件 → 風險極高
- 僅檢查 IP：LINE Webhook IP 可能變化，難以維護
- 單一驗證方式：不夠靈活，難以應對環境差異

**實現：**
```javascript
function _verifyLineWebhookOrigin(e, rawBody) {
  const channelSecret = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_SECRET');
  const webhookToken  = PropertiesService.getScriptProperties().getProperty('LINE_WEBHOOK_TOKEN');
  
  if (channelSecret) {
    const sig = e.parameter['x-line-signature'];
    const computed = Utilities.base64Encode(
      Utilities.computeHmacSha256Signature(rawBody, channelSecret, Utilities.Charset.UTF_8)
    );
    return computed === sig;
  }
  if (webhookToken) {
    return e.parameter.lhook === webhookToken;
  }
  return false;
}
// doPost() 中調用
if (!_verifyLineWebhookOrigin(e, e.postData.contents)) {
  return _jsonOut({ error: 'Unauthorized' });
}
```

**文件：**
- `考核系統/gas/Code.gs` (L288-313: _verifyLineWebhookOrigin)
- `考核系統/gas/Code.gs` (L335-339: doPost() 驗證調用)

---

## 決策 4: GAS 密鑰重設保護（GAS-SEC-01）

**決策：** 修改 `apiForceResetNotifySecret()` 函數，要求提供現有密鑰才能重設新密鑰（而非無條件重設）

**理由：**
- 安全需求：防止未授權人員任意重設 NOTIFY_SECRET，導致現有 Bridge 失效
- 舊密鑰驗證：確保僅持有現有密鑰的人（Bridge 管理員）可重設
- 最小權限原則：降低意外操作的風險

**放棄的替代方案：**
- 無驗證重設：任何人都能重設 → 拒絕服務風險
- 基於 IP 的保護：不夠堅固，易被繞過
- 備用碼機制：增加複雜度，且若備用碼被洩露也有風險

**實現：**
```javascript
function apiForceResetNotifySecret(currentSecret) {
  const stored = PropertiesService.getScriptProperties().getProperty('NOTIFY_SECRET');
  if (!stored || currentSecret !== stored) return { error: '認證失敗' };
  const newSecret = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('NOTIFY_SECRET', newSecret);
  return { secret: newSecret };
}
```

**文件：**
- `考核系統/gas/Code.gs` (L203-212: apiForceResetNotifySecret)

---

## 決策 5: 401 攔截器條件式 Reload（LIFF 登入流程修復）

**決策：** 修改前端 API 401 攔截器，僅在請求攜帶 Authorization header（session JWT）時才觸發 reload recovery；對無 Authorization header 的請求（LIFF access token）則直接傳播錯誤

**理由：**
- 修復 LIFF 無限登入循環：LIFF access token 失效（401）不應觸發 reload，因為 reload 會重新啟動 LIFF 初始化流程，導致死循環
- 區分兩類請求：session JWT（背景認證，可重試）vs LIFF access token（初始登入，應轉向登入流程）
- UX 改善：不合法的 LIFF token 應被 useLiff hook 捕獲處理，不應盲目 reload

**放棄的替代方案：**
- 全局禁用 reload：影響 session JWT 失效的正常重試邏輯
- 重試次數限制：仍無法區分「session 過期」vs「LIFF token 無效」
- 前端手動檢查：增加業務邏輯複雜度，易遺漏

**實現：**
```typescript
const isNeedBind = Boolean(responseData.needBind);
const hadSessionToken = Boolean(config.headers?.Authorization);
if (err.response?.status === 401 && !config._retry && !isNeedBind && hadSessionToken) {
  // 僅重試有 session token 的請求
  config._retry = true;
  const newRole = await refreshRole();
  ...
}
```

**文件：**
- `frontend/src/services/api.ts` (L30-60: 攔截器邏輯重構)

---

## 跨決策影響分析

| 決策 | 依賴關係 | 被依賴者 | 耦合度 | 備註 |
|------|---------|---------|--------|------|
| Rate Limiting | 無 | 無 | 低 | 獨立的基礎設施層 |
| Year 驗證 | 無 | scoring API | 中 | 影響所有年份相關的評分操作 |
| Webhook 驗證 | 無 | GAS Webhook handler | 中 | 必須在 doPost() 開頭執行 |
| 密鑰重設保護 | 無 | Bridge 管理員流程 | 低 | 僅影響密鑰管理端點 |
| 401 攔截器 | 無 | LIFF 登入、API 回呼 | 高 | 影響所有非幂等 API 呼叫 |

---

## 核心設計權衡

### 1. 安全 vs 可用性
- **選擇**：安全優先，但保留靈活性（rate limit 10/min 為實務平衡、HMAC + URL token 雙通道）
- **理由**：認證層是關鍵安全邊界，寧可讓正常用戶稍作等待，也不允許攻擊通過

### 2. 嚴格驗證 vs 容寬
- **選擇**：嚴格驗證（year 範圍限制、Webhook 簽名檢查）
- **理由**：邊界檢查是防御的第一線，容寬會放大後續的錯誤影響

### 3. 故障模式設計
- **401 攔截器**：區分「可重試」與「不可重試」的 401，而非一刀切
- **Webhook 驗證**：未授權請求返回 401，但不中斷既有事件處理

---

## 未來演進方向

- **2FA/MFA**：若需進一步強化認證，可考慮在 /api/auth/bind 中加入時間碼（TOTP）
- **Webhook 簽名重輪換**：定期重新生成 HMAC secret，需設計旋轉策略
- **速率限制精細化**：若遇到大規模使用，可轉向分層限流（user-level vs global）
- **審計日誌**：score submit 已加入 AUDIT log，未來可串接集中式日誌系統

