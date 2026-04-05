// ============================================================
// Config.gs — 系統設定讀寫
// ============================================================

/**
 * 取得所有系統設定（key-value 物件）
 * 若工作表不存在回傳空物件，不會 crash。
 * 若「當前季度」或「評分期間描述」未設定，自動從當前時間推算填入。
 */
function getSettings() {
  const rows = _sheetRows('系統設定');
  const settings = {};
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) settings[rows[i][0]] = rows[i][1];
  }

  // 自動推算：當前季度（若 Sheet 未填則用當下時間計算）
  if (!settings['當前季度']) {
    settings['當前季度'] = getCurrentQuarter();
  }
  // 自動推算：評分期間描述（若 Sheet 未填則由季度推算）
  if (!settings['評分期間描述']) {
    settings['評分期間描述'] = _quarterToDescription(settings['當前季度']);
  }

  return settings;
}

/**
 * 更新系統設定（HR 專用）
 * 若 key 已存在則更新，否則新增一列
 * @param {Object} newSettings - { 設定名稱: 設定值 }
 */
function updateSettings(newSettings) {
  const sheet = _sheet('系統設定');
  const rows = sheet.getDataRange().getValues();

  for (const [key, value] of Object.entries(newSettings)) {
    const existingRowIndex = rows.findIndex((r, i) => i > 0 && r[0] === key);
    if (existingRowIndex > 0) {
      sheet.getRange(existingRowIndex + 1, 2).setValue(value);
    } else {
      sheet.appendRow([key, value]);
    }
  }
  try { fsSyncSettings(); } catch (e) { console.warn('[saveSettings] Firestore sync failed:', e?.message); }
  return { success: true };
}

/** 檢查目前是否在評分期間內（未設定日期時預設開放） */
function isInScoringPeriod() {
  const { 評分開始日: start, 評分截止日: end } = getSettings();
  if (!start || !end) return true;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return true;
  const now = new Date();
  return now >= startDate && now <= endDate;
}

/** 計算距截止日剩餘天數 */
function getDaysUntilDeadline() {
  const { 評分截止日: end } = getSettings();
  return Math.ceil((new Date(end) - new Date()) / (1000 * 60 * 60 * 24));
}

/**
 * 將季度代碼轉為人類可讀的期間描述
 * @param {string} quarter - 如 "115Q1"
 * @returns {string} 如 "115/1~3月"
 */
function _quarterToDescription(quarter) {
  if (!quarter || quarter.length < 5) return quarter || '';
  const rocYear = quarter.substring(0, 3);
  const q = parseInt(quarter.charAt(4));
  const monthRanges = { 1: '1~3月', 2: '4~6月', 3: '7~9月', 4: '10~12月' };
  return `${rocYear}/${monthRanges[q] || ''}`;
}

/**
 * 取得目前作用中的環境設定（單一入口，所有程式碼從這裡取 token/liffId）
 * 切換環境只需改 系統設定 工作表的「使用測試Channel」即可，不需動程式碼
 * @returns {{ isTest: boolean, botToken: string, liffId: string, label: string }}
 */
function getActiveEnv() {
  // 環境設定（使用哪個 Channel）永遠存在正式 Spreadsheet，與 request 的 isTest 無關
  const wasTest = _isTestRequest();
  _setRequestIsTest(false);
  const settings = getSettings();
  _setRequestIsTest(wasTest);

  const isTest = settings['使用測試Channel'] === true || settings['使用測試Channel'] === 'true';
  return {
    isTest,
    botToken: isTest ? CONFIG.LINE_BOT_TOKEN_TEST : CONFIG.LINE_BOT_TOKEN,
    liffId:   isTest ? CONFIG.LIFF_ID_TEST        : CONFIG.LIFF_ID,
    label:    isTest ? '測試Channel' : '正式Channel',
  };
}

/** 啟用測試 Channel（執行一次即可） */
function enableTestChannel() {
  updateSettings({ '使用測試Channel': 'true' });
  Logger.log('✅ 已設定使用測試Channel = true');
}

/**
 * 驗證綁定驗證碼（無需身份驗證，用於 bind.html 驗證碼關卡）
 * 驗證碼存於 系統設定['綁定驗證碼']，由 HR/sysadmin 在後台管理
 * @param {string} code 使用者輸入的驗證碼
 */
function apiVerifyBindCode(code) {
  if (!code || !code.trim()) return { valid: false };
  let storedCode = String(getSettings()['綁定驗證碼'] || '').trim();
  // 首次使用：自動寫入預設驗證碼，管理員可在後台系統設定中修改
  if (!storedCode) {
    storedCode = 'HR0000';
    updateSettings({ '綁定驗證碼': storedCode });
  }
  return { valid: code.trim() === storedCode };
}


/**
 * 初始化系統設定工作表（首次使用時呼叫）
 * 含所有預設值，HR 可在工作表手動調整
 */
function initSettingsSheet() {
  const ss = _ss();
  let sheet = ss.getSheetByName('系統設定');
  if (!sheet) sheet = ss.insertSheet('系統設定');

  const now = new Date();
  const quarter = getCurrentQuarter();

  const defaults = [
    ['設定名稱', '設定值', '說明'],
    ['當前季度', quarter, '當前評分季度（留空則自動依當下時間推算）'],
    ['評分期間描述', _quarterToDescription(quarter), '顯示在介面上的期間文字（留空則自動依季度推算）'],
    ['評分開始日', '', '評分開放日期（YYYY/MM/DD）'],
    ['評分截止日', '', '評分截止日期（YYYY/MM/DD）'],
    ['通知時間點1', '', '主管第一次提醒日期（YYYY/MM/DD）'],
    ['通知時間點2', '', '主管第二次提醒日期（YYYY/MM/DD）'],
    ['員工通知時間點1', '', '員工自評第一次提醒日期（YYYY/MM/DD）'],
    ['員工通知時間點2', '', '員工自評第二次提醒日期（YYYY/MM/DD）'],
    ['試用期天數', '90', '未滿幾天算試用期（黃底顯示）'],
    ['最低評分天數', '3', '到職滿幾天才納入評分'],
    ['RichMenu_A', '', '公開選單 richMenuId（setupRichMenus() 後自動填入）'],
    ['RichMenu_B', '', '同仁選單 richMenuId（setupRichMenus() 後自動填入）'],
    ['RichMenu_C1', '', '主管選單第一頁 richMenuId（setupRichMenus() 後自動填入）'],
    ['RichMenu_C2', '', '主管選單第二頁 richMenuId（setupRichMenus() 後自動填入）'],
  ];

  sheet.clearContents();
  sheet.getRange(1, 1, defaults.length, 3).setValues(defaults);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#4a90d9').setFontColor('#ffffff');
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 350);
}

/**
 * 建立三張說明文件工作表，讓後續維護者不需要額外說明即可理解系統
 * - 權限設定：各角色能操作的功能
 * - 系統說明：各工作表的欄位結構
 * - 操作手冊：HR 每季操作步驟
 */
function initDocumentationSheets() {
  _initPermissionSheet();
  _initSystemDocSheet();
  _initManualSheet();
  _initTestChecklistSheet();
  Logger.log('說明文件工作表建立完成');
}

/** 建立「權限設定」工作表 */
function _initPermissionSheet() {
  const ss = _ss();
  let sheet = ss.getSheetByName('權限設定');
  if (!sheet) sheet = ss.insertSheet('權限設定');
  sheet.clearContents();

  const data = [
    ['功能', '一般同仁', '主管（經理/廠長/協理/董事長）', 'HR', '系統管理員', '說明'],
    ['查看自己填寫的評分記錄', '❌', '✅（自己填的那份）', '✅', '✅', '主管查看自己對員工的評分草稿與送出記錄'],
    ['對員工進行評分', '❌', '✅（負責科別）', '❌', '❌', '依主管權重表決定負責科別'],
    ['儲存評分草稿', '❌', '✅', '❌', '❌', '截止前可反覆修改'],
    ['查看所有主管評分進度', '❌', '❌', '✅', '✅', '管理後台 admin 頁'],
    ['手動發送提醒通知', '❌', '❌', '✅', '✅', '對未完成評分的主管推播'],
    ['修改系統設定', '❌', '❌', '✅', '✅', '評分期間、截止日、通知日期等'],
    ['同步員工名單', '❌', '❌', '✅', '✅', '從 HR Sheet 讀取最新員工資料'],
    ['匯出考核結果', '❌', '❌', '✅', '✅', '產生 Google Sheet 格式的結果表'],
    ['查看/管理 LINE 帳號綁定', '❌', '❌', '✅', '✅', '可在 LINE帳號 工作表勾選 I欄刪除帳號'],
    ['重置他人帳號綁定', '❌', '❌', '✅', '✅', 'apiResetAccount'],
    ['切換測試/正式環境', '❌', '❌', '❌', '✅', 'LINE Bot 傳「啟用測試」/「啟用正式」'],
    ['建立 Rich Menu', '❌', '❌', '❌', '✅', 'LINE Bot 傳「建立選單」'],
    ['', '', '', '', '', ''],
    ['角色判定說明', '', '', '', '', ''],
    ['角色依 HR Sheet「(人工打)總表」O欄（職稱類別）決定', '', '', '', '', ''],
    ['董事長、經理、廠長、協理 → 主管（Rich Menu C）', '', '', '', '', ''],
    ['HR → HR 角色（Rich Menu C，進入後自動轉到管理後台）', '', '', '', '', ''],
    ['其他 → 一般同仁（Rich Menu B）', '', '', '', '', ''],
    ['未綁定 / 外部人員 → 公開選單（Rich Menu A）', '', '', '', '', ''],
    ['系統管理員 → 僅可手動在 LINE帳號 H欄設定', '', '', '', '', ''],
  ];

  sheet.getRange(1, 1, data.length, 6).setValues(data);
  sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#4a90d9').setFontColor('#ffffff');
  sheet.getRange(15, 1, 1, 6).setFontWeight('bold').setBackground('#e8f4f8');
  sheet.autoResizeColumns(1, 6);
}

/** 建立「系統說明」工作表 */
function _initSystemDocSheet() {
  const ss = _ss();
  let sheet = ss.getSheetByName('系統說明');
  if (!sheet) sheet = ss.insertSheet('系統說明');
  sheet.clearContents();

  const data = [
    ['工作表', '欄位', '說明'],
    ['LINE帳號', 'A 姓名', '員工姓名（從 HR Sheet 取得）'],
    ['LINE帳號', 'B LINE_UID', 'LINE 使用者唯一識別碼（系統自動取得）'],
    ['LINE帳號', 'C LINE顯示名稱', '使用者在 LINE 的暱稱'],
    ['LINE帳號', 'D 綁定時間', '完成綁定的日期時間'],
    ['LINE帳號', 'E 狀態', '已授權 = 可使用系統'],
    ['LINE帳號', 'F 職稱', '從 HR Sheet M欄（職稱）取得'],
    ['LINE帳號', 'G 電話', '使用者綁定時填寫的手機號碼（必填）'],
    ['LINE帳號', 'H 角色', '系統管理員／HR／主管／同仁（可手動修改）'],
    ['LINE帳號', 'I 清除帳號', '勾選後執行「clearCheckedAccounts()」即可刪除'],
    ['', '', ''],
    ['主管權重', 'A 被評科別', '接受考核的科別（如：品管科、財務科）'],
    ['主管權重', 'B 職稱', '負責評分的主管職稱（用職稱而非姓名，人員異動時不需修改）'],
    ['主管權重', 'C 姓名', '目前擔任該職位者的姓名（方便人工核對，系統自動填入）'],
    ['主管權重', 'D LINE_UID', '主管綁定後系統自動填入（請勿手動修改）'],
    ['主管權重', 'E 權重', '評分佔比，同一科別的所有主管權重加總須 = 1.0'],
    ['', '', ''],
    ['員工資料', 'A 員工編號', 'HR 告知員工用於 LINE 綁定身分核對'],
    ['員工資料', 'B 姓名', ''],
    ['員工資料', 'C 部門', ''],
    ['員工資料', 'D 科別', ''],
    ['員工資料', 'E 到職日', ''],
    ['員工資料', 'F 離職日', '空白 = 在職中'],
    ['', '', ''],
    ['評分記錄', 'A 季度', '如 115Q1'],
    ['評分記錄', 'B 評分主管（姓名）', ''],
    ['評分記錄', 'C 被評人員', ''],
    ['評分記錄', 'D 被評科別', ''],
    ['評分記錄', 'E 主管權重', ''],
    ['評分記錄', 'F~K 六項評分', '職能專業度、工作效率、成本意識、部門合作、責任感、主動積極'],
    ['評分記錄', 'L 原始平均分', '六項平均'],
    ['評分記錄', 'M 特殊加減分', '主管手動調整分數'],
    ['評分記錄', 'N 調整後分數', 'L + M'],
    ['評分記錄', 'O 加權分數', 'N × E（權重）'],
    ['評分記錄', 'P 備註', ''],
    ['評分記錄', 'Q 狀態', '草稿 / 已送出'],
    ['評分記錄', 'R 最後更新', '每次存草稿或送出都更新'],
    ['', '', ''],
    ['系統設定', '當前季度', '留空則自動依當下時間推算（如 115Q1 = 民國115年第一季）'],
    ['系統設定', '評分期間描述', '留空則自動由季度推算（如 115Q1 → 115/1~3月）'],
    ['系統設定', 'RichMenu_A/B/C1/C2', '執行 setupRichMenus() 後自動填入，請勿手動修改'],
    ['系統設定', '通知時間點1/2', '主管評分提醒日期（YYYY/MM/DD）'],
    ['系統設定', '員工通知時間點1/2', '員工自評提醒日期（YYYY/MM/DD）'],
    ['', '', ''],
    ['自評記錄', 'A 季度', '如 115Q1'],
    ['自評記錄', 'B 員工姓名', ''],
    ['自評記錄', 'C 員工編號', ''],
    ['自評記錄', 'D~I 六項自評', '職能專業度、工作效率、成本意識、部門合作、責任感、主動積極（甲乙丙丁）'],
    ['自評記錄', 'J 自評分數', '六項平均分'],
    ['自評記錄', 'K 備註', ''],
    ['自評記錄', 'L 狀態', '草稿 / 已送出'],
    ['自評記錄', 'M 最後更新', ''],
  ];

  sheet.getRange(1, 1, data.length, 3).setValues(data);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#4a90d9').setFontColor('#ffffff');
  // 各工作表段落標題加底色
  [2, 11, 17, 23, 36].forEach(r => {
    if (data[r - 1] && data[r - 1][0]) {
      sheet.getRange(r, 1, 1, 3).setBackground('#e8f4f8').setFontWeight('bold');
    }
  });
  sheet.autoResizeColumns(1, 3);
}

/** 建立「操作手冊」工作表 */
function _initManualSheet() {
  const ss = _ss();
  let sheet = ss.getSheetByName('操作手冊');
  if (!sheet) sheet = ss.insertSheet('操作手冊');
  sheet.clearContents();

  // 4欄：步驟/函式, 操作/說明, 說明/所在檔案, (空)
  const data = [
    ['每季 HR 操作步驟', '', '', ''],
    ['步驟', '操作', '說明', ''],
    ['1', '更新員工資料', '在 admin 後台「系統設定」頁按「從 HR Sheet 同步員工名單」', ''],
    ['2', '設定評分期間', '在「系統設定」填入評分開始日、截止日、兩個通知時間點', ''],
    ['3', '確認主管權重表', '開啟「主管權重」工作表，確認各科別的主管職稱與權重正確', ''],
    ['4', '通知主管綁定帳號', '主管打開 LINE Bot，輸入姓名 + 員工編號完成帳號綁定', ''],
    ['5', '評分期間開始', '主管打開考核系統 LIFF 進行評分', ''],
    ['6', '發送提醒通知', '在 admin 後台「評分進度」頁按「發送提醒通知」', ''],
    ['7', '評分截止後匯出', '在 admin 後台「匯出」頁選擇季度後按「匯出」', ''],
    ['', '', '', ''],
    ['首次部署步驟', '', '', ''],
    ['步驟', '操作', '說明', ''],
    ['D1', '建立所有工作表', '在 GAS 執行「initAllSheets()」', ''],
    ['D2', '建立說明文件 & 測試清單', 'Bot 傳「更新文件」（或 GAS 執行 initDocumentationSheets()）', ''],
    ['D3', '設定 LINE Rich Menu', 'Bot 傳「建立選單」→「ping」確認（或 GAS 執行 setupRichMenus()）', ''],
    ['D4', '設定定時提醒觸發器', '在 GAS 執行「setupTriggers()」（只需執行一次）', ''],
    ['', '', '', ''],
    ['常用 GAS 函式', '', '', ''],
    ['函式', '說明', '所在檔案', ''],
    // Code.gs
    ['initAllSheets()',              '一鍵建立所有工作表（首次部署）',                    'Code.gs',      ''],
    // Config.gs
    ['initDocumentationSheets()',    '建立/更新說明文件工作表（含測試清單）',              'Config.gs',    ''],
    ['getSettings()',                '讀取系統設定工作表，回傳 key-value 物件',            'Config.gs',    ''],
    ['updateSettings(newSettings)',  '更新系統設定（HR/SysAdmin 用）',                    'Config.gs',    ''],
    ['getActiveEnv()',               '取得目前作用環境的 botToken / liffId',              'Config.gs',    ''],
    // Auth.gs
    ['getManagerInfo(lineUid)',      '查詢使用者完整資訊（角色/職責/isHR/isSysAdmin）',   'Auth.gs',      ''],
    ['apiBindByIdentity(...)',       '用姓名+員工編號+電話完成 LINE 帳號綁定',             'Auth.gs',      ''],
    ['apiResetAccount(hr, target)',  'HR/SysAdmin 強制解除他人帳號綁定',                  'Auth.gs',      ''],
    ['clearCheckedAccounts()',       '刪除 LINE帳號 I欄勾選的帳號',                       'Auth.gs',      ''],
    ['clearAllAccounts()',           '清除全部 LINE帳號記錄（測試用）',                   'Auth.gs',      ''],
    ['resetAccountForTesting(uid)', '重置指定 UID 的帳號綁定（測試用）',                  'Auth.gs',      ''],
    ['setupRoleDropdown()',          '設定 LINE帳號 H欄角色下拉選單',                     'Auth.gs',      ''],
    ['setupAccountCheckboxes()',     '補齊 LINE帳號 I欄勾選框（修復用）',                 'Auth.gs',      ''],
    ['fixPhoneFormat()',             '修復 G欄電話格式為文字（防止 0 被吃掉）',            'Auth.gs',      ''],
    // Employees.gs
    ['syncEmployees()',              '從 HR Sheet 同步員工名單到「員工資料」',             'Employees.gs', ''],
    // RichMenu.gs
    ['setupRichMenus()',             '建立 LINE Rich Menu（換圖時重新執行）',              'RichMenu.gs',  ''],
    ['switchRichMenuByRole(uid)',    '依角色切換使用者的圖文選單',                         'RichMenu.gs',  ''],
    ['clearDefaultRichMenu()',       '清除正式帳號全域預設選單（緊急修復用）',             'RichMenu.gs',  '⚠️ 用正式 token'],
    // Notifications.gs
    ['setupTriggers()',              '設定每日 9AM 提醒排程觸發器（部署後執行一次）',     'Notifications.gs', ''],
    ['sendReminderToAll(quarter)',   '對所有有待評員工的主管發送 LINE 提醒',               'Notifications.gs', ''],
    // Export.gs
    ['exportScores(quarter)',        '匯出指定季度評分結果到新工作表',                    'Export.gs',    ''],
  ];

  const COL = 4;
  sheet.getRange(1, 1, data.length, COL).setValues(data);

  // 段落標題
  const greenRows = [1, 11, 18];
  const blueRows  = [2, 12, 19];
  greenRows.forEach(r => sheet.getRange(r, 1, 1, COL).setFontWeight('bold').setBackground('#34a853').setFontColor('#ffffff'));
  blueRows.forEach(r  => sheet.getRange(r, 1, 1, COL).setFontWeight('bold').setBackground('#4a90d9').setFontColor('#ffffff'));

  // 常用函式區：所在檔案欄標色
  const fileColors = { 'Code.gs':'#e8f5e9', 'Config.gs':'#e3f2fd', 'Auth.gs':'#fce4ec',
    'Employees.gs':'#fff8e1', 'RichMenu.gs':'#f3e5f5', 'Notifications.gs':'#e0f7fa', 'Export.gs':'#fff3e0' };
  for (let i = 19; i < data.length; i++) {
    const file = data[i][2];
    if (fileColors[file]) sheet.getRange(i + 1, 3).setBackground(fileColors[file]);
  }

  sheet.autoResizeColumns(1, COL);
  sheet.setColumnWidth(3, 140);
}

/** 建立「測試清單」工作表 — 系統管理員依序測試用 */
function _initTestChecklistSheet() {
  const ss = _ss();
  let sheet = ss.getSheetByName('測試清單');
  if (!sheet) sheet = ss.insertSheet('測試清單');
  sheet.clearContents();

  // 欄位：序號, 類別, 測試項目, 所需角色, 測試方法, 預期結果, 結果, 備註
  const H = ['#', '類別', '測試項目', '所需角色', '測試方法', '預期結果', '✅/❌', '備註'];

  // 依實際測試順序排列
  const rows = [
    // ── 首次部署 ────────────────────────────────────────────
    ['D-1', '首次部署', '建立所有工作表',           '系統管理員', 'GAS 編輯器執行 initAllSheets()',                          '所有工作表建立完成，無錯誤', '', ''],
    ['D-2', '首次部署', '建立說明文件',             '系統管理員', 'Bot 傳「更新文件」',                                        '回覆「✅ 完成」', '', ''],
    ['D-3', '首次部署', '建立 Rich Menu',           '系統管理員', 'Bot 傳「建立選單」→ 傳「ping」確認',                        'Bot 回「✅ Rich Menu 建立完成」，ping 顯示環境', '', ''],
    ['D-4', '首次部署', '設定定時提醒觸發器',       '系統管理員', 'GAS 編輯器執行 setupTriggers()',                           'GAS 觸發器清單出現每日 9AM scheduledReminder', '', ''],

    // ── 環境切換 ────────────────────────────────────────────
    ['E-1', '環境切換', 'ping 確認目前環境',        '任何人',     'Bot 傳「ping」',                                           '回覆環境（測試/正式）、季度、評分期間', '', ''],
    ['E-2', '環境切換', '切換到測試環境',           '系統管理員', 'Bot 傳「啟用測試」→ 傳「ping」確認',                        'ping 回「✅ 已切換到測試環境」後顯示「✅ 測試Channel」', '', ''],
    ['E-3', '環境切換', '切換到正式環境',           '系統管理員', 'Bot 傳「啟用正式」→ 傳「ping」確認',                        'ping 回「✅ 已切換到正式環境」後顯示「⚠️ 正式Channel」', '', '⚠️ 正式操作請謹慎'],
    ['E-4', '環境切換', 'ping 過期無動作',          '系統管理員', '傳「啟用正式」，等 5 分鐘後再傳「ping」',                   'ping 只顯示狀態，不執行切換', '', ''],

    // ── 帳號綁定 ────────────────────────────────────────────
    ['A-1', '帳號綁定', '取得綁定連結',             '未綁定',     'Bot 傳「設定」',                                           '回覆 LIFF 連結', '', ''],
    ['A-2', '帳號綁定', '綁定成功（一般同仁）',     '未綁定',     '開啟 bind.html，填姓名+員工編號+電話，送出',               '顯示「綁定成功！」，自動跳轉 dashboard', '', ''],
    ['A-3', '帳號綁定', '綁定成功（主管）',         '未綁定',     '使用主管資料綁定',                                          '成功，圖文選單自動切換為主管選單 C1（首頁 Tab）', '', ''],
    ['A-4', '帳號綁定', '綁定成功（HR）',           '未綁定',     '使用 HR 資料綁定',                                          '成功，圖文選單切換為 C1，進 dashboard 自動跳 admin', '', ''],
    ['A-5', '帳號綁定', '電話欄保留首位 0',         '未綁定',     '綁定時填 09xxxxxxxx，完成後查 Sheet G欄',                  'G欄顯示完整電話（含開頭 0），非數字格式', '', ''],
    ['A-6', '帳號綁定', '員工不存在',               '未綁定',     '填錯誤姓名或員工編號，點確認綁定',                          '顯示「查無此員工，請確認姓名與員工編號」', '', ''],
    ['A-7', '帳號綁定', '重複綁定（快取路徑）',     '已綁定',     '已綁定帳號再次開啟 bind.html',                              '直接跳轉 dashboard，不顯示表單', '', ''],
    ['A-8', '帳號綁定', '自行取消綁定',             '已綁定',     'Bot 傳「取消綁定」',                                        'Bot 回「✅ 已解除帳號綁定」，圖文選單恢復 A（公開）', '', ''],

    // ── 圖文選單 ────────────────────────────────────────────
    ['M-1', '圖文選單', 'A 選單（未綁定）',         '未綁定',     '查看未綁定帳號的圖文選單',                                   '顯示 2 格：官網 / 綁定帳號', '', ''],
    ['M-2', '圖文選單', 'B 選單（同仁）',           '一般同仁',   '綁定後查看圖文選單',                                        '顯示 6 格功能（請款、查詢、表單、活動、讚賞幣、出勤）', '', ''],
    ['M-3', '圖文選單', 'C1 選單（主管首頁）',      '主管/HR/管', '綁定主管帳號後查看圖文選單',                               '顯示「首頁」Tab 亮起，下方 6 格功能', '', ''],
    ['M-4', '圖文選單', 'C1↔C2 Tab 切換',          '主管/HR/管', '點圖文選單右上角「考核」Tab',                              '切換到 C2，顯示考核評分系統大按鈕；點「首頁」切回 C1', '', ''],
    ['M-5', '圖文選單', '手動切換選單（主管）',     '任何人',     'Bot 傳「主管」',                                            '切換到 C1，Bot 回確認', '', '測試用'],
    ['M-6', '圖文選單', '更新選單（依角色）',       '已綁定',     'Bot 傳「更新選單」',                                        'Bot 回「✅ 選單已依目前角色更新」', '', ''],

    // ── 主管評分 ────────────────────────────────────────────
    ['S-1', '評分流程', '主管儀表板載入',           '主管',       '開啟 dashboard.html（透過考核 Tab 進入）',                  '顯示負責員工清單、進度條、截止倒數', '', ''],
    ['S-2', '評分流程', '員工篩選器',               '主管',       '點篩選按鈕：全部/未評分/草稿/已送出/試用期',               '清單依狀態正確篩選', '', ''],
    ['S-3', '評分流程', '試用期顯示',               '主管',       '確認未滿 90 天的員工在名單中顯示',                          '有黃色「試用期」badge，進評分頁有警告文字', '', ''],
    ['S-4', '評分流程', '儲存草稿',                 '主管',       '填部分評分項目，點「儲存草稿」',                            '成功 toast，Sheet 評分記錄出現狀態「草稿」', '', ''],
    ['S-5', '評分流程', '送出評分',                 '主管',       '填完 6 項評分，點「確認送出」→ 確認對話框',                 '成功 toast 顯示加權分數，Sheet 狀態改「已送出」', '', ''],
    ['S-6', '評分流程', '截止後禁止送出',           '主管',       '設定截止日 = 過去日期，再嘗試送出',                         '回傳 error「不在評分期間內」', '', '草稿仍可儲存'],
    ['S-7', '評分流程', '未填完禁止送出',           '主管',       '只填 3 項，點「確認送出」',                                  '顯示「請填寫所有評分項目」，不送出', '', ''],
    ['S-8', '評分流程', '重新載入顯示草稿',         '主管',       '儲存草稿後，重新開啟該員工評分頁',                           '6 項數值、備註均恢復，狀態顯示「草稿」', '', ''],
    ['S-9', '評分流程', '加權分數計算',             '主管',       '送出後查看 評分記錄 Sheet E、L、N、O 欄',                   'E=主管權重, L=原始平均, N=調整後, O=加權（N×E）', '', ''],

    // ── HR/管理員後台 ───────────────────────────────────────
    ['R-1', '管理後台', 'HR 進入 admin.html',       'HR',         '以 HR 帳號開啟 dashboard，等跳轉到 admin',                  '自動跳轉 admin 頁，顯示評分進度總覽', '', ''],
    ['R-2', '管理後台', '查看所有主管進度',         'HR/管',      'admin → 評分進度 Tab',                                      '列出各主管姓名、已評/待評人數、百分比', '', ''],
    ['R-3', '管理後台', '查看主管員工清單',         'HR/管',      '點進度列表的主管姓名',                                       '展開顯示該主管所有員工的評分狀態', '', ''],
    ['R-4', '管理後台', '同步員工名單',             'HR/管',      'admin → 系統設定 → 從 HR Sheet 同步員工名單',               '回傳同步 X 位員工，員工資料 Sheet 更新', '', ''],
    ['R-5', '管理後台', '修改系統設定',             'HR/管',      '更新評分開始日/截止日，點儲存',                              '系統設定 Sheet 更新，顯示「✅ 設定已儲存」', '', ''],
    ['R-6', '管理後台', '手動發送提醒通知',         'HR/管',      'admin → 評分進度 → 發送提醒通知 → 確認',                   '推播給所有待評主管，回傳通知人數', '', '需有 pending 主管'],
    ['R-7', '管理後台', '匯出考核結果',             'HR/管',      'admin → 匯出 → 選季度 → 匯出',                              '建立「匯出_xxxxQx」Sheet，含原始分及加權分', '', ''],
    ['R-8', '管理後台', '查看帳號清單',             'HR/管',      'admin → 帳號管理 → 重新整理',                               '顯示所有已授權帳號（姓名/職稱/角色/電話）', '', ''],
    ['R-9', '管理後台', 'HR 重置他人帳號',          'HR/管',      '帳號管理 → 點某帳號「取消綁定」',                            '該帳號從 Sheet 移除，圖文選單恢復 A', '', ''],
    ['R-10','管理後台', '查看系統日誌',             'HR/管',      'admin → 日誌 Tab',                                          '顯示最近 100 筆日誌，可按 ERROR/WARN/INFO 篩選', '', ''],

    // ── 通知 ────────────────────────────────────────────────
    ['N-1', '通知',     '主管收到提醒推播',         '主管',       '手動觸發 sendReminderToAll() 或從 admin 發送',              '未完成評分的主管收到 LINE Bot 推播', '', ''],

    // ── 系統管理員專屬 ──────────────────────────────────────
    ['G-1', '系統管理', '初始化',                   '系統管理員', 'Bot 傳「初始化」',                                           'H欄下拉、I欄 checkbox 建立，回覆「✅ 初始化完成」', '', '第一次設定後用'],
    ['G-2', '系統管理', '更新說明文件',             '系統管理員', 'Bot 傳「更新文件」',                                         'Sheet 新增/更新：權限設定/系統說明/操作手冊/測試清單', '', ''],
    ['G-3', '系統管理', '修復電話格式',             '系統管理員', 'Bot 傳「更新文件」，查看 G欄',                               '所有電話顯示完整含 0 的文字格式', '', ''],
    ['G-4', '系統管理', '無權限指令被阻擋',         '一般帳號',   '用非系統管理員帳號傳「建立選單」',                            'Bot 回「❌ 無權限」', '', ''],
  ];

  const data = [H, ...rows];
  sheet.getRange(1, 1, data.length, H.length).setValues(data);

  // 標題列格式
  sheet.getRange(1, 1, 1, H.length)
    .setFontWeight('bold').setBackground('#37474f').setFontColor('#ffffff');

  // 類別群組底色
  const categoryColors = {
    '首次部署': '#fce4ec', '環境切換': '#e8eaf6', '帳號綁定': '#e8f5e9',
    '圖文選單': '#fff8e1', '評分流程': '#e3f2fd', '管理後台': '#f3e5f5',
    '通知': '#e0f7fa', '系統管理': '#fff3e0',
  };
  for (let i = 1; i < data.length; i++) {
    const cat = data[i][1];
    const color = categoryColors[cat];
    if (color) sheet.getRange(i + 1, 1, 1, H.length).setBackground(color);
  }

  // ✅/❌ 欄設下拉
  const resultValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(['✅', '❌', '⚠️'], true).setAllowInvalid(true).build();
  sheet.getRange(2, 7, rows.length, 1).setDataValidation(resultValidation);

  // 欄寬
  sheet.setColumnWidth(1, 60);
  sheet.setColumnWidth(2, 80);
  sheet.setColumnWidth(3, 180);
  sheet.setColumnWidth(4, 90);
  sheet.setColumnWidth(5, 280);
  sheet.setColumnWidth(6, 280);
  sheet.setColumnWidth(7, 60);
  sheet.setColumnWidth(8, 120);
  sheet.setFrozenRows(1);
}

/**
 * 初始化員工自評記錄工作表
 * 欄位：季度、員工姓名、員工編號、item1~6、自評分數、備註、狀態、最後更新
 */
function initSelfAssessSheet() {
  const ss = _ss();
  let sheet = ss.getSheetByName('自評記錄');
  if (!sheet) sheet = ss.insertSheet('自評記錄');

  sheet.clearContents();
  const headers = [[
    '季度', '員工姓名', '員工編號',
    '職能專業度', '工作效率', '成本意識', '部門合作', '責任感', '主動積極',
    '自評分數', '備註', '狀態', '最後更新',
  ]];
  sheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
  sheet.getRange(1, 1, 1, headers[0].length)
    .setFontWeight('bold').setBackground('#4a90d9').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
}
