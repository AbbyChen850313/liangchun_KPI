# 考核系統 (liangchun_KPI) 任務清單

完成度：100%
專案路徑：C:\Users\kk\projects\liangchun_KPI

## 待完成任務（優先順序由高到低）

### [x] 1. 修復 /api/admin/refresh-roles 501 端點
- 檔案：flask_backend/routes/admin.py
- 讀取 Sheets LINE帳號 表，依角色欄位（或 jobTitle 推導）更新 Firestore accounts collection
- 測試：pytest TestAdminRefreshRoles 全過，不再回 501

### [x] 2. 前端響應式設計修補
- 檔案：frontend/src/styles.css
- 加入 `overflow-x: hidden`、`header` gap/flex-shrink 保護、score-card margin 縮小
- grade-btn min-width:0 確保 375px 四個按鈕不溢出

### [x] 3. HR 後台批量操作
- 檔案：frontend/src/pages/Admin.tsx
- 加入全選 checkbox、批量重置評分（POST /api/admin/batch-reset）、匯出 CSV（GET /api/admin/export-csv）
- 員工列表改用卡片（emp-card-list）取代溢出的 data-table
- 後端：flask_backend/routes/admin.py 新增兩個端點

### [x] 4. 角色自動刷新機制
- 檔案：flask_backend/services/sheets_service.py
- sync_employees_from_hr() 完成後自動呼叫 refresh_roles_in_firestore()
- 失敗時 log exception 但不中斷 sync 流程（優雅降級）

### [x] 5. 端對端測試
- 檔案：flask_backend/tests/test_endpoints.py
- 15 個測試全過（pytest 15 passed in 1.69s）
- 涵蓋：/health、/api/auth/check、/api/admin/refresh-roles、batch-reset、export-csv、scoring 端點、404
- 執行指令：
  ```
  cd flask_backend
  COLLECTION_PREFIX=test_ JWT_SECRET=testsecret python -m pytest tests/ -v
  ```

## 已完成
- Flask backend 全路由 (auth, dashboard, scoring, admin)
- React frontend 5 頁面
- GAS webhook + LINE bot + Rich Menu
- Firebase Hosting + Cloud Run 部署設定
- 測試/正式環境分離
- 所有上述 5 個新任務
