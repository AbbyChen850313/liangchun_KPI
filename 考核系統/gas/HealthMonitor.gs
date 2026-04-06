// ============================================================
// HealthMonitor.gs — 四系統健康監控（Cloud Scheduler 觸發）
// ============================================================
//
// Script Properties 需設定：
//   SCHEDULER_SECRET  — Cloud Scheduler POST 時帶的驗證密鑰
//   OWNER_LINE_UID_TEST — 收通知的 LINE UID（與 apiNotifyOwner 共用）
//
// Cloud Scheduler 設定：
//   頻率: 每小時 (0 * * * *)
//   URL: GAS_WEB_APP_URL
//   Method: POST
//   Body: {"action":"apiHealthCheckAll","args":["<SCHEDULER_SECRET>"]}
//   Content-Type: application/json
// ============================================================

var HEALTH_TARGETS = {
  'KPI':     'https://kaohe-backend-843141939177.asia-east1.run.app/health',
  'Course':  'https://course-notifier-backend-1011727677078.asia-east1.run.app/health',
  'Survey':  'https://survey-backend-test-411923664862.asia-east1.run.app/health',
  'Expense': 'https://expense-backend-843141939177.asia-east1.run.app/health',
};

/**
 * 健康監控 API（Cloud Scheduler 每小時呼叫）
 * 用法：POST { action: 'apiHealthCheckAll', args: ['SCHEDULER_SECRET'] }
 */
function apiHealthCheckAll(schedulerSecret) {
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty('SCHEDULER_SECRET');
  if (!stored || schedulerSecret !== stored) {
    return { error: '認證失敗' };
  }

  const failures = _checkAllHealthEndpoints();

  if (failures.length > 0) {
    const msg = '⚠️ 系統健康異常 ' + _now() + '\n' + failures.join('\n');
    _notifyOwnerForHealth(msg, props);
  }

  return {
    checked: Object.keys(HEALTH_TARGETS).length,
    failures: failures,
    ok: failures.length === 0,
  };
}

/** 逐一 curl /health，回傳失敗清單 */
function _checkAllHealthEndpoints() {
  var failures = [];
  var names = Object.keys(HEALTH_TARGETS);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var url = HEALTH_TARGETS[name];
    try {
      var resp = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: true,
      });
      var code = resp.getResponseCode();
      if (code !== 200) {
        failures.push(name + ': HTTP ' + code);
      }
    } catch (e) {
      failures.push(name + ': 連線失敗 (' + e.message + ')');
    }
  }
  return failures;
}

/** 直接推 LINE 給 OWNER（不走 HTTP，直接呼叫函式） */
function _notifyOwnerForHealth(message, props) {
  var ownerUid = props.getProperty('OWNER_LINE_UID_TEST');
  if (!ownerUid) {
    Logger.log('[HealthMonitor] OWNER_LINE_UID_TEST 未設定，無法推通知');
    return;
  }
  _setRequestIsTest(true);
  sendReminder(ownerUid, message);
}

function _now() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'MM/dd HH:mm');
}
