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
  const quarter = settings['當前季度'] || getCurrentQuarter();
  const isTest  = settings['使用測試Channel'] === 'true' || settings['使用測試Channel'] === true;

  // 主管評分提醒
  const managerNotify1 = settings['通知時間點1'] ?
    Utilities.formatDate(new Date(settings['通知時間點1']), 'Asia/Taipei', 'yyyy/MM/dd') : '';
  const managerNotify2 = settings['通知時間點2'] ?
    Utilities.formatDate(new Date(settings['通知時間點2']), 'Asia/Taipei', 'yyyy/MM/dd') : '';
  if (today === managerNotify1 || today === managerNotify2) {
    sendReminderToAll(quarter, isTest);
    Logger.log(`[${today}] 已發送主管評分提醒（${isTest ? '測試' : '正式'}環境）`);
  }

  // 員工自評提醒
  const empNotify1 = settings['員工通知時間點1'] ?
    Utilities.formatDate(new Date(settings['員工通知時間點1']), 'Asia/Taipei', 'yyyy/MM/dd') : '';
  const empNotify2 = settings['員工通知時間點2'] ?
    Utilities.formatDate(new Date(settings['員工通知時間點2']), 'Asia/Taipei', 'yyyy/MM/dd') : '';
  if (today === empNotify1 || today === empNotify2) {
    sendSelfAssessReminderToAll(quarter, isTest);
    Logger.log(`[${today}] 已發送員工自評提醒（${isTest ? '測試' : '正式'}環境）`);
  }
}

// ============================================================
// 員工自評提醒
// ============================================================

/**
 * 查詢尚未完成自評的員工（有綁定 LINE 帳號的同仁）
 * @param {string} quarter
 * @param {boolean} isTest
 * @returns {Array<{name: string, lineUid: string}>}
 */
function getEmployeesWithIncompleteSelfAssessment(quarter, isTest) {
  // 1. 已送出自評的員工名單
  const selfSheet = _sheet('自評記錄');
  const submittedNames = new Set();
  if (selfSheet) {
    const selfData = selfSheet.getDataRange().getValues();
    for (let i = 1; i < selfData.length; i++) {
      if (selfData[i][0] === quarter && selfData[i][11] === '已送出') {
        submittedNames.add(String(selfData[i][1] || '').trim());
      }
    }
  }

  // 2. 所有已授權同仁的 LINE UID（以姓名對應）
  const accountData = _sheetRows('LINE帳號');
  const empUidByName = {};
  for (let i = 1; i < accountData.length; i++) {
    const status = String(accountData[i][COL_ACCOUNT.STATUS] || '').trim();
    if (status !== '已授權') continue;
    const role = String(accountData[i][COL_ACCOUNT.ROLE] || '').trim();
    if (role !== '同仁') continue;
    const name = String(accountData[i][COL_ACCOUNT.NAME] || '').trim();
    if (!name) continue;
    const uid  = String(accountData[i][COL_ACCOUNT.UID]      || '').trim();
    const testUid = String(accountData[i][COL_ACCOUNT.TEST_UID] || '').trim();
    empUidByName[name] = { uid, testUid };
  }

  // 3. 過濾：在員工資料中、有 UID、且未送出自評
  const empData = _sheetRows('員工資料');
  const result = [];
  for (let i = 1; i < empData.length; i++) {
    const name = String(empData[i][1] || '').trim();
    if (!name) continue;
    if (submittedNames.has(name)) continue;
    const uids = empUidByName[name];
    if (!uids) continue;
    const targetUid = isTest ? (uids.testUid || uids.uid) : uids.uid;
    if (!targetUid) continue;
    result.push({ name, lineUid: targetUid });
  }
  return result;
}

/**
 * 傳送員工自評 Flex Message 提醒
 * @param {string} lineUid
 * @param {string} employeeName
 * @param {string} deadline
 * @param {string} period
 * @param {string} liffId
 */
function sendSelfAssessFlexReminder(lineUid, employeeName, deadline, period, liffId) {
  const flexContainer = {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '14px',
      backgroundColor: '#2E7D32',
      contents: [{
        type: 'text',
        text: '📝 自評提醒',
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
          text: `${employeeName} 您好`,
          weight: 'bold',
          size: 'md',
          color: '#222222',
        },
        {
          type: 'text',
          text: `${period} 的員工自評尚未完成，請於截止日前填寫。`,
          wrap: true,
          size: 'sm',
          color: '#444444',
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
        color: '#2E7D32',
        action: {
          type: 'uri',
          label: '前往自評',
          uri: `https://liff.line.me/${liffId}`,
        },
      }],
    },
  };

  return _linePush(lineUid, [{
    type: 'flex',
    altText: `📝 自評提醒：${period} 自評截止日 ${deadline}，請盡快完成。`,
    contents: flexContainer,
  }]);
}

/**
 * 對所有尚未完成自評的員工發送 Flex Message 提醒
 * @param {string} quarter
 * @param {boolean} [isTest=false]
 */
function sendSelfAssessReminderToAll(quarter, isTest) {
  const settings = getSettings();
  const deadline = settings['評分截止日'] || '（未設定）';
  const period   = settings['評分期間描述'] || quarter;
  const liffId   = isTest ? CONFIG.LIFF_ID_TEST : CONFIG.LIFF_ID;

  const incompleteEmployees = getEmployeesWithIncompleteSelfAssessment(quarter, !!isTest);
  let sent = 0;

  for (const emp of incompleteEmployees) {
    sendSelfAssessFlexReminder(emp.lineUid, emp.name, deadline, period, liffId);
    sent++;
    Utilities.sleep(200); // 避免 LINE API 速率限制
  }

  return { success: true, notifiedCount: sent };
}
