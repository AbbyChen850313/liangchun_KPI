// ============================================================
// Auth.gs — LINE 身份綁定與帳號管理
// ============================================================

// 職稱類別為主管的值（與 HR Sheet O欄一致）
const MANAGER_TITLE_CATEGORIES = ['董事長', '經理', '廠長', '協理'];

// HR Sheet「(人工打)總表」欄位索引（0-based）
const COL_HR = {
  EMPLOYEE_ID:     2,  // C 員工編號
  NAME:            4,  // E 姓名
  JOB_TITLE:      12,  // M 職稱
  TITLE_CATEGORY: 14,  // O 職稱類別
};

// LINE帳號 工作表欄位索引（0-based）
const COL_ACCOUNT = {
  NAME:         0,  // A 姓名
  UID:          1,  // B LINE_UID（正式環境）
  DISPLAY_NAME: 2,  // C LINE顯示名稱
  BOUND_AT:     3,  // D 綁定時間
  STATUS:       4,  // E 狀態
  JOB_TITLE:    5,  // F 職稱（從 HR Sheet 帶入）
  PHONE:        6,  // G 電話
  ROLE:         7,  // H 角色（系統管理員/HR/主管/同仁）
  CLEAR:        8,  // I 清除帳號（checkbox，放最後避免誤觸）
  TEST_UID:     9,  // J 測試環境 LINE_UID（不同 Login Channel）
  EMPLOYEE_ID: 10,  // K 員工編號（防止同名員工比對錯誤）
};

// ============================================================
// 身份查詢（所有驗證的核心）
// ============================================================

/**
 * 取得使用者資訊（含負責科別與權重）
 * @param {string} lineUid
 * @returns {Object|null}
 */
function getManagerInfo(lineUid) {
  if (!lineUid) return null;
  const account = _findAccountByUid(lineUid);
  if (!account) return null;
  const isSysAdmin = account.role === '系統管理員';
  const isHR       = account.role === 'HR';
  const responsibilities = (isSysAdmin || isHR) ? [] : _findResponsibilities(lineUid, account.jobTitle);
  return {
    lineUid,
    managerName: account.name,
    jobTitle:    account.jobTitle,
    role:        account.role,
    responsibilities,
    isHR,
    isSysAdmin,
  };
}

/** 從 LINE帳號 表查詢已授權帳號（同時比對正式 UID 與測試 UID） */
function _findAccountByUid(lineUid) {
  const rows = _sheetRows('LINE帳號');
  for (let i = 1; i < rows.length; i++) {
    const primaryUid = String(rows[i][COL_ACCOUNT.UID]      || '').trim();
    const testUid    = String(rows[i][COL_ACCOUNT.TEST_UID] || '').trim();
    const matched    = (primaryUid === lineUid || testUid === lineUid);
    if (matched && rows[i][COL_ACCOUNT.STATUS] === '已授權') {
      const jobTitle = String(rows[i][COL_ACCOUNT.JOB_TITLE] || '').trim();
      const roleFromColumn = String(rows[i][COL_ACCOUNT.ROLE] || '').trim();
      const role = roleFromColumn || (['HR', '系統管理員'].includes(jobTitle) ? jobTitle : '');
      return {
        name: String(rows[i][COL_ACCOUNT.NAME]).trim(),
        jobTitle,
        role,
      };
    }
  }
  return null;
}

/**
 * 從 主管權重 表查詢此職稱負責的科別與權重
 * 欄位索引（0-based）：A=0被評科別, B=1職稱, C=2姓名, D=3LINE_UID, E=4權重
 */
function _findResponsibilities(lineUid, jobTitle) {
  const rows = _sheetRows('主管權重');
  const result = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][3] === lineUid || rows[i][1] === jobTitle) {
      result.push({ dept: rows[i][0], weight: rows[i][4] });
    }
  }
  return result;
}

/**
 * 依職稱類別（HR Sheet O欄）判定系統角色
 * @param {string} titleCategory
 * @returns {'HR'|'主管'|'同仁'}
 */
function _deriveRole(titleCategory, employeeId) {
  // 系統設定「系統管理員員工編號」優先判定（逗號分隔多筆）
  if (employeeId) {
    const sysAdminIds = String(getSettings()['系統管理員員工編號'] || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    if (sysAdminIds.includes(employeeId)) return '系統管理員';
  }
  if (titleCategory === 'HR') return 'HR';
  if (MANAGER_TITLE_CATEGORIES.includes(titleCategory)) return '主管';
  return '同仁';
}

/**
 * 將姓名與 LINE_UID 填入主管權重表對應職稱的列
 * 欄位：C欄(姓名) = 3rd column, D欄(LINE_UID) = 4th column
 */
function _updateWeightUid(jobTitle, lineUid, name) {
  const weightSheet = _sheet('主管權重');
  const rows = _sheetRows('主管權重');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === jobTitle) {
      weightSheet.getRange(i + 1, 3).setValue(name || '');   // C欄：姓名
      weightSheet.getRange(i + 1, 4).setValue(lineUid);       // D欄：LINE_UID
    }
  }
}

// ============================================================
// 綁定流程
// ============================================================

/**
 * 用姓名 + 員工編號驗證身分後完成 LINE 帳號綁定
 * @param {string} lineUid
 * @param {string} displayName - LINE 顯示名稱
 * @param {string} name - 使用者輸入的姓名
 * @param {string} employeeId - 使用者輸入的員工編號
 * @param {string} phone - 使用者輸入的手機號碼（必填）
 */
function apiBindByIdentity(lineUid, displayName, name, employeeId, phone, isTest) {
  try {
    const employee = _findEmployeeByIdentity(name, employeeId);
    if (!employee) return { error: '查無此員工，請確認姓名與員工編號' };

    const role = _deriveRole(employee.titleCategory, employee.employeeId);

    if (isTest) {
      // 測試模式：只把 TEST_UID 寫入正式帳號的 J 欄，不新增行
      _setRequestIsTest(false);
      const linked = _linkTestUid(employee.name, employeeId, lineUid, role);
      if (!linked) return { error: '查無正式帳號記錄，請先完成正式 LINE 綁定後再測試' };
    } else {
      _upsertAccount(lineUid, displayName, employee.name, employee.jobTitle, phone, role, employee.employeeId);
      _updateWeightUid(employee.jobTitle, lineUid, employee.name);
    }

    _log('INFO', 'apiBindByIdentity',
      `${isTest ? '[TEST] ' : ''}綁定成功：${employee.name}`,
      { jobTitle: employee.jobTitle });
    if (!isTest) _emit('account.bound', { lineUid, name: employee.name, jobTitle: employee.jobTitle, role });
    return {
      success: true,
      name:      employee.name,
      jobTitle:  employee.jobTitle,
      role,
      isManager: MANAGER_TITLE_CATEGORIES.includes(employee.titleCategory),
    };
  } catch (e) {
    _log('ERROR', 'apiBindByIdentity', e.message, { stack: e.stack });
    return { error: '系統錯誤：' + e.message };
  }
}

/** 找到同姓名+員工編號的正式帳號，把測試 UID 寫入 J 欄，同時更新角色與員工編號 */
function _linkTestUid(name, employeeId, testUid, newRole) {
  const accountSheet = _sheet('LINE帳號');
  const rows = _sheetRows('LINE帳號');
  for (let i = 1; i < rows.length; i++) {
    const rowName       = String(rows[i][COL_ACCOUNT.NAME]        || '').trim();
    const rowEmployeeId = String(rows[i][COL_ACCOUNT.EMPLOYEE_ID] || '').trim();
    // 姓名必須匹配；有員工編號時雙重比對防同名
    const nameMatch = rowName === name;
    const idMatch   = !employeeId || !rowEmployeeId || rowEmployeeId === employeeId;
    if (nameMatch && idMatch) {
      accountSheet.getRange(i + 1, COL_ACCOUNT.TEST_UID    + 1).setValue(testUid);
      if (newRole)     accountSheet.getRange(i + 1, COL_ACCOUNT.ROLE        + 1).setValue(newRole);
      if (employeeId)  accountSheet.getRange(i + 1, COL_ACCOUNT.EMPLOYEE_ID + 1).setValue(employeeId);
      return { role: newRole || String(rows[i][COL_ACCOUNT.ROLE] || '').trim() };
    }
  }
  return null;
}

/**
 * 確認 LINE UID 是否已完成綁定
 * @param {string} lineUid
 */
function apiCheckBinding(lineUid) {
  const account = _findAccountByUid(lineUid);
  if (!account) return { bound: false };
  return { bound: true, name: account.name, jobTitle: account.jobTitle, role: account.role };
}

// ============================================================
// 角色管理
// ============================================================

/**
 * 依 HR Sheet 中的員工資料，重新計算所有已授權帳號的角色
 * 並更新 LINE帳號 H 欄，然後同步 Firestore
 * @param {string} lineUid  系統管理員的 UID（權限驗證用）
 */
function apiRefreshAllRoles(lineUid) {
  const auth = _verifySysAdmin(lineUid);
  if (auth.error) return auth;
  const updated = _refreshAllRoles();
  try { fsSyncAccounts(); } catch (e) { _log('WARN', 'apiRefreshAllRoles', 'Firestore sync 失敗', e.message); }
  return { success: true, updatedCount: updated };
}

/** 重新計算所有已授權帳號角色，回傳更新筆數（HR Sheet 只讀一次） */
function _refreshAllRoles() {
  const hrIndex     = _buildHrEmployeeIndex();
  const accountSheet = _sheet('LINE帳號');
  const rows         = _sheetRows('LINE帳號');
  let updated = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][COL_ACCOUNT.STATUS] !== '已授權') continue;
    const name       = String(rows[i][COL_ACCOUNT.NAME]        || '').trim();
    const employeeId = String(rows[i][COL_ACCOUNT.EMPLOYEE_ID] || '').trim();
    if (!name) continue;
    // 優先以員工編號查（精確）；找不到再以姓名查（向下相容舊資料）
    const employee = hrIndex[employeeId] || hrIndex[name];
    if (!employee) continue;
    const newRole     = _deriveRole(employee.titleCategory, employee.employeeId);
    const currentRole = String(rows[i][COL_ACCOUNT.ROLE] || '').trim();
    if (newRole !== currentRole) {
      accountSheet.getRange(i + 1, COL_ACCOUNT.ROLE + 1).setValue(newRole);
      updated++;
    }
  }
  return updated;
}

/** 一次讀取 HR Sheet，建立員工編號和姓名雙鍵索引 */
function _buildHrEmployeeIndex() {
  try {
    const hrSpreadsheet = SpreadsheetApp.openById(CONFIG.HR_SPREADSHEET_ID);
    const hrSheet = hrSpreadsheet.getSheetByName('(人工打)總表');
    if (!hrSheet) {
      _log('WARN', '_buildHrEmployeeIndex', 'HR Sheet 找不到工作表「(人工打)總表」');
      return {};
    }
    const data  = hrSheet.getDataRange().getValues();
    const index = {};
    for (let i = 1; i < data.length; i++) {
      const employeeId    = String(data[i][COL_HR.EMPLOYEE_ID]    || '').trim();
      const name          = String(data[i][COL_HR.NAME]           || '').trim();
      const jobTitle      = String(data[i][COL_HR.JOB_TITLE]      || '').trim();
      const titleCategory = String(data[i][COL_HR.TITLE_CATEGORY] || '').trim();
      if (!employeeId && !name) continue;
      const entry = { name, employeeId, jobTitle, titleCategory };
      if (employeeId)           index[employeeId] = entry;
      if (name && !index[name]) index[name]       = entry; // 姓名作為回退鍵
    }
    return index;
  } catch (e) {
    _log('ERROR', '_buildHrEmployeeIndex', 'HR Sheet 讀取失敗', e.message);
    return {};
  }
}

/**
 * 在 HR Sheet 以姓名 + 員工編號查詢員工（唯讀）
 * @returns {{ name, employeeId, jobTitle, titleCategory }} 或 null
 */
function _findEmployeeByIdentity(name, employeeId) {
  const hrSheet = SpreadsheetApp.openById(CONFIG.HR_SPREADSHEET_ID)
    .getSheetByName('(人工打)總表');
  const data = hrSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowEmployeeId = String(row[COL_HR.EMPLOYEE_ID]).trim();
    const rowName       = String(row[COL_HR.NAME]).trim();

    if (rowEmployeeId === employeeId.trim() && rowName === name.trim()) {
      return {
        name:          rowName,
        employeeId:    rowEmployeeId,
        jobTitle:      String(row[COL_HR.JOB_TITLE]).trim(),
        titleCategory: String(row[COL_HR.TITLE_CATEGORY]).trim(),
      };
    }
  }
  return null;
}

// ============================================================
// LINE帳號 工作表操作
// 欄位順序（9欄）：姓名, LINE_UID, LINE顯示名稱, 綁定時間, 狀態, 職稱, 電話, 角色, 清除帳號
// ============================================================

/**
 * 新增或更新 LINE帳號 紀錄
 * @param {string} role - 'HR'|'主管'|'同仁'|'系統管理員'（由 _deriveRole 判定）
 */
function _upsertAccount(lineUid, displayName, name, jobTitle, phone, role, employeeId) {
  const accountSheet = _sheet('LINE帳號');
  const rows = _sheetRows('LINE帳號');

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][COL_ACCOUNT.UID] === lineUid) {
      accountSheet.getRange(i + 1, COL_ACCOUNT.NAME      + 1).setValue(name);
      accountSheet.getRange(i + 1, COL_ACCOUNT.STATUS    + 1).setValue('已授權');
      accountSheet.getRange(i + 1, COL_ACCOUNT.JOB_TITLE + 1).setValue(jobTitle);
      accountSheet.getRange(i + 1, COL_ACCOUNT.PHONE     + 1).setValue(phone || '');
      if (role)       accountSheet.getRange(i + 1, COL_ACCOUNT.ROLE        + 1).setValue(role);
      if (employeeId) accountSheet.getRange(i + 1, COL_ACCOUNT.EMPLOYEE_ID + 1).setValue(employeeId);
      return;
    }
  }

  const newRow = accountSheet.getLastRow() + 1;
  // G欄（電話）設為文字格式，防止開頭 0 被吃掉
  accountSheet.getRange(newRow, COL_ACCOUNT.PHONE + 1).setNumberFormat('@');
  // 欄位順序：姓名, UID, 顯示名稱, 綁定時間, 狀態, 職稱, 電話, 角色, 清除帳號, 測試UID, 員工編號
  accountSheet.appendRow([name, lineUid, displayName, new Date(), '已授權', jobTitle, phone || '', role || '', false, '', employeeId || '']);

  // checkbox
  const checkboxCell = accountSheet.getRange(newRow, COL_ACCOUNT.CLEAR + 1);
  checkboxCell.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());

  // 角色下拉
  const roleValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(['系統管理員', 'HR', '主管', '同仁'], true)
    .setAllowInvalid(false)
    .build();
  accountSheet.getRange(newRow, COL_ACCOUNT.ROLE + 1).setDataValidation(roleValidation);
}

/**
 * 取得所有已綁定帳號清單（HR / SysAdmin 用）
 * 同時回傳正式 UID 與測試 UID 帳號，供模擬視角使用
 */
function apiGetAllAccounts(callerUid) {
  const info = getManagerInfo(callerUid);
  if (!info || (!info.isHR && !info.isSysAdmin)) return { error: '無權限' };

  const rows = _sheetRows('LINE帳號');
  const accounts = [];
  for (let i = 1; i < rows.length; i++) {
    const uid     = String(rows[i][COL_ACCOUNT.UID]      || '').trim();
    const testUid = String(rows[i][COL_ACCOUNT.TEST_UID] || '').trim();
    if (!uid && !testUid) continue;  // 正式 UID 與測試 UID 都空才跳過
    accounts.push({
      name:        String(rows[i][COL_ACCOUNT.NAME]        || '').trim(),
      lineUid:     uid,
      testUid:     testUid,
      displayName: String(rows[i][COL_ACCOUNT.DISPLAY_NAME]|| '').trim(),
      boundAt:     rows[i][COL_ACCOUNT.BOUND_AT] ? new Date(rows[i][COL_ACCOUNT.BOUND_AT]).toLocaleDateString('zh-TW') : '-',
      status:      String(rows[i][COL_ACCOUNT.STATUS]      || '').trim(),
      jobTitle:    String(rows[i][COL_ACCOUNT.JOB_TITLE]   || '').trim(),
      role:        String(rows[i][COL_ACCOUNT.ROLE]        || '').trim(),
      phone:       String(rows[i][COL_ACCOUNT.PHONE]       || '').trim(),
    });
  }
  return accounts;
}

/**
 * 更新指定帳號的角色（HR / SysAdmin 專用）
 * @param {string} hrUid      - 操作者 UID
 * @param {string} targetUid  - 目標帳號 UID（正式或測試）
 * @param {string} newRole    - 新角色值
 */
function apiUpdateRole(hrUid, targetUid, newRole) {
  const info = getManagerInfo(hrUid);
  if (!info || (!info.isHR && !info.isSysAdmin)) return { error: '無權限' };

  const VALID_ROLES = ['系統管理員', 'HR', '主管', '同仁'];
  if (!VALID_ROLES.includes(newRole)) return { error: '無效角色：' + newRole };

  const accountSheet = _sheet('LINE帳號');
  const rows = _sheetRows('LINE帳號');
  for (let i = 1; i < rows.length; i++) {
    const uid     = String(rows[i][COL_ACCOUNT.UID]      || '').trim();
    const testUid = String(rows[i][COL_ACCOUNT.TEST_UID] || '').trim();
    if (uid === targetUid || testUid === targetUid) {
      accountSheet.getRange(i + 1, COL_ACCOUNT.ROLE + 1).setValue(newRole);
      _log('INFO', 'apiUpdateRole', `角色更新：${rows[i][COL_ACCOUNT.NAME]} → ${newRole}`);
      try { fsSyncAccounts(); } catch (e) {}
      return { success: true };
    }
  }
  return { error: '找不到帳號' };
}

/**
 * 取消指定帳號的綁定（HR 專用）
 * 1. 刪除 LINE帳號 記錄
 * 2. 清除 主管權重 中的姓名和 LINE_UID
 * 3. 切回公開選單 A
 */
function apiResetAccount(hrLineUid, targetLineUid) {
  const info = getManagerInfo(hrLineUid);
  if (!info || (!info.isHR && !info.isSysAdmin)) return { error: '無權限' };
  if (!targetLineUid) return { error: '未提供目標 UID' };

  const accountSheet = _sheet('LINE帳號');
  const accountData = accountSheet.getDataRange().getValues();
  for (let i = accountData.length - 1; i >= 1; i--) {
    if (accountData[i][1] === targetLineUid) {
      accountSheet.deleteRow(i + 1);
    }
  }

  const weightSheet = _sheet('主管權重');
  const weightData = weightSheet.getDataRange().getValues();
  for (let i = 1; i < weightData.length; i++) {
    if (weightData[i][3] === targetLineUid) {
      weightSheet.getRange(i + 1, 3).setValue('');
      weightSheet.getRange(i + 1, 4).setValue('');
    }
  }

  _emit('account.unbound', { lineUid: targetLineUid });

  return { success: true };
}

/** 清除全部帳號 */
function clearAllAccounts() {
  const sheet = _sheet('LINE帳號');
  sheet.clearContents();
  _setAccountSheetHeader(sheet);
  Logger.log('✅ LINE帳號 已清除');
}

/** 清除 G欄勾選的帳號 */
function clearCheckedAccounts() {
  const sheet = _sheet('LINE帳號');
  const data = sheet.getDataRange().getValues();
  let count = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][COL_ACCOUNT.CLEAR] === true) {
      sheet.deleteRow(i + 1);
      count++;
    }
  }
  Logger.log(`✅ 已清除 ${count} 筆帳號`);
}

/**
 * 修復 LINE帳號 G欄（電話）格式為文字，防止開頭 0 被吃掉
 * 對現有資料重新寫入，確保格式正確
 */
function fixPhoneFormat() {
  const sheet = _sheet('LINE帳號');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const phoneCol = COL_ACCOUNT.PHONE + 1;
  const range = sheet.getRange(2, phoneCol, lastRow - 1, 1);
  // 先設格式為文字
  range.setNumberFormat('@');
  // 重新寫入值（強制觸發文字格式）
  const values = range.getValues();
  range.setValues(values.map(([v]) => [String(v || '')]));

  Logger.log(`✅ 已修復 ${lastRow - 1} 列電話格式`);
}

/**
 * 補齊 LINE帳號 I欄（清除帳號）的勾選框
 * 用於修復已存在但未設定 checkbox 的列，執行一次即可
 */
function setupAccountCheckboxes() {
  const sheet = _sheet('LINE帳號');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const checkboxValidation = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  const range = sheet.getRange(2, COL_ACCOUNT.CLEAR + 1, lastRow - 1, 1);
  range.setDataValidation(checkboxValidation);

  // 空白格補 false（未勾選），已有 true/false 的不動
  const values = range.getValues();
  const corrected = values.map(([v]) => [v === true ? true : false]);
  range.setValues(corrected);

  Logger.log(`✅ 已為 ${lastRow - 1} 列設定勾選框`);
}

/**
 * 測試用：完整重置指定帳號的綁定狀態
 * 1. 從 LINE帳號 刪除該筆記錄
 * 2. 從 主管權重 清除 LINE_UID 和姓名
 * 3. 將 Rich Menu 切回公開選單 A
 * @param {string} lineUid - 要重置的 LINE UID
 */
function resetAccountForTesting(lineUid) {
  if (!lineUid) {
    Logger.log('請填入 LINE UID');
    return;
  }

  // 1. 刪除 LINE帳號 記錄
  const accountSheet = _sheet('LINE帳號');
  const accountData = accountSheet.getDataRange().getValues();
  for (let i = accountData.length - 1; i >= 1; i--) {
    if (accountData[i][1] === lineUid) {
      accountSheet.deleteRow(i + 1);
    }
  }

  // 2. 清除 主管權重 中的姓名和 LINE_UID
  const weightSheet = _sheet('主管權重');
  const weightData = weightSheet.getDataRange().getValues();
  for (let i = 1; i < weightData.length; i++) {
    if (weightData[i][3] === lineUid) {
      weightSheet.getRange(i + 1, 3).setValue(''); // C欄 姓名
      weightSheet.getRange(i + 1, 4).setValue(''); // D欄 LINE_UID
    }
  }

  // 3. 觸發解除綁定事件（切回公開選單等）
  _emit('account.unbound', { lineUid });

  Logger.log(`✅ 已重置帳號：${lineUid}`);
}

/** 初始化 LINE帳號 工作表 */
function initAccountSheet() {
  const ss = _ss();
  let sheet = ss.getSheetByName('LINE帳號');
  if (!sheet) sheet = ss.insertSheet('LINE帳號');
  sheet.clearContents();
  _setAccountSheetHeader(sheet);
  // G欄（電話）整欄設為文字格式，防止開頭 0 被吃掉
  sheet.getRange(2, COL_ACCOUNT.PHONE + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  setupRoleDropdown();
}

/** 設定 LINE帳號 表頭（共 9 欄） */
function _setAccountSheetHeader(sheet) {
  const headers = ['姓名', 'LINE_UID', 'LINE顯示名稱', '綁定時間', '狀態', '職稱', '電話', '角色', '清除帳號'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#4a90d9').setFontColor('#ffffff');
}

/**
 * 保護 LINE帳號 H欄（角色），只有 Spreadsheet 擁有者可編輯
 * 防止一般使用者自行竄改角色
 */
function protectRoleColumn() {
  const sheet = _sheet('LINE帳號');
  if (!sheet) return;

  // 移除此欄現有保護（避免重複）
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => {
    if (p.getDescription() === 'role-column') p.remove();
  });

  const protection = sheet.getRange(1, COL_ACCOUNT.ROLE + 1, sheet.getMaxRows(), 1)
    .protect()
    .setDescription('role-column');

  // 只保留擁有者，移除其他所有編輯者
  protection.removeEditors(protection.getEditors());
  // 若不是 G Suite 網域，需要 setDomainEdit(false)
  if (protection.canDomainEdit()) protection.setDomainEdit(false);

  Logger.log('✅ H欄（角色）保護已設定，僅擁有者可編輯');
}

/**
 * 設定 LINE帳號 H欄（角色）的下拉式選單
 * 執行一次即可；新增帳號後如需補設可再執行
 */
function setupRoleDropdown() {
  const sheet = _sheet('LINE帳號');
  if (!sheet) return;
  const lastRow = Math.max(sheet.getLastRow(), 2);
  const roleValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(['系統管理員', 'HR', '主管', '同仁'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, COL_ACCOUNT.ROLE + 1, lastRow - 1, 1).setDataValidation(roleValidation);
  Logger.log(`✅ H欄（角色）下拉已設定（第 2～${lastRow} 列）`);
}
