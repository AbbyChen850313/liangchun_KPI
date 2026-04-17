// ============================================================
// WeeklyReport.gs — B17 每週狀態週報（零 Token，GAS 時間觸發）
// ============================================================
//
// 觸發器：每週一 09:05（setupWeeklyReportTrigger() 執行一次後自動設定）
// 推播對象：OWNER_LINE_UID_TEST（與 HealthMonitor 共用）
// 資料來源：
//   1. Cloud Run health checks（複用 HealthMonitor._checkAllHealthEndpoints）
//   2. bridge /tasks-summary endpoint（BRIDGE_URL Script Property）
//
// Script Properties 需設定：
//   OWNER_LINE_UID_TEST  — 收通知的 LINE UID（已存在）
//   BRIDGE_URL           — bridge tunnel URL（由 bridge 啟動時 apiSetBridgeUrl 自動更新）
// ============================================================

/**
 * 每週一 09:05 觸發：產出並推播週報至 OWNER
 */
function weeklyReport() {
  const props = PropertiesService.getScriptProperties();
  const ownerUid = props.getProperty('OWNER_LINE_UID_TEST');
  if (!ownerUid) {
    Logger.log('[WeeklyReport] OWNER_LINE_UID_TEST 未設定，跳過');
    return;
  }

  const dateStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');

  // 1. 健康狀態（複用 HealthMonitor 的 _checkAllHealthEndpoints）
  const failures = _checkAllHealthEndpoints();
  const healthLine = failures.length === 0
    ? '✅ 四系統全部正常'
    : '⚠️ 異常：' + failures.join('、');

  // 2. 任務進度（呼叫 bridge /tasks-summary）
  const taskLines = _fetchTasksSummary(props);

  // 3. 組合週報訊息
  const report = [
    '📊 良全 AI 團隊週報 ' + dateStr,
    '━━━━━━━━━━━━━━',
    '【系統健康】',
    healthLine,
    '',
    '【任務進度】',
    taskLines,
    '━━━━━━━━━━━━━━',
    '週會時請開啟 Claude Code 取得完整報告。',
  ].join('\n');

  _setRequestIsTest(true);
  sendReminder(ownerUid, report);
  Logger.log('[WeeklyReport] 已推播週報，日期：' + dateStr);
}

/**
 * 呼叫 bridge /tasks-summary，回傳格式化文字
 * bridge 離線時回傳提示但不中斷週報推播
 * @param {GoogleAppsScript.Properties.Properties} props
 * @returns {string}
 */
function _fetchTasksSummary(props) {
  const bridgeUrl = props.getProperty('BRIDGE_URL');
  if (!bridgeUrl) {
    return '（bridge 未啟動，任務進度無法取得）';
  }
  try {
    const resp = UrlFetchApp.fetch(bridgeUrl.replace(/\/$/, '') + '/tasks-summary', {
      muteHttpExceptions: true,
      followRedirects: true,
    });
    if (resp.getResponseCode() !== 200) {
      return '（bridge 回應異常：HTTP ' + resp.getResponseCode() + '）';
    }
    const data = JSON.parse(resp.getContentText());
    const lines = [];
    for (const sys of ['KPI', 'Course', 'CRM', 'Bridge']) {
      const info = data[sys];
      if (!info) continue;
      if (info.error) {
        lines.push(sys + ': 無法讀取');
        continue;
      }
      const p0Tag = info.p0_pending > 0 ? ' 🔴P0×' + info.p0_pending : '';
      const pendingTag = info.pending > 0 ? ' (' + info.pending + '待)' : ' ✓';
      lines.push(sys + ': ' + info.completion + '%' + pendingTag + p0Tag);
    }
    return lines.join('\n');
  } catch (e) {
    return '（bridge 連線失敗：' + e.message + '）';
  }
}

/**
 * 設定週報觸發器（手動在 GAS 執行一次即可）
 * 時間：每週一 09:05（Asia/Taipei）
 * 注意：只刪除 weeklyReport 觸發器，不影響 scheduledReminder
 */
function setupWeeklyReportTrigger() {
  // 移除舊的 weeklyReport 觸發器（避免重複）
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'weeklyReport') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('weeklyReport')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .nearMinute(5)
    .create();

  Logger.log('[WeeklyReport] 觸發器已設定：每週一 09:05 Asia/Taipei');
}
