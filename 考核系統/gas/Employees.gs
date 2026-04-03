// ============================================================
// Employees.gs — 員工名單同步與年資計算
// ============================================================

// 評分項目定義（與 Excel 評分表一致）
const SCORE_ITEMS = [
  { key: 'item1', label: '【職能專業度】' },
  { key: 'item2', label: '【工作效率】' },
  { key: 'item3', label: '【成本意識】' },
  { key: 'item4', label: '【部門合作】' },
  { key: 'item5', label: '【責任感】' },
  { key: 'item6', label: '【主動積極】' },
];

// 等級分數對照
const GRADE_SCORES = {
  '甲': 95,
  '乙': 85,
  '丙': 65,
  '丁': 35,
};

/**
 * 從 HR Google Sheet 同步員工資料
 * 過濾條件：AK欄="算入考核"
 */
function syncEmployees() {
  const hrSS = SpreadsheetApp.openById(CONFIG.HR_SPREADSHEET_ID);
  const hrSheet = hrSS.getSheetByName('(人工打)總表');
  const hrData = hrSheet.getDataRange().getValues();

  const systemSS = _ss();
  let empSheet = systemSS.getSheetByName('員工資料');
  if (!empSheet) empSheet = systemSS.insertSheet('員工資料');

  // HR Sheet「(人工打)總表」欄位對應（0-indexed）
  const COL_EMP_ID = 2;   // C欄 = 員工編號
  const COL_NAME = 4;     // E欄 = 姓名
  const COL_DEPT = 10;    // K欄 = 部門
  const COL_SECTION = 11; // L欄 = 科別
  const COL_JOIN = 28;    // AC欄 = 到職日
  const COL_LEAVE = 30;   // AE欄 = 離職日
  const COL_INCLUDE = 36; // AK欄 = 是否算考核

  const employees = [];
  for (let i = 1; i < hrData.length; i++) {
    const row = hrData[i];
    if (String(row[COL_INCLUDE]).trim() !== '算入考核') continue;

    employees.push([
      row[COL_EMP_ID],    // 員工編號
      row[COL_NAME],      // 姓名
      row[COL_DEPT],      // 部門
      row[COL_SECTION],   // 科別
      row[COL_JOIN],      // 到職日
      row[COL_LEAVE],     // 離職日
    ]);
  }

  empSheet.clearContents();
  empSheet.appendRow(['員工編號', '姓名', '部門', '科別', '到職日', '離職日']);
  if (employees.length > 0) {
    empSheet.getRange(2, 1, employees.length, 6).setValues(employees);
  }
  empSheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#4a90d9').setFontColor('#ffffff');
  empSheet.hideColumns(6); // F欄(離職日)：系統內部使用，HR 不需要看到

  // 同步到 Firestore（失敗不影響主流程，但需留 log 供排查）
  try {
    fsSyncEmployees();
    fsSyncAllManagerDashboards();
  } catch (e) { console.warn('[importEmployees] Firestore sync failed:', e?.message); }

  return { success: true, count: employees.length };
}

/**
 * 取得主管負責評分的員工清單（含年資、試用期狀態）
 * @param {Object} managerInfo - 來自 getManagerInfo()
 * @returns {Array} 員工清單
 */
function getEmployeesForManager(managerInfo) {
  const empSheet = _sheet('員工資料');
  const empData = empSheet.getDataRange().getValues();
  const settings = getSettings();

  const quarter = settings['當前季度'] || getCurrentQuarter();
  const quarterEnd = getQuarterEndDate(quarter);
  const probationDays = parseInt(settings['試用期天數']) || 90;
  const minDays = parseInt(settings['最低評分天數']) || 3;

  // 取得主管負責的科別
  const depts = managerInfo.responsibilities.map(r => r.dept);

  const result = [];
  for (let i = 1; i < empData.length; i++) {
    const row = empData[i];
    const name = row[1];
    const dept = row[2];
    const section = row[3];
    const joinDate = row[4] ? new Date(row[4]) : null;
    const leaveDate = row[5] ? new Date(row[5]) : null;

    if (!name || !joinDate) continue;

    // 過濾科別
    if (!depts.includes(section) && !depts.includes(dept)) continue;

    // 離職過濾：離職日在季末之前則不顯示
    if (leaveDate && leaveDate < quarterEnd) continue;

    // 最低評分天數過濾
    const daysWorked = Math.floor((quarterEnd - joinDate) / (1000 * 60 * 60 * 24));
    if (daysWorked < minDays) continue;

    const isProbation = daysWorked < probationDays;
    const tenure = calcTenure(joinDate);
    const weight = managerInfo.responsibilities.find(r => r.dept === section || r.dept === dept)?.weight || 0;

    result.push({
      name,
      dept,
      section,
      joinDate: joinDate.toLocaleDateString('zh-TW'),
      tenure,
      isProbation,
      daysWorked,
      weight,
    });
  }

  return result;
}

/**
 * 計算年資（幾年幾個月）
 * @param {Date} joinDate
 * @returns {string} 如 "2年3個月"
 */
function calcTenure(joinDate) {
  const now = new Date();
  let years = now.getFullYear() - joinDate.getFullYear();
  let months = now.getMonth() - joinDate.getMonth();
  if (months < 0) {
    years--;
    months += 12;
  }
  if (years === 0) return `${months}個月`;
  if (months === 0) return `${years}年`;
  return `${years}年${months}個月`;
}

/**
 * 判斷是否為試用期（未滿N天）
 */
function isProbation(joinDate) {
  const settings = getSettings();
  const probationDays = parseInt(settings['試用期天數']) || 90;
  const now = new Date();
  const days = Math.floor((now - new Date(joinDate)) / (1000 * 60 * 60 * 24));
  return days < probationDays;
}

/**
 * 判斷是否達到最低評分天數
 */
function isEligible(joinDate) {
  const settings = getSettings();
  const minDays = parseInt(settings['最低評分天數']) || 3;
  const now = new Date();
  const days = Math.floor((now - new Date(joinDate)) / (1000 * 60 * 60 * 24));
  return days >= minDays;
}

/**
 * 取得季末日期
 * @param {string} quarter - 如 "115Q1"
 * @returns {Date}
 */
function getQuarterEndDate(quarter) {
  const rocYear = parseInt(quarter.substring(0, 3));
  const q = parseInt(quarter.charAt(4));
  const adYear = rocYear + 1911;
  const endMonth = q * 3; // Q1=3, Q2=6, Q3=9, Q4=12
  return new Date(adYear, endMonth, 0); // 月份最後一天
}

/**
 * 初始化員工資料工作表
 */
function initEmployeeSheet() {
  const ss = _ss();
  let sheet = ss.getSheetByName('員工資料');
  if (!sheet) sheet = ss.insertSheet('員工資料');

  sheet.clearContents();
  const headers = [['員工編號', '姓名', '部門', '科別', '到職日', '離職日']];
  sheet.getRange(1, 1, 1, 6).setValues(headers);
  sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#4a90d9').setFontColor('#ffffff');
  sheet.hideColumns(6); // F欄(離職日)：系統內部使用，HR 不需要看到
}

/**
 * 初始化主管權重工作表（並填入預設值）
 *
 * 欄位結構（5欄）：
 *   A 被評科別 — 接受考核的科別
 *   B 職稱     — 負責評分的主管職稱（用職稱作為唯一識別，人員異動時不需修改）
 *   C 姓名     — 目前擔任該職位者姓名（主管綁定時自動填入，方便人工核對）
 *   D LINE_UID — 主管綁定後自動填入，請勿手動修改
 *   E 權重     — 評分佔比，同科別所有主管權重加總須 = 1.0
 */
function initWeightSheet() {
  const ss = _ss();
  let sheet = ss.getSheetByName('主管權重');
  if (!sheet) sheet = ss.insertSheet('主管權重');

  // [被評科別, 職稱, 姓名, LINE_UID, 權重]
  const headers = [['被評科別', '職稱', '姓名', 'LINE_UID', '權重']];
  const defaults = [
    ['品管科',    '營運部協理',     '', '', 0.70],
    ['品管科',    '儲運科經理',     '', '', 0.15],
    ['品管科',    '生產科廠長',     '', '', 0.15],
    ['業務部',    '營運部協理',     '', '', 0.70],
    ['業務部',    '廠務部協理',     '', '', 0.15],
    ['業務部',    '永續發展科經理', '', '', 0.15],
    ['儲運科',    '儲運科經理',     '', '', 0.70],
    ['儲運科',    '廠務部協理',     '', '', 0.15],
    ['儲運科',    '營運部協理',     '', '', 0.15],
    ['儲運科經理','廠務部協理',     '', '', 0.70],
    ['儲運科經理','營運部協理',     '', '', 0.15],
    ['儲運科經理','永續發展科經理', '', '', 0.15],
    ['生產科',    '生產科廠長',     '', '', 0.70],
    ['生產科',    '廠務部協理',     '', '', 0.15],
    ['生產科',    '營運部協理',     '', '', 0.15],
    ['生產科廠長','廠務部協理',     '', '', 0.70],
    ['生產科廠長','營運部協理',     '', '', 0.15],
    ['生產科廠長','永續發展科經理', '', '', 0.15],
    ['財務科',    '永續發展科經理', '', '', 0.70],
    ['財務科',    '業務經理',       '', '', 0.10],
    ['財務科',    '業務副理',       '', '', 0.10],
    ['財務科',    '財務經理',       '', '', 0.10],
    ['永續發展科','永續發展科經理', '', '', 0.70],
    ['永續發展科','營運部協理',     '', '', 0.30],
  ];

  sheet.clearContents();
  sheet.getRange(1, 1, 1, 5).setValues(headers);
  sheet.getRange(2, 1, defaults.length, 5).setValues(defaults);
  sheet.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#4a90d9').setFontColor('#ffffff');
  sheet.autoResizeColumns(1, 5);
}
