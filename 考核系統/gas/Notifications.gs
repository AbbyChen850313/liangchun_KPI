// ============================================================
// Notifications.gs — LINE Bot 通知
// ============================================================

/**
 * 傳送 LINE Push Message（純文字，向下相容）
 * @param {string} lineUid
 * @param {string} message
 */
function sendReminder(lineUid, message) {
  return _linePush(lineUid, [{ type: 'text', text: message }]);
}

/**
 * 傳送 LINE Flex Message 評分提醒
 * @param {string} lineUid
 * @param {{ managerName: string, scored: number, pending: number, total: number }} status
 * @param {string} deadline
 * @param {string} period
 * @param {string} liffId
 */
function sendFlexReminder(lineUid, status, deadline, period, liffId) {
  const flexContainer = {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '14px',
      backgroundColor: '#1565C0',
      contents: [{
        type: 'text',
        text: '📋 考核評分提醒',
        color: '#ffffff',
        weight: 'bold',
        size: 'lg',
      }],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        {
          type: 'text',
          text: `${period} 尚有待評分`,
          wrap: true,
          size: 'sm',
          color: '#444444',
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: '已評分', size: 'sm', color: '#666666', flex: 1 },
            {
              type: 'text',
              text: `${status.scored} 人`,
              size: 'sm',
              align: 'end',
              flex: 1,
              color: '#2E7D32',
              weight: 'bold',
            },
          ],
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: '待評分', size: 'sm', color: '#666666', flex: 1 },
            {
              type: 'text',
              text: `${status.pending} 人`,
              size: 'sm',
              align: 'end',
              flex: 1,
              color: '#C62828',
              weight: 'bold',
            },
          ],
        },
        { type: 'separator' },
        {
          type: 'text',
          text: `截止日：${deadline}`,
          size: 'xs',
          color: '#888888',
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [{
        type: 'button',
        style: 'primary',
        color: '#1565C0',
        action: {
          type: 'uri',
          label: '前往評分',
          uri: `https://liff.line.me/${liffId}`,
        },
      }],
    },
  };

  return _linePush(lineUid, [{
    type: 'flex',
    altText: `📋 考核評分提醒：${period} 待評分 ${status.pending} 人，截止 ${deadline}`,
    contents: flexContainer,
  }]);
}

/**
 * 底層 LINE Push API 呼叫
 * @param {string} lineUid
 * @param {Array} messages  LINE message objects
 */
function _linePush(lineUid, messages) {
  const url = 'https://api.line.me/v2/bot/message/push';
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${_getBotToken()}` },
    payload: JSON.stringify({ to: lineUid, messages }),
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
 * 對所有尚未完成評分的主管發送 Flex Message 提醒
 * @param {string} quarter
 * @param {boolean} [isTest=false]
 */
function sendReminderToAll(quarter, isTest) {
  const settings = getSettings();
  const deadline = settings['評分截止日'] || '（未設定）';
  const period = settings['評分期間描述'] || quarter;
  const liffId = isTest ? CONFIG.LIFF_ID_TEST : CONFIG.LIFF_ID;

  const allStatus = getAllManagerStatus(quarter, !!isTest);
  let sent = 0;

  for (const status of allStatus) {
    if (status.pending <= 0) continue;
    // 測試環境優先用 testUid；正式環境用 lineUid
    const targetUid = isTest ? (status.testUid || status.lineUid) : status.lineUid;
    if (!targetUid) continue;

    sendFlexReminder(targetUid, status, deadline, period, liffId);
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
