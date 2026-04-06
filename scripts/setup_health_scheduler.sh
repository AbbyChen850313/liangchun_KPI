#!/usr/bin/env bash
# B15 — 四系統健康監控 Cloud Scheduler 設定腳本
#
# 前置作業：
#   1. 在 KPI GAS Script Properties 設定 SCHEDULER_SECRET=<你的密鑰>
#   2. 將 GAS_WEB_APP_URL 填入下方（重新部署後 URL 不變）
#   3. 執行本腳本：bash scripts/setup_health_scheduler.sh
#
# 架構說明：
#   Cloud Scheduler → POST GAS Web App → 檢查 4 系統 /health → 失敗時推 LINE

set -euo pipefail

# ── 必填設定 ──────────────────────────────────────────────────
GCP_PROJECT="linchun-hr"
GAS_WEB_APP_URL="https://script.google.com/macros/s/AKfycbybxP5AkhFXFXsDatUnIJZWoQPQNOekLFK7JdhzdMTvhp08lvjk7DNmunxVAorjCsm3jg/exec"
SCHEDULER_SECRET="${SCHEDULER_SECRET:-}"  # 從環境變數傳入，避免寫死在腳本

if [[ -z "$SCHEDULER_SECRET" ]]; then
  echo "❌ 請設定環境變數 SCHEDULER_SECRET"
  echo "   export SCHEDULER_SECRET=<你在 GAS Script Properties 設定的值>"
  exit 1
fi

REGION="asia-east1"
JOB_NAME="health-monitor-all-systems"
SCHEDULE="0 * * * *"  # 每小時整點

# ── POST body ──────────────────────────────────────────────────
BODY=$(cat <<EOF
{"action":"apiHealthCheckAll","args":["${SCHEDULER_SECRET}"]}
EOF
)

echo "📋 GCP Project : $GCP_PROJECT"
echo "📋 Job Name    : $JOB_NAME"
echo "📋 Schedule    : $SCHEDULE (每小時)"
echo "📋 Target URL  : $GAS_WEB_APP_URL"
echo ""

# ── 建立或更新 Scheduler Job ──────────────────────────────────
if gcloud scheduler jobs describe "$JOB_NAME" --location="$REGION" --project="$GCP_PROJECT" &>/dev/null; then
  echo "🔄 更新既有 job: $JOB_NAME"
  gcloud scheduler jobs update http "$JOB_NAME" \
    --location="$REGION" \
    --project="$GCP_PROJECT" \
    --schedule="$SCHEDULE" \
    --uri="$GAS_WEB_APP_URL" \
    --http-method=POST \
    --headers="Content-Type=application/json" \
    --message-body="$BODY" \
    --time-zone="Asia/Taipei"
else
  echo "✨ 建立新 job: $JOB_NAME"
  gcloud scheduler jobs create http "$JOB_NAME" \
    --location="$REGION" \
    --project="$GCP_PROJECT" \
    --schedule="$SCHEDULE" \
    --uri="$GAS_WEB_APP_URL" \
    --http-method=POST \
    --headers="Content-Type=application/json" \
    --message-body="$BODY" \
    --time-zone="Asia/Taipei"
fi

echo ""
echo "✅ Scheduler job 設定完成"
echo ""
echo "📌 手動觸發測試："
echo "   gcloud scheduler jobs run $JOB_NAME --location=$REGION --project=$GCP_PROJECT"
echo ""
echo "📌 查看 job 狀態："
echo "   gcloud scheduler jobs describe $JOB_NAME --location=$REGION --project=$GCP_PROJECT"
