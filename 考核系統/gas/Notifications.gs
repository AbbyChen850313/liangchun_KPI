// ============================================================
// Notifications.gs — LINE Bot 通知
// ============================================================

/**
 * 傳送 LINE Push Message 給單一使用者
 * @param {string} lineUid
 * @param {string} message
 */
function sendReminder(lineUid, message) {
  const url = 'https://api.line.me/v2/bot/message/push';
  const payload = JSON.stringify({
    to: lineUid,
    messages: [{
      type: 'text',
      text: message,
    }],
  });

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${_getBotToken()}`,
    },
    payload: payload,
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if (code !== 200) {
    Logger.log(`LINE Push 失敗 (${lineUid}): ${response.getContentText()}`);
    return false;
  }
  return true;
}

/**
 * 對所有尚未完成評分的主管發送提醒
 * @param {string} quarter
 * @param {boolean} [isTest=false]
 */
function sendReminderToAll(quarter, isTest) {
  const settings = getSettings();
  const deadline = settings['評分截止日'];
  const period = settings['評分期間描述'];

  const allStatus = getAllManagerStatus(quarter, !!isTest);
  let sent = 0;

  for (const status of allStatus) {
    if (status.pending <= 0) continue;
    // 測試環境優先用 testUid；正式環境用 lineUid
    const targetUid = isTest ? (status.testUid || status.lineUid) : status.lineUid;
    if (!targetUid) continue;

    const message =
      `📋 考核評分提醒\n\n` +
      `${period} 考核評分尚未完成\n` +
      `・已評分：${status.scored}人\n` +
      `・待評分：${status.pending}人\n` +
      `截止日：${deadline}\n\n` +
      `請盡快完成評分，謝謝！`;

    sendReminder(targetUid, message);
    sent++;
    Utilities.sleep(200); // 避免 LINE API 速率限制
  }

  return { success: true, notifiedCount: sent };
}

/**
 * 設定定時觸發器（在 GAS 部署後執行一次）
 */
function setupTriggers() {
  // 清除舊觸發器
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'scheduledReminder') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 每天早上9點執行排程檢查
  ScriptApp.newTrigger('scheduledReminder')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();
}

/**
 * 定時排程：檢查是否為通知時間點，若是則發送
 */
function scheduledReminder() {
  const settings = getSettings();
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');
  const notify1 = settings['通知時間點1'] ?
    Utilities.formatDate(new Date(settings['通知時間點1']), 'Asia/Taipei', 'yyyy/MM/dd') : '';
  const notify2 = settings['通知時間點2'] ?
    Utilities.formatDate(new Date(settings['通知時間點2']), 'Asia/Taipei', 'yyyy/MM/dd') : '';

  if (today === notify1 || today === notify2) {
    const quarter = settings['當前季度'] || getCurrentQuarter();
    const isTest  = settings['使用測試Channel'] === 'true' || settings['使用測試Channel'] === true;
    sendReminderToAll(quarter, isTest);
    Logger.log(`[${today}] 已發送提醒通知（${isTest ? '測試' : '正式'}環境）`);
  }
}
