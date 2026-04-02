# 考核系統 (liangchun_KPI) 任務清單

完成度：85%
專案路徑：C:\Users\kk\projects\liangchun_KPI

## 待完成任務（優先順序由高到低）

### [ ] 1. 修復 /api/admin/refresh-roles 501 端點
- 檔案：flask_backend/routes/admin.py line 85-91
- 目前返回 501 Not Implemented
- 功能：重新同步所有員工的角色到 Firestore
- 完成後跑測試確認端點回 200

### [ ] 2. 前端響應式設計修補
- 檔案：frontend/src/pages/Score.tsx, Dashboard.tsx
- 評分進度 UI 在手機螢幕（375px）顯示不完整
- 修改 CSS/Tailwind，確保 mobile-first

### [ ] 3. HR 後台批量操作
- 檔案：frontend/src/pages/Admin.tsx
- 加入「全選」checkbox + 批量重置/匯出功能
- 對應後端：flask_backend/routes/admin.py

### [ ] 4. 角色自動刷新機制
- 當員工資料從 Sheets 同步時，自動觸發角色更新
- 檔案：flask_backend/services/sheets_service.py

### [ ] 5. 端對端測試
- 跑 /health、/api/auth、/api/scoring 全流程
- 確認測試環境 (COLLECTION_PREFIX=test_) 正常

## 已完成
- Flask backend 全路由 (auth, dashboard, scoring, admin)
- React frontend 5 頁面
- GAS webhook + LINE bot + Rich Menu
- Firebase Hosting + Cloud Run 部署設定
- 測試/正式環境分離
