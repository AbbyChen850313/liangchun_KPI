---
name: Cycle 3 完成摘要
description: 安全性強化與測試環境隔離週期的完成情況、核心成果、與下一步建議
type: project
---

# Cycle 3 完成摘要（Apr 4, 2026）

## 本週期目標達成

### 核心成果 ✅

1. **安全性強化** — 5 項關鍵防護措施
   - ✅ Rate limiting（10/minute 於 /api/auth/* 端點）
   - ✅ Year 參數格式驗證（民國三位數範圍限制）
   - ✅ GAS Webhook 原點驗證（HMAC-SHA256 + URL token）
   - ✅ GAS 密鑰重設保護（現有密鑰驗證）

2. **測試環境隔離** — 完整的 test/prod 分離
   - ✅ deploy-test job 自動部署 kaohe-backend-test
   - ✅ LIFF_ENDPOINT 環境變數自動選擇 test/prod LIFF URL
   - ✅ 前端與後端測試環境完全隔離，互不干擾

3. **LIFF 登入循環修復** — 區別認證恢復 vs 初始認證
   - ✅ 401 攔截器改進：僅在有 session JWT（Authorization header）時重試
   - ✅ LIFF access token 失效（401）直接傳播給 useLiff hook 處理
   - ✅ 移除無限 reload 迴圈，改善用戶體驗

4. **四季評分模擬驗證** — 完整的 6 項 AC 通過
   - ✅ test_four_seasons.py Stub 註冊修復
   - ✅ 48 項後端測試全過（含四季評分模擬 7 個驗收標準）
   - ✅ 前端 TypeScript 無錯誤，build 成功

5. **代碼品質改進**
   - ✅ Dashboard.tsx 未使用變數移除
   - ✅ 評分表單 AUDIT log 添加
   - ✅ 所有 API 端點參數驗證強化

---

## 文件變更統計

| 文件 | 變更行數 | 變更類型 | 目的 |
|------|---------|---------|------|
| flask_backend/routes/auth.py | +3 | 新增 rate limit decorator | 認證端點防暴力 |
| flask_backend/routes/scoring.py | +25 | 新增 year 驗證、duplicate guard | 輸入驗證與防止重複 |
| 考核系統/gas/Code.gs | +54 | 新增 Webhook 驗證、密鑰保護 | GAS 層安全強化 |
| frontend/src/services/api.ts | +19 | 改進 401 攔截器邏輯 | LIFF 循環修復 |
| flask_backend/tests/test_four_seasons.py | +23 | 修復 stub 註冊、新增測試 | 測試可靠性 |
| **合計** | **+124** | — | — |

---

## QA 驗收結果

### 自動化測試 ✅
- 後端 build 成功
- 48 項後端 API 測試全過
- 前端 npm run build 無 TypeScript 錯誤
- CI/CD 觸發正常

### 手動測試 ✅
- LIFF 無限 reload 迴圈已修復
- LINE Webhook 接收正常
- Google Sheet 資料寫入正確
- Rate limit 於限制速度時生效

---

## 決策層面的演進

### 安全層決策的演進軌跡

**Cycle 1 時期**：專注功能實現（基本的 LIFF、OAuth）
**Cycle 2 時期**：引入狀態機與隔離模型（Quarter、年度快照、評分狀態）
**Cycle 3 時期**（本週期）：補充安全邊界防御（rate limit、輸入驗證、Webhook 簽名、認證層區別）

### 關鍵設計決策的理由

1. **為何 10/minute 而非 5 或 20？**
   - 5/minute：太嚴格，正常用戶登入失敗可能頻繁
   - 10/minute：實務平衡，防止機械化攻擊，但容許手動重試
   - 20/minute：過寬鬆，易被濫用

2. **為何支持 URL token 作為 Webhook 驗證的備用？**
   - HMAC-SHA256 最安全，但某些 GAS 環境或代理可能破壞原始 body
   - URL token（via query string）更容易被代理保留，有助於相容性
   - 雙通道設計增加部署靈活性

3. **為何區別 Authorization header 的有無？**
   - session JWT（有 Authorization）：後台認證，可重試 + reload
   - LIFF access token（無 Authorization）：初始認證，失敗應向上傳播
   - 混淆兩者會導致無限 reload 循環

---

## 已知限制與未來改進

### 本週期遺留的 TODO

| 項目 | 優先級 | 預計時間 | 備註 |
|------|--------|---------|------|
| GCP Error Reporting 告警規則 | P2 | 1h | Monitoring 建議補充 |
| Firebase Crash Report 監控 | P2 | 1h | 移動端崩潰分析 |
| 定期配額檢查 job | P3 | 1.5h | Google API 配額監控 |
| 業務異常推 LINE 通知機制 | P2 | 2h | 評分異常、批准失敗時通知 |
| 2FA/MFA（可選） | P3 | 3h | 若需進一步安全強化 |

### 邊界情況監控

- Rate limit 誤傷正常用戶 → 監控 429 回應率
- Webhook 簽名驗證的相容性 → 監控驗證失敗率
- Year 參數格式錯誤 → 監控 400 回應率

---

## Cycle 3 → Cycle 4 過渡建議

### 優先項
1. **上線前檢查清單**
   - [ ] 驗證 test 分支部署的 deploy-test job 成功
   - [ ] 驗證 LINE_CHANNEL_SECRET 在 production GAS 正確設定
   - [ ] 驗證 rate limit 閾值是否合理（監控一週）

2. **運營準備**
   - [ ] 編寫 runbook：若 rate limit 過高導致用戶投訴時的調整步驟
   - [ ] 編寫 runbook：若 Webhook 驗證失敗的 troubleshooting 流程
   - [ ] 備份/還原 NOTIFY_SECRET 的操作文檔

3. **後續強化方向**
   - [ ] 集成 GCP Error Reporting（Monitoring 待辦項）
   - [ ] 考慮引入 request ID 與分布式追蹤（for 跨服務調試）
   - [ ] 業務異常推 LINE 通知（評分批准失敗、數據不一致時）

### 技術債清單
- `考核系統/gas/Code.gs` 中 Webhook 驗證若失敗時的 alert 機制
- 前端 401 攔截器邏輯較複雜，可考慮提取為單獨的 hook（useAuthRetry）
- Rate limit 仍為全局 10/minute，未來可細化為 per-user 或 per-IP 分層

---

## 與上一週期的對比

| 維度 | Cycle 2（四季評分） | Cycle 3（安全強化） |
|------|------------------|-------------------|
| 主要聚焦 | 業務邏輯（狀態機、隔離） | 安全邊界（防御、驗證） |
| 文件變更量 | ~100+ 行 | ~124 行 |
| 架構決策 | 5 項 | 5 項 |
| 發現的坑 | 8 項（多為邏輯缺陷） | 7 項（多為安全/環境配置） |
| 新增測試 | test_four_seasons.py（23 組 AC） | 強化現有測試 stub |
| 對系統的影響 | 高（核心功能） | 中-高（基礎設施） |

---

## 團隊反饋與經驗

### 成功經驗
✅ **明確的區分原則**（rate limit、year 驗證、Webhook 簽名）有助於快速實現與測試
✅ **測試環境隔離**（deploy-test job）讓測試流程更可靠
✅ **對 401 攔截器的重新思考**展示了細節設計的重要性

### 需要改進
❌ **GAS 環境配置驗證**應在部署流程中自動檢查，而非靠運營手動檢查
❌ **Rate limit 閾值**應基於實際使用數據調整，而非事先猜測
❌ **Webhook 簽名驗證的 debug**仍需更好的日誌支持

### 下一週期建議
1. 增加 **集成測試** 層面的 Rate limit 與簽名驗證測試
2. 添加 **metrics 收集**（429 率、簽名驗證失敗率）
3. 設定 **告警規則**（if 429 rate > 5% in 1h → notify on-call）

---

## 相關 Commit 清單

| Commit | 訊息 | 核心改動 |
|--------|------|---------|
| 5fd3d8c | feat: 強化安全性與輸入驗證 | rate limit、year 驗證、Webhook 簽名、密鑰保護、stub 修復 |
| 80f0747 | hotfix: 修復 LIFF 無限登入循環 | 401 攔截器邏輯重構 |
| 88dd291 | hotfix: 修復測試環境後端 404 | deploy-test job 新增 |
| 35aca9b | test: 模擬每位主管評分四季 | 四季評分模擬測試 |
| f98b8f8 | fix: LIFF_ENDPOINT 環境變數 | VITE_IS_TEST 路由邏輯 |

---

## 結語

Cycle 3 成功補完了系統的安全基礎設施層。從業務邏輯（Cycle 2）到防御邊界（Cycle 3），系統架構逐步完善。

**下一個重點**應當是監控與可觀測性（Cycle 4 建議），使得未來的問題能更早被發現與定位。

