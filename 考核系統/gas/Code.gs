// ============================================================
// Code.gs — 主路由 & LIFF Web App 入口
// ============================================================

const CONFIG = {
  SPREADSHEET_ID:    '1VKHfnnrv-xfdqj-36I6grY8K-YcuCd8WMIcNAvRA_eg',
  HR_SPREADSHEET_ID: '1hOBSm5BnCjsrp2rX51EN5kYVtEgLZ8FVIMF90_5BMqA',
  // Token 存於 Script Properties（不放 code）
  // 初次設定請執行 apiBootstrapLineTokens 端點
  get LINE_BOT_TOKEN()      { return _getRequiredProp('LINE_BOT_TOKEN'); },
  get LINE_BOT_TOKEN_TEST() { return _getRequiredProp('LINE_BOT_TOKEN_TEST'); },
  LIFF_ID:      '2009611318-5UphK9JK',
  LIFF_ID_TEST: '2009619528-aJO34c6u',
};

/** 讀取必要的 Script Property，未設定時拋明確錯誤 */
function _getRequiredProp(key) {
  const val = PropertiesService.getScriptProperties().getProperty(key);
  if (!val) throw new Error(`Script Property '${key}' 未設定，請執行 setupLineTokens() 或呼叫 apiBootstrapLineTokens`);
  return val;
}

// ============================================================
// Request context（測試/正式環境路由）
// ============================================================
// GAS 每次 HTTP 請求是獨立執行環境（無跨請求共享狀態）。
// doPost() 在呼叫 API 前設定此值，之後 _ss() 自動路由到對應 Spreadsheet。
let _REQUEST_IS_TEST = false;
function _setRequestIsTest(val) { _REQUEST_IS_TEST = !!val; }
function _isTestRequest()        { return _REQUEST_IS_TEST; }

// ============================================================
// Sheets 存取 Helper（所有 .gs 檔案共用）
// ============================================================

/**
 * 取得後台 Spreadsheet（依 request context 自動路由測試/正式）
 * 測試環境讀取 Script Property「TEST_SPREADSHEET_ID」指定的 Spreadsheet
 */
function _ss() {
  if (_REQUEST_IS_TEST) {
    const testId = PropertiesService.getScriptProperties().getProperty('TEST_SPREADSHEET_ID');
    if (testId) return SpreadsheetApp.openById(testId);
    Logger.log('WARN: TEST_SPREADSHEET_ID 未設定，回退正式 Spreadsheet');
  }
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

/** 取得指定工作表（找不到回傳 null） */
function _sheet(name) {
  return _ss().getSheetByName(name);
}

/**
 * 取得工作表所有資料列（找不到或空表回傳空陣列）
 * 使用此 helper 可避免 null.getDataRange() 錯誤
 */
function _sheetRows(name) {
  const s = _sheet(name);
  return s ? s.getDataRange().getValues() : [];
}

// ============================================================
// 測試環境初始化（首次部署後在 GAS 編輯器執行一次）
// ============================================================

/** 設定測試 Spreadsheet ID 到 Script Properties */
function bootstrapTestEnv() {
  const TEST_ID = '1TCOXZ0hp20h4Vr0JyLyedO64TPaSnw9GX30Fuh8Pdyg';
  PropertiesService.getScriptProperties().setProperty('TEST_SPREADSHEET_ID', TEST_ID);
  Logger.log('✅ TEST_SPREADSHEET_ID 已設定：' + TEST_ID);
}

/** 初始化測試 Spreadsheet 所有工作表（首次設定時執行一次） */
function initTestSpreadsheet() {
  _setRequestIsTest(true);
  initAllSheets();
  Logger.log('✅ 測試 Spreadsheet 初始化完成');
  _setRequestIsTest(false);
}

// ============================================================
// 身份驗證 Helper
// ============================================================

/**
 * 驗證主管身份
 * @returns managerInfo 物件，或 { error: '身份驗證失敗' }
 */
function _verifyManager(lineUid) {
  const info = getManagerInfo(lineUid);
  return info || { error: '身份驗證失敗' };
}

/**
 * 驗證 HR 身份
 * @returns managerInfo 物件，或 { error: '無權限' }
 */
function _verifyHR(lineUid) {
  const info = getManagerInfo(lineUid);
  return (info && info.isHR) ? info : { error: '無權限' };
}

/**
 * 驗證系統管理員身份
 * @returns managerInfo 物件，或 { error: '無系統管理員權限' }
 */
function _verifySysAdmin(lineUid) {
  const info = getManagerInfo(lineUid);
  return (info && info.isSysAdmin) ? info : { error: '無系統管理員權限' };
}

/**
 * 驗證 HR 或系統管理員身份（任一即可）
 * @returns managerInfo 物件，或 { error: '無權限' }
 */
function _verifyHROrSysAdmin(lineUid) {
  const info = getManagerInfo(lineUid);
  return (info && (info.isHR || info.isSysAdmin)) ? info : { error: '無權限' };
}

// ============================================================
// Web App 路由
// ============================================================

// ============================================================
// 系統日誌
// ============================================================

/**
 * 寫入一筆日誌到「系統日誌」工作表
 * @param {'INFO'|'WARN'|'ERROR'} level
 * @param {string} fn  - 函式名稱（方便定位）
 * @param {string} msg - 簡短說明
 * @param {*} [detail] - 附加資料（物件/字串都行）
 */
function _log(level, fn, msg, detail) {
  try {
    const ss = _ss();
    let sheet = ss.getSheetByName('系統日誌');
    if (!sheet) {
      sheet = ss.insertSheet('系統日誌');
      sheet.getRange(1, 1, 1, 5).setValues([['時間', '等級', '函式', '說明', '詳細資料']]);
      sheet.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#37474f').setFontColor('#ffffff');
      sheet.setColumnWidth(1, 160);
      sheet.setColumnWidth(5, 400);
    }
    const detailStr = detail !== undefined
      ? (typeof detail === 'object' ? JSON.stringify(detail) : String(detail))
      : '';
    sheet.appendRow([new Date(), level, fn, msg, detailStr]);

    // 只保留最近 500 筆，避免表格過大
    const lastRow = sheet.getLastRow();
    if (lastRow > 501) {
      sheet.deleteRows(2, lastRow - 501);
    }
  } catch (_) {
    // log 本身不能崩潰
    Logger.log(`[_log failed] ${level} ${fn} ${msg}`);
  }
}

/**
 * 一次性設定 NOTIFY_SECRET（若未設定過才有效，設定後回傳 secret）
 * 第一次呼叫：設定並回傳 secret；之後呼叫：回傳 { error: 'already set' }
 * 用法：POST { action: 'apiBootstrapNotifySecret', args: [] }
 */
function apiBootstrapNotifySecret() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('NOTIFY_SECRET')) return { error: 'already set' };
  const secret = Utilities.getUuid();
  props.setProperty('NOTIFY_SECRET', secret);
  return { secret };
}

/**
 * 設定 Bridge server URL（供 Claude 觸發用）
 * 用法：POST { action: 'apiSetBridgeUrl', args: ['SECRET', 'https://xxxx.trycloudflare.com'] }
 */
function apiSetBridgeUrl(secret, bridgeUrl) {
  const stored = PropertiesService.getScriptProperties().getProperty('NOTIFY_SECRET');
  if (!stored || secret !== stored) return { error: '認證失敗' };
  PropertiesService.getScriptProperties().setProperty('BRIDGE_URL', bridgeUrl);
  return { success: true, bridgeUrl };
}

/**
 * 重設 NOTIFY_SECRET 並回傳新值（Bridge 首次設定用）
 * 呼叫後舊 secret 立即失效
 */
function apiForceResetNotifySecret() {
  const secret = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('NOTIFY_SECRET', secret);
  return { secret };
}

/**
 * 直接推播 LINE 訊息給 OWNER_LINE_UID_TEST（bridge 通知用）
 * 用法：POST { action: 'apiNotifyOwner', args: ['SECRET', '訊息'] }
 */
function apiNotifyOwner(secret, message) {
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty('NOTIFY_SECRET');
  if (!stored || secret !== stored) return { error: '認證失敗' };

  const ownerUid = props.getProperty('OWNER_LINE_UID_TEST');
  if (!ownerUid) return { error: 'OWNER_LINE_UID_TEST 未設定，請先傳送 ping 給 ABBY_Test bot' };

  _setRequestIsTest(true);
  const ok = sendReminder(ownerUid, message);
  return { success: ok };
}

/**
 * 傳送 LINE 訊息給所有 HR / 系統管理員帳號（供 Claude Code 通知用）
 * 用法：POST { action: 'apiNotifyHR', args: ['SECRET', '訊息內容'] }
 * SECRET 需與 Script Property 'NOTIFY_SECRET' 相符
 */
function apiNotifyHR(secret, message) {
  const stored = PropertiesService.getScriptProperties().getProperty('NOTIFY_SECRET');
  if (!stored || secret !== stored) return { error: '認證失敗' };

  // 從正式 sheet 讀 HR/SysAdmin 帳號（帳號資料在正式環境），透過 TEST_UID 用測試 bot 發送
  _setRequestIsTest(false);
  const rows = _sheetRows('LINE帳號');
  let sent = 0;
  for (let i = 1; i < rows.length; i++) {
    const role   = String(rows[i][COL_ACCOUNT.ROLE]     || '').trim();
    const status = String(rows[i][COL_ACCOUNT.STATUS]   || '').trim();
    if (status !== '已授權') continue;
    if (role !== 'HR' && role !== '系統管理員') continue;

    // 只發給有 TEST_UID 的帳號（正式 UID 無法透過測試 bot 送出）
    const testUid = String(rows[i][COL_ACCOUNT.TEST_UID] || '').trim();
    if (!testUid) continue;

    try {
      _setRequestIsTest(true);
      sendReminder(testUid, message);
      sent++;
    } catch (e) {
      _log('WARN', 'apiNotifyHR', `發送失敗：${testUid}`, e.message);
    } finally {
      _setRequestIsTest(false);
    }
  }
  return { success: true, sent };
}


/**
 * GitHub Pages 前端透過 fetch() 呼叫 GAS API
 * 接收 POST body: { action: 'apiFnName', args: [...] }
 */
function doPost(e) {
  let action = '(unknown)';
  try {
    const body = JSON.parse(e.postData.contents);

    // LINE Webhook 事件（Bot 收到訊息）
    if (body.events) {
      _setRequestIsTest(getActiveEnv().isTest); // 確保 webhook handler 路由到正確 Spreadsheet
      _handleLineWebhook(body.events);
      return _jsonOut({ ok: true });
    }

    action = body.action;
    const args = body.args || [];

    // 根據 action/args 設定 request-level isTest context（決定路由到哪個 Spreadsheet）
    const _IS_TEST_EXTRACTORS = {
      apiGetScoreStatus:      a => !!a[1],
      apiGetMyScores:         a => !!a[2],
      apiGetDashboard:        a => !!a[1],
      apiGetAllStatus:        a => !!a[1],
      apiGetManagerDashboard: a => !!a[2],
      apiTriggerReminders:    a => !!a[1],
      apiExportExcel:         a => !!a[2],
      apiSaveDraft:           a => !!(a[0] && a[0].isTest),
      apiSubmitScore:         a => !!(a[0] && a[0].isTest),
      apiCheckBinding:        a => !!a[1],
      apiBindByIdentity:      a => !!a[5],
      apiGetEmployeesForManager: a => !!a[1],
      apiSyncEmployees:       a => !!a[1],
      apiGetAllAccounts:      a => !!a[1],
      apiResetAccount:        a => !!a[2],
      apiGetLogs:             a => !!a[1],
    };
    _setRequestIsTest(_IS_TEST_EXTRACTORS[action] ? _IS_TEST_EXTRACTORS[action](args) : false);

    const API = {
      apiCheckBinding,
      apiBindByIdentity,
      apiGetScoreStatus,
      apiGetMyScores,
      apiGetEmployeesForManager,
      apiSaveDraft,
      apiSubmitScore,
      apiSyncEmployees,
      apiGetSettings,
      apiGetAllStatus,
      apiUpdateSettings,
      apiTriggerReminders,
      apiExportExcel,
      apiGetAllAccounts,
      apiResetAccount,
      apiGetLogs,
      apiGetManagerDashboard,
      apiGetDashboard,
      apiRefreshAllRoles,
      apiVerifyBindCode,
      apiBootstrapNotifySecret,
      apiForceResetNotifySecret,
      apiNotifyHR,
      apiNotifyOwner,
      apiSetBridgeUrl,
      apiUpdateRole,
    };
    if (!API[action]) {
      _log('WARN', 'doPost', `未知 action: ${action}`);
      return _jsonOut({ error: `Unknown action: ${action}` });
    }
    const result = API[action](...(args || []));
    // 業務邏輯回傳 error 時也記錄
    if (result && result.error) {
      _log('WARN', action, result.error, { args: _sanitizeArgs(action, args) });
    }
    return _jsonOut(result);
  } catch (err) {
    _log('ERROR', action, err.message, { stack: err.stack });
    return _jsonOut({ error: err.message });
  }
}

/** 遮蔽 args 裡的 lineUid（避免日誌洩漏身份） */
function _sanitizeArgs(action, args) {
  if (!args) return [];
  // 第一個參數通常是 lineUid，只保留最後 4 碼
  return args.map((a, i) => {
    if (i === 0 && typeof a === 'string' && a.length > 8) {
      return '…' + a.slice(-4);
    }
    return a;
  });
}

function _jsonOut(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  // LIFF bind page 的 REST API（GitHub Pages 呼叫用）
  if (e.parameter.action) {
    return _handleLiffBindAction(e.parameter);
  }

  const page = e.parameter.page || 'dashboard';
  const lineUid = e.parameter.uid || '';
  const isTest = e.parameter.isTest === 'true';
  const liffId = isTest ? CONFIG.LIFF_ID_TEST : CONFIG.LIFF_ID;

  let template;
  switch (page) {
    case 'score':
      template = HtmlService.createTemplateFromFile('score');
      template.employeeId = e.parameter.eid || '';
      template.lineUid = lineUid;
      template.liffId = liffId;
      template.isTest = isTest;
      break;
    case 'admin':
      template = HtmlService.createTemplateFromFile('admin');
      template.lineUid = lineUid;
      template.liffId = liffId;
      template.isTest = isTest;
      break;
    case 'sysadmin':
      template = HtmlService.createTemplateFromFile('sysadmin');
      template.lineUid = lineUid;
      template.liffId = liffId;
      template.isTest = isTest;
      break;
    case 'bind':
      template = HtmlService.createTemplateFromFile('bind');
      template.lineUid = '';
      template.liffId = liffId;
      template.isTest = isTest;
      break;
    default:
      template = HtmlService.createTemplateFromFile('dashboard');
      template.lineUid = lineUid;
      template.liffId = liffId;
      template.isTest = isTest;
  }

  return template.evaluate()
    .setTitle('考核系統')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * LIFF 綁定頁面（GitHub Pages 靜態頁）專用 GET API
 * 支援 action: checkBinding / bindByIdentity / unbindSelf
 */
function _handleLiffBindAction(params) {
  try {
    const action = params.action;
    const uid    = params.uid || '';
    let result;

    if (action === 'checkBinding') {
      const isTestCheck = params.isTest === 'true' || params.isTest === true;
      result = apiCheckBinding(uid, isTestCheck);

    } else if (action === 'bindByIdentity') {
      const isTestBind = params.isTest === 'true' || params.isTest === true;
      _setRequestIsTest(isTestBind);
      result = apiBindByIdentity(
        uid,
        params.displayName || '',
        params.name        || '',
        params.eid         || '',
        params.phone       || '',
        isTestBind
      );

    } else {
      result = { error: 'unknown action: ' + action };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** 計算當前季度（民國年，如 115Q1） */
function getCurrentQuarter() {
  const now = new Date();
  const rocYear = now.getFullYear() - 1911;
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `${rocYear}Q${q}`;
}

// ============================================================
// API 路由（前端透過 google.script.run 呼叫）
// 新增 API 請遵循以下模式：
//   1. 用 _verifyManager / _verifyHR 做身份驗證
//   2. 若驗證失敗直接 return error 物件
//   3. 業務邏輯委託給對應的 .gs 模組
// ============================================================

// --- Auth ---
// apiBindByIdentity, apiCheckBinding 定義於 Auth.gs

// --- Employees ---
function apiGetEmployeesForManager(lineUid, isTest) {
  const info = _verifyManager(lineUid);
  if (info.error) return info;
  return getEmployeesForManager(info);
}

function apiSyncEmployees(lineUid, isTest) {
  const info = _verifyHROrSysAdmin(lineUid);
  if (info.error) return info;
  const result = syncEmployees();
  _log('INFO', 'apiSyncEmployees', `${info.managerName} 同步員工完成`, { count: result && result.count });
  return result;
}

function apiGetSettings() {
  return getSettings();
}

// --- Scoring ---
function apiSaveDraft(data) {
  const info = _verifyManager(data && data.lineUid);
  if (info.error) return info;
  return saveDraft(data);
}

function apiSubmitScore(data) {
  const info = _verifyManager(data && data.lineUid);
  if (info.error) return info;
  return submitScore(data);
}

function apiGetMyScores(lineUid, quarter, isTest) {
  const info = getManagerInfo(lineUid);
  if (!info) return { error: '身份驗證失敗' };
  if (!info.isHR && info.responsibilities.length === 0) return { error: '無權限' };
  return getMyScores(lineUid, quarter || getCurrentQuarter(), !!isTest);
}

function apiGetScoreStatus(lineUid, isTest) {
  const info = _verifyManager(lineUid);
  if (info.error) return info;
  if (info.isSysAdmin) return { isSysAdmin: true, managerName: info.managerName };
  if (info.isHR) return { isHR: true };
  const status = getScoreStatus(info, getCurrentQuarter(), !!isTest);
  status.managerName = info.managerName;
  return status;
}

/** 一次回傳儀表板所需所有資料，減少前端 API 來回次數 */
function apiGetDashboard(lineUid, isTest) {
  const info = _verifyManager(lineUid);
  if (info.error) return info;

  if (info.isHR) return { isHR: true };

  if (info.isSysAdmin) {
    const accounts = apiGetAllAccounts(lineUid);
    return {
      isSysAdmin: true,
      managerName: info.managerName,
      accounts: Array.isArray(accounts) ? accounts : [],
      settings: getSettings(),
    };
  }

  const quarter = getCurrentQuarter();
  const status = getScoreStatus(info, quarter, !!isTest);
  const myScores = getMyScores(lineUid, quarter, !!isTest);
  const settings = getSettings();

  return {
    quarter: status.quarter,
    total: status.total,
    scored: status.scored,
    draft: status.draft,
    pending: status.pending,
    employees: status.employees,
    managerName: info.managerName,
    myScores,
    settings,
  };
}

// --- Admin (HR only) ---
function apiGetAllStatus(lineUid, isTest) {
  const info = _verifyHROrSysAdmin(lineUid);
  if (info.error) return info;
  return getAllManagerStatus(getCurrentQuarter(), !!isTest);
}

function apiUpdateSettings(lineUid, newSettings) {
  const info = _verifyHROrSysAdmin(lineUid);
  if (info.error) return info;
  const result = updateSettings(newSettings);
  _log('INFO', 'apiUpdateSettings', `${info.managerName} 更新系統設定`, { keys: Object.keys(newSettings || {}) });
  return result;
}

function apiTriggerReminders(lineUid, isTest) {
  const info = _verifyHROrSysAdmin(lineUid);
  if (info.error) return info;
  return sendReminderToAll(getCurrentQuarter(), !!isTest);
}

function apiExportExcel(lineUid, quarter, isTest) {
  const info = _verifyHROrSysAdmin(lineUid);
  if (info.error) return info;
  return exportScores(quarter || getCurrentQuarter(), !!isTest);
}

/** HR 或系統管理員以指定主管 UID 查看其儀表板（員工列表＋評分狀態） */
function apiGetManagerDashboard(hrLineUid, targetManagerUid, isTest) {
  const info = _verifyHROrSysAdmin(hrLineUid);
  if (info.error) return info;
  const managerInfo = getManagerInfo(targetManagerUid);
  if (!managerInfo) return { error: '查無此主管帳號' };
  const quarter = getCurrentQuarter();
  const status = getScoreStatus(managerInfo, quarter, !!isTest);
  const scores = getMyScores(targetManagerUid, quarter, !!isTest);
  _log('INFO', 'apiGetManagerDashboard', `${info.managerName} 模擬查看 ${managerInfo.managerName}`, { isTest: !!isTest });
  status.managerName = managerInfo.managerName;
  status.employees = status.employees.map(emp => ({
    ...emp,
    scoreStatus: (scores[emp.name] && scores[emp.name].status) || emp.scoreStatus,
  }));
  return status;
}

/** 取得最近 100 筆日誌（HR 或系統管理員） */
function apiGetLogs(lineUid) {
  const info = _verifyHROrSysAdmin(lineUid);
  if (info.error) return info;

  const sheet = _sheet('系統日誌');
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  // 回傳最新 100 筆（倒序，最新在前）
  return data.slice(1).reverse().slice(0, 100).map(r => ({
    time:   r[0] ? new Date(r[0]).toLocaleString('zh-TW') : '',
    level:  r[1] || '',
    fn:     r[2] || '',
    msg:    r[3] || '',
    detail: r[4] || '',
  }));
}

// ============================================================
// LINE Webhook 處理
// ============================================================

// ── 需要 ping 確認才執行的高風險指令 ──────────────────────────
// 流程：傳指令 → 系統暫存 → 傳 ping → 系統執行 + 顯示狀態
// 低風險指令直接執行，不需 ping 確認

/** 暫存待確認動作（有效期 5 分鐘） */
function _setPendingAction(uid, action) {
  PropertiesService.getScriptProperties()
    .setProperty(`PENDING_${uid}`, JSON.stringify({ action, ts: Date.now() }));
}

/** 取出待確認動作（取出後立即清除；逾時回 null） */
function _popPendingAction(uid) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(`PENDING_${uid}`);
  if (!raw) return null;
  props.deleteProperty(`PENDING_${uid}`);
  const { action, ts } = JSON.parse(raw);
  return (Date.now() - ts < 5 * 60 * 1000) ? action : null;
}

function _handleLineWebhook(events) {
  events.forEach(event => {
    if (event.type !== 'message' || event.message.type !== 'text') return;
    const text = event.message.text.trim();
    const replyToken = event.replyToken;
    const uid = event.source.userId;
    const settings = getSettings();

    // ── ping：先執行暫存動作（若有），再回傳狀態 ──────────────
    if (text === 'ping') {
      const pending = _popPendingAction(uid);
      let execMsg = '';
      if (pending) {
        try {
          execMsg = _executePendingAction(pending, uid, settings);
        } catch (err) {
          execMsg = `❌ 執行失敗：${err.message}`;
        }
      }
      // 測試 Channel 的 ping：自動登記為 OWNER（Bridge 通知對象）
      const env = getActiveEnv();
      if (env.isTest) {
        const props = PropertiesService.getScriptProperties();
        if (!props.getProperty('OWNER_LINE_UID_TEST')) {
          props.setProperty('OWNER_LINE_UID_TEST', uid);
        }
      }
      const statusMsg = [
        '🤖 系統回應 OK',
        `環境：${env.isTest ? '✅ 測試Channel' : '⚠️ 正式Channel'}`,
        `季度：${settings['當前季度'] || '未設定'}`,
        `評分期間：${settings['評分期間描述'] || '未設定'}`,
      ].join('\n');
      _lineReply(replyToken, execMsg ? `${execMsg}\n\n${statusMsg}` : statusMsg);

    // ── 低風險：直接執行 ──────────────────────────────────────
    } else if (text === '設定' || text === '綁定設定') {
      const _today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd');
      _lineReply(replyToken, `請點以下連結進行帳號綁定：\nhttps://liff.line.me/${getActiveEnv().liffId}?v=${_today}`);

    } else if (text === '主管') {
      const richMenuId = settings['RichMenu_C1'];
      if (richMenuId) { _linkRichMenuToUser(uid, richMenuId); _lineReply(replyToken, '已切換到主管選單 (C1)'); }
      else { _lineReply(replyToken, '尚未設定 Rich Menu，請先執行 setupRichMenus()'); }

    } else if (text === '同仁') {
      const richMenuId = settings['RichMenu_B'];
      if (richMenuId) { _linkRichMenuToUser(uid, richMenuId); _lineReply(replyToken, '已切換到同仁選單 (B)'); }
      else { _lineReply(replyToken, '尚未設定 Rich Menu，請先執行 setupRichMenus()'); }

    } else if (text === '重置') {
      const richMenuId = settings['RichMenu_A'];
      if (richMenuId) { _linkRichMenuToUser(uid, richMenuId); _lineReply(replyToken, '已重置為雜人選單 (A)'); }
      else { _lineReply(replyToken, '尚未設定 Rich Menu，請先執行 setupRichMenus()'); }

    } else if (text === '更新選單') {
      const userInfo = getManagerInfo(uid);
      if (!userInfo) {
        _lineReply(replyToken, '❌ 請先完成帳號綁定');
      } else {
        switchRichMenuByRole(uid, userInfo.role);
        _lineReply(replyToken, `✅ 選單已依目前角色（${userInfo.role || '同仁'}）更新`);
      }

    } else if (text === '取消綁定') {
      const accountSheet = _sheet('LINE帳號');
      if (accountSheet) {
        const data = accountSheet.getDataRange().getValues();
        let deleted = false;
        let deletedName = '';
        for (let i = data.length - 1; i >= 1; i--) {
          if (data[i][1] === uid) {
            deletedName = String(data[i][0] || '');
            accountSheet.deleteRow(i + 1);
            deleted = true;
          }
        }
        _emit('account.unbound', { lineUid: uid });
        if (deleted) {
          _log('INFO', '取消綁定', `帳號已解除：${deletedName}`, { uid: '…' + uid.slice(-4) });
        } else {
          _log('WARN', '取消綁定', '找不到綁定資料', { uid: '…' + uid.slice(-4) });
        }
        _lineReply(replyToken, deleted ? '✅ 已解除帳號綁定\n如需重新綁定，請傳「設定」取得連結' : '⚠️ 找不到您的綁定資料');
      } else {
        _lineReply(replyToken, '❌ 系統錯誤：找不到 LINE帳號 工作表');
      }

    } else if (text === '初始化') {
      const adminInfo = getManagerInfo(uid);
      if (!adminInfo) {
        _lineReply(replyToken, '❌ 請先完成帳號綁定');
      } else {
        try {
          setupRoleDropdown();
          setupAccountCheckboxes();
          _log('INFO', '初始化', `${adminInfo.managerName} 執行初始化`);
          _lineReply(replyToken, '✅ 初始化完成\n- H欄（角色）下拉選單已建立\n- I欄（清除帳號）checkbox 已修正\n\n請去 Sheet 把你的帳號 H 欄設為「系統管理員」');
        } catch (err) {
          _log('ERROR', '初始化', err.message, { stack: err.stack });
          _lineReply(replyToken, '❌ 初始化失敗：' + err.message);
        }
      }

    } else if (text === '更新文件') {
      const adminInfo = getManagerInfo(uid);
      if (!adminInfo || !adminInfo.isSysAdmin) {
        _lineReply(replyToken, '❌ 無權限');
      } else {
        try {
          initDocumentationSheets();
          setupRoleDropdown();
          setupAccountCheckboxes();
          fixPhoneFormat();
          protectRoleColumn();
          _log('INFO', '更新文件', `${adminInfo.managerName} 更新文件完成`);
          _lineReply(replyToken, '✅ 完成\n- 權限設定 / 系統說明 / 操作手冊已更新\n- H欄下拉 & I欄 checkbox 已補齊\n- G欄電話格式已修復\n- H欄（角色）保護已設定');
        } catch (err) {
          _log('ERROR', '更新文件', err.message, { stack: err.stack });
          _lineReply(replyToken, '❌ 失敗：' + err.message);
        }
      }

    // ── 高風險：暫存 → 等 ping 確認後才執行 ─────────────────
    } else if (text === '啟用測試') {
      const adminInfo = getManagerInfo(uid);
      if (!adminInfo || !adminInfo.isSysAdmin) {
        _lineReply(replyToken, '❌ 無權限');
      } else {
        _setPendingAction(uid, '啟用測試');
        _lineReply(replyToken, '⚠️ 即將切換到【測試環境】\n確認請傳 ping（5分鐘內有效）');
      }

    } else if (text === '啟用正式') {
      const adminInfo = getManagerInfo(uid);
      if (!adminInfo || !adminInfo.isSysAdmin) {
        _lineReply(replyToken, '❌ 無權限');
      } else {
        _setPendingAction(uid, '啟用正式');
        _lineReply(replyToken, '⚠️ 即將切換到【正式環境】，請確認！\n確認請傳 ping（5分鐘內有效）');
      }

    } else if (text === '建立選單') {
      const adminInfo = getManagerInfo(uid);
      if (!adminInfo || !adminInfo.isSysAdmin) {
        _lineReply(replyToken, '❌ 無權限');
      } else {
        _setPendingAction(uid, '建立選單');
        _lineReply(replyToken, '⚠️ 即將重建所有 Rich Menu\n確認請傳 ping（5分鐘內有效）');
      }

    // ── owner 登記：儲存傳送者的 UID 為 Bridge 通知對象 ───────
    } else if (text === 'owner') {
      const props = PropertiesService.getScriptProperties();
      const bridgeUrl = props.getProperty('BRIDGE_URL');
      if (!bridgeUrl) {
        _lineReply(replyToken, '⚠️ Bridge 尚未設定，此指令目前無效');
      } else {
        props.setProperty('OWNER_LINE_UID_TEST', uid);
        _lineReply(replyToken, '✅ 已登記！之後 Claude 修好 bug 會直接通知你');
      }

    // ── bug 回報：轉發到 bridge server 觸發 Claude agent ──────
    } else if (/^bug:/i.test(text)) {
      _handleBugReport(text, uid, replyToken);

    // ── 24h 循環：loop:kpi 目標說明 ────────────────────────────
    } else if (/^loop:/i.test(text)) {
      _handleLoopCommand(text, replyToken);

    // ── 停止循環：stop:kpi ──────────────────────────────────────
    } else if (/^stop:/i.test(text)) {
      _handleStopCommand(text, replyToken);

    // ── 查詢狀態：status ────────────────────────────────────────
    } else if (text === 'status' || text === '狀態') {
      _handleStatusCommand(replyToken);

    } else if (text === 'help' || text === '指令') {
      const userInfo = getManagerInfo(uid);
      const isSysAdmin = userInfo && userInfo.isSysAdmin;
      const lines = [
        '📋 可用指令：',
        '',
        'ping — 確認狀態（同時執行待確認動作）',
        '設定 — 取得綁定連結',
        '取消綁定 — 解除帳號綁定',
        '更新選單 — 依角色同步圖文選單',
        '主管 / 同仁 / 重置 — 手動切換選單',
        '',
        '🤖 Claude 自動開發（24h 循環）：',
        'loop:kpi 目標   — 啟動考核系統循環',
        'loop:course 目標 — 啟動課程系統循環',
        'loop:survey 目標 — 啟動問卷系統循環',
        'stop:kpi/course/survey — 停止循環',
        'status — 查看各專案狀態',
        '',
        '🐛 Bug 回報（單次修復）：',
        'bug: kpi 描述   — 考核系統',
        'bug: course 描述 — 課程系統',
        'bug: survey 描述 — 泰旺問卷',
      ];
      if (isSysAdmin) {
        lines.push('');
        lines.push('🔧 系統管理員（需 ping 確認）：');
        lines.push('初始化 — 建立角色下拉與 checkbox');
        lines.push('更新文件 — 更新說明 Sheet');
        lines.push('啟用測試 / 啟用正式 → ping 執行');
        lines.push('建立選單 → ping 執行');
      }
      _lineReply(replyToken, lines.join('\n'));
    }
  });
}

/**
 * 處理 bug 回報，解析專案名稱並轉發到 bridge server
 * 格式：bug: kpi 描述  /  bug: course 描述  /  bug: survey 描述
 */
function _handleBugReport(text, uid, replyToken) {
  const bridgeUrl = PropertiesService.getScriptProperties().getProperty('BRIDGE_URL');
  if (!bridgeUrl) {
    _lineReply(replyToken, '⚠️ Bridge 尚未設定（BRIDGE_URL），請聯絡系統管理員');
    return;
  }

  // 解析格式：bug: [project] description
  const match = text.match(/^bug:\s*(kpi|course|survey)?\s*(.*)/is);
  const project = (match && match[1] ? match[1].toLowerCase() : null);
  const description = (match && match[2] ? match[2].trim() : text.replace(/^bug:\s*/i, '').trim());

  if (!project) {
    _lineReply(replyToken,
      '請指定專案：\nbug: kpi 描述\nbug: course 描述\nbug: survey 描述'
    );
    return;
  }
  if (!description) {
    _lineReply(replyToken, '請描述問題，例如：\nbug: kpi 評分頁面無法送出');
    return;
  }

  try {
    const resp = UrlFetchApp.fetch(`${bridgeUrl}/bug-report`, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ project, description }),
      muteHttpExceptions: true,
    });
    const result = JSON.parse(resp.getContentText());
    _lineReply(replyToken, result.ok
      ? `✅ 已收到！Claude 開始處理 ${_projectName(project)}\n修好後會通知你`
      : `⚠️ ${result.message || '轉發失敗，請稍後再試'}`
    );
  } catch (err) {
    _log('ERROR', '_handleBugReport', err.message);
    _lineReply(replyToken, `❌ 轉發失敗：${err.message}`);
  }
}

function _projectName(project) {
  return { kpi: '考核系統', course: '課程系統', survey: '泰旺問卷' }[project] || project;
}

/**
 * 啟動 24h 循環：loop:kpi 目標說明
 */
function _handleLoopCommand(text, replyToken) {
  const bridgeUrl = PropertiesService.getScriptProperties().getProperty('BRIDGE_URL');
  if (!bridgeUrl) {
    _lineReply(replyToken, '⚠️ Bridge 尚未設定（BRIDGE_URL），請聯絡系統管理員');
    return;
  }
  const match = text.match(/^loop:\s*(kpi|course|survey)\s+(.*)/is);
  if (!match) {
    _lineReply(replyToken, '格式：loop:kpi 目標說明\n例：loop:kpi 完成評分功能');
    return;
  }
  const project = match[1].toLowerCase();
  const goal = match[2].trim();
  if (!goal) {
    _lineReply(replyToken, '請說明目標，例：loop:kpi 完成評分功能');
    return;
  }
  try {
    const resp = UrlFetchApp.fetch(`${bridgeUrl}/command`, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ action: 'loop', project, goal }),
      muteHttpExceptions: true,
    });
    const result = JSON.parse(resp.getContentText());
    _lineReply(replyToken, result.ok
      ? `🚀 ${_projectName(project)} 24h 循環已啟動\n目標：${goal}\n\n進度會持續推播給你`
      : `⚠️ ${result.message || '啟動失敗，請稍後再試'}`
    );
  } catch (err) {
    _log('ERROR', '_handleLoopCommand', err.message);
    _lineReply(replyToken, `❌ 啟動失敗：${err.message}`);
  }
}

/**
 * 停止循環：stop:kpi
 */
function _handleStopCommand(text, replyToken) {
  const bridgeUrl = PropertiesService.getScriptProperties().getProperty('BRIDGE_URL');
  if (!bridgeUrl) {
    _lineReply(replyToken, '⚠️ Bridge 尚未設定');
    return;
  }
  const match = text.match(/^stop:\s*(kpi|course|survey)/i);
  if (!match) {
    _lineReply(replyToken, '格式：stop:kpi / stop:course / stop:survey');
    return;
  }
  const project = match[1].toLowerCase();
  try {
    const resp = UrlFetchApp.fetch(`${bridgeUrl}/command`, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ action: 'stop', project }),
      muteHttpExceptions: true,
    });
    const result = JSON.parse(resp.getContentText());
    _lineReply(replyToken, result.ok
      ? `⏹ ${_projectName(project)} 循環已停止`
      : `⚠️ ${result.message || '停止失敗'}`
    );
  } catch (err) {
    _lineReply(replyToken, `❌ 停止失敗：${err.message}`);
  }
}

/**
 * 查詢狀態：status
 */
function _handleStatusCommand(replyToken) {
  const bridgeUrl = PropertiesService.getScriptProperties().getProperty('BRIDGE_URL');
  if (!bridgeUrl) {
    _lineReply(replyToken, '⚠️ Bridge 尚未設定');
    return;
  }
  try {
    const resp = UrlFetchApp.fetch(`${bridgeUrl}/health`, { muteHttpExceptions: true });
    const result = JSON.parse(resp.getContentText());
    const running = result.running || {};
    if (Object.keys(running).length === 0) {
      _lineReply(replyToken, '💤 目前所有專案閒置');
    } else {
      const lines = Object.entries(running).map(([proj, info]) =>
        `▶ ${_projectName(proj)} [${info.mode === 'loop' ? '24h循環' : 'Bug修復'}]\n  自 ${info.started_at.slice(11,16)}\n  ${info.task.slice(0, 40)}`
      );
      _lineReply(replyToken, lines.join('\n\n'));
    }
  } catch (err) {
    _lineReply(replyToken, `❌ 查詢失敗：${err.message}`);
  }
}

/**
 * 執行從 ping 觸發的待確認動作
 * @returns {string} 執行結果訊息
 */
function _executePendingAction(action, uid, settings) {
  const shortUid = '…' + uid.slice(-4);
  if (action === '啟用測試') {
    updateSettings({ '使用測試Channel': 'true' });
    _log('INFO', '啟用測試', '已切換到測試環境', { uid: shortUid });
    return '✅ 已切換到測試環境';
  }
  if (action === '啟用正式') {
    updateSettings({ '使用測試Channel': 'false' });
    _log('INFO', '啟用正式', '已切換到正式環境', { uid: shortUid });
    return '✅ 已切換到正式環境';
  }
  if (action === '建立選單') {
    setupRichMenus();
    _log('INFO', '建立選單', 'Rich Menu 全部重建完成', { uid: shortUid });
    return '✅ Rich Menu 建立完成';
  }
  _log('WARN', '_executePendingAction', `未知動作：${action}`, { uid: shortUid });
  return `⚠️ 未知動作：${action}`;
}

function _lineReply(replyToken, text) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${getActiveEnv().botToken}` },
    payload: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
    muteHttpExceptions: true,
  });
}
