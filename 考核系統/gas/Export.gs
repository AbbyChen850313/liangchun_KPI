// ============================================================
// Export.gs — 匯出考核結果
// ============================================================

/**
 * 匯出指定季度的評分結果到新的 Google Sheet，並回傳連結
 * @param {string} quarter - 如 "115Q1"
 * @param {boolean} [isTest=false]
 * @returns {Object} { success, url, message }
 */
function exportScores(quarter, isTest) {
  const ss = _ss();
  const recordSheet = _sheet('評分記錄');
  if (!recordSheet) return { error: '工作表「評分記錄」不存在' };
  const recordData = recordSheet.getDataRange().getValues();

  // 收集所有已送出的評分
  const records = [];
  for (let i = 1; i < recordData.length; i++) {
    if (recordData[i][0] === quarter && recordData[i][16] === '已送出') {
      records.push(recordData[i]);
    }
  }

  // 建立新工作表或覆蓋（測試環境加前綴，避免汙染正式匯出）
  const exportSheetName = isTest ? `匯出_TEST_${quarter}` : `匯出_${quarter}`;
  let exportSheet = ss.getSheetByName(exportSheetName);
  if (!exportSheet) {
    exportSheet = ss.insertSheet(exportSheetName);
  } else {
    exportSheet.clearContents();
  }

  // 標題列
  const headers = [
    '季度', '被評科別', '被評人員',
    '評分主管', '主管權重',
    '職能專業度', '工作效率', '成本意識', '部門合作', '責任感', '主動積極',
    '原始平均分', '特殊加減分', '調整後分數', '加權分數', '備註',
  ];
  exportSheet.appendRow(headers);

  // 填入各主管評分明細
  for (const row of records) {
    exportSheet.appendRow([
      row[0], row[3], row[2],                                    // 季度、科別、被評人
      row[1], row[4],                                            // 主管、權重
      row[5], row[6], row[7], row[8], row[9], row[10],          // 6項分數
      row[11], row[12], row[13], row[14], row[15],              // 計算結果
    ]);
  }

  // 加一個空白分隔行再加最終彙總
  exportSheet.appendRow([]);
  exportSheet.appendRow(['=== 最終加權總分 ===']);
  exportSheet.appendRow(['被評科別', '被評人員', '最終加權總分', '等級']);

  // 取得所有員工清單
  const empSet = new Set();
  for (const row of records) {
    empSet.add(`${row[3]}|${row[2]}`); // 科別|姓名
  }

  for (const key of empSet) {
    const [section, name] = key.split('|');
    const result = calcWeightedScore(name, quarter, isTest);
    if (result) {
      exportSheet.appendRow([section, name, result.totalScore, result.grade]);
    }
  }

  // 格式化
  const lastRow = exportSheet.getLastRow();
  exportSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#4a90d9').setFontColor('#ffffff');
  exportSheet.autoResizeColumns(1, headers.length);

  return {
    success: true,
    url: ss.getUrl() + '#gid=' + exportSheet.getSheetId(),
    message: `已匯出 ${records.length} 筆評分記錄`,
  };
}

/**
 * 初始化評分項目工作表
 */
function initScoreItemsSheet() {
  const ss = _ss();
  let sheet = ss.getSheetByName('評分項目');
  if (!sheet) sheet = ss.insertSheet('評分項目');

  const data = [
    ['項目代碼', '項目名稱', '說明'],
    ['item1', '【職能專業度】', '根據公司任用職務項目，能充分自主完成工作'],
    ['item2', '【工作效率】', '工作效率高，如期達成工作目標'],
    ['item3', '【成本意識】', '成本意識強烈，能積極節省，避免浪費'],
    ['item4', '【部門合作】', '協作能力，能與同部門、跨部門同事配合'],
    ['item5', '【責任感】', '具有極責任心，能徹底達成任務'],
    ['item6', '【主動積極】', '能自動自發與人合作解決問題'],
  ];

  sheet.clearContents();
  sheet.getRange(1, 1, data.length, 3).setValues(data);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#4a90d9').setFontColor('#ffffff');
}

/**
 * 一鍵初始化所有工作表（首次部署時執行）
 */
function initAllSheets() {
  initSettingsSheet();
  initAccountSheet();
  initEmployeeSheet();
  initWeightSheet();
  initScoreSheet();
  initSelfAssessSheet();
  initScoreItemsSheet();
  initDocumentationSheets();
  Logger.log('所有工作表初始化完成');
}
