## SYSTEM_ID — KPI 考核系統

系統名稱：KPI 考核系統
用途：員工自評 + 主管評分，計算年終獎金等級
GCP Project：liangchun-kpi
Firebase Project：linchun-hr（Hosting 仍在此 project，target=prod→liangchun-kpi）
前端 URL（正式）：https://liangchun-kpi.web.app
前端 URL（測試）：https://linchun-kpi-test.web.app
Cloud Run（正式）：kaohe-backend（liangchun-kpi project）https://kaohe-backend-909724320624.asia-east1.run.app
Cloud Run（測試）：kaohe-backend-test（待遷移）
Cloud Run（舊/保留）：kaohe-backend（linchun-hr project，待 ABBY 確認刪除）
Firestore DB：liangchun-kpi（已從 linchun-hr 匯入，2026-04-17）
Service Account：kaohe-backend@liangchun-kpi.iam.gserviceaccount.com
LINE Messaging Channel（正式）：2009611431
LINE Login / LIFF（正式）：2009611318 / LIFF: 2009611318-5UphK9JK
LINE Messaging Channel（測試）：2008337190
LINE Login / LIFF（測試）：2009619528 / LIFF: 2009619528-aJO34c6u

⛔ 絕對不能碰：
- liangchun-course / liangchun-crm / line-survey-7ac5b
- liangchun-expense / liangchun-console / linchun-console
- expense-backend / hr-dashboard-backend（同在 linchun-hr 但不同系統）
