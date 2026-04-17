#!/usr/bin/env bash
# verify.sh — KPI 考核系統真實 QA 驗證
# loop.sh Phase 4 呼叫，exit 1 = 任務失敗擋住
set -e

BRIDGE_DIR="/mnt/c/Users/kk/projects/bridge"
QA_SCRIPT="$BRIDGE_DIR/qa_runners/kpi_qa.py"

echo "[verify] KPI QA Runner 啟動..."
PYTHONUTF8=1 python3 "$QA_SCRIPT"
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo "[verify] ❌ KPI QA FAIL (exit $EXIT_CODE)"
    exit 1
fi

echo "[verify] ✅ KPI QA 全部通過"
exit 0
