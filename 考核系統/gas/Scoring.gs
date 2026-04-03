// ============================================================
// Scoring.gs — 評分送出、加權計算
// ============================================================

/**
 * 儲存評分草稿（可反覆呼叫，不算正式送出）
 * @param {Object} data - { lineUid, quarter, employeeName, section, scores, special, note }
 */
function saveDraft(data) {
  return _writeScore(data, false);
}

/**
 * 正式送出評分（截止日前可覆寫）
 * @param {Object} data
 */
function submitScore(data) {
  if (!isInScoringPeriod()) {
    return { error: '不在評分期間內' };
  }
  return _writeScore(data, true);
}

/**
 * 內部：寫入評分記錄
 */
function _writeScore(data, isSubmitted) {
  const managerInfo = getManagerInfo(data.lineUid);
  if (!managerInfo) {
    _log('WARN', '_writeScore', '身份驗證失敗', { uid: data.lineUid ? '…' + data.lineUid.slice(-4) : '' });
    return { error: '身份驗證失敗' };
  }

  const quarter     = data.quarter || getCurrentQuarter();
  const { employeeName, section, scores, special, note } = data;
  const managerName = managerInfo.managerName;

  // 驗證主管是否有權評此科別
  const resp = managerInfo.responsibilities.find(r => r.dept === section);
  if (!resp) {
    _log('WARN', '_writeScore', `${managerName} 無權評分此科別`, { section });
    return { error: '無權評分此科別' };
  }

  const weight = resp.weight;
  const rawScore = calcRawScore(scores);
  const specialAdj = parseFloat(special) || 0;
  const finalScore = Math.round((rawScore + specialAdj) * 100) / 100;
  const weightedScore = Math.round(finalScore * weight * 100) / 100;

  // _ss() 依 request context 自動路由到正確 Spreadsheet，兩邊 sheet 同名
  const sheet = _sheet('評分記錄') || _ss().insertSheet('評分記錄');
  const allData = sheet.getDataRange().getValues();

  // 找是否已有這筆記錄（同主管、同員工、同季度）
  let existingRow = -1;
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][0] === quarter &&
        allData[i][1] === managerName &&
        allData[i][2] === employeeName) {
      existingRow = i + 1;
      break;
    }
  }

  const rowData = [
    quarter,           // 季度
    managerName,       // 評分主管
    employeeName,      // 被評人員
    section,           // 被評科別
    weight,            // 主管權重
    scores.item1 || '', scores.item2 || '', scores.item3 || '',
    scores.item4 || '', scores.item5 || '', scores.item6 || '',
    rawScore,          // 原始平均分
    specialAdj,        // 特殊加減分
    finalScore,        // 調整後分數
    weightedScore,     // 加權分數
    note || '',        // 備註
    isSubmitted ? '已送出' : '草稿', // 狀態
    new Date(),        // 最後更新時間
  ];

  if (existingRow > 0) {
    // 草稿不可覆寫已送出的記錄（防止二次送出競爭條件）
    const existingStatus = allData[existingRow - 1][16];
    if (!isSubmitted && existingStatus === '已送出') {
      _log('WARN', '_writeScore', `${managerName} 草稿試圖覆寫已送出記錄，已阻止`, { employeeName });
      return { error: '此評分已送出，草稿無法覆寫，請重新整理頁面' };
    }
    sheet.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }

  _log('INFO', '_writeScore', `${_isTestRequest() ? '[TEST] ' : ''}${managerName} → ${employeeName} ${isSubmitted ? '送出' : '草稿'}`, { quarter, weightedScore });

  _emit('score.saved', {
    quarter, managerUid: data.lineUid, managerName, empName: employeeName,
    section, scores, note: note || '', rawScore, finalScore, weightedScore,
    status: isSubmitted ? '已送出' : '草稿',
  });

  return {
    success: true,
    rawScore,
    finalScore,
    weightedScore,
    status: isSubmitted ? '已送出' : '草稿',
  };
}

/**
 * 計算6個評分項目的平均分（甲/乙/丙/丁 → 數字）
 * @param {Object} scores - { item1: '甲', item2: '乙', ... }
 * @returns {number} 平均分
 */
function calcRawScore(scores) {
  const items = ['item1', 'item2', 'item3', 'item4', 'item5', 'item6'];
  let total = 0;
  let count = 0;
  for (const key of items) {
    const val = scores[key];
    if (!val) continue;
    const num = GRADE_SCORES[val] !== undefined ? GRADE_SCORES[val] : parseFloat(val);
    if (!isNaN(num)) {
      total += num;
      count++;
    }
  }
  return count > 0 ? Math.round((total / count) * 100) / 100 : 0;
}

/**
 * 計算某員工某季度的加權總分（彙整所有主管的評分）
 * @param {string} employeeName
 * @param {string} quarter
 * @param {boolean} [isTest=false]
 * @returns {Object} { totalScore, grade, managerScores }
 */
function calcWeightedScore(employeeName, quarter, isTest) {
  const sheet = _sheet('評分記錄');
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();

  // 找所有已送出的評分
  const scores = [];
  let section = '';
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === quarter && data[i][2] === employeeName && data[i][16] === '已送出') {
      scores.push({
        managerName: data[i][1],
        section: data[i][3],
        weight: data[i][4],
        weightedScore: data[i][14],
        finalScore: data[i][13],
      });
      section = data[i][3];
    }
  }

  if (scores.length === 0) return null;

  const totalScore = Math.round(scores.reduce((sum, s) => sum + s.weightedScore, 0) * 100) / 100;
  const grade = getGradeLabel(totalScore);

  return { totalScore, grade, managerScores: scores, section };
}

/**
 * 分數轉等級
 */
function getGradeLabel(score) {
  if (score >= 90) return '甲等';
  if (score >= 75) return '乙等';
  if (score >= 60) return '丙等';
  return '丁等';
}

/**
 * 取得主管的評分完成狀況
 * @param {Object} managerInfo
 * @param {string} quarter
 * @param {boolean} [isTest=false] - 是否讀取測試環境評分記錄
 * @returns {Object} { total, scored, pending, employees }
 */
function getScoreStatus(managerInfo, quarter, isTest) {
  const employees = getEmployeesForManager(managerInfo);

  const sheet = _sheet('評分記錄');
  if (!sheet) {
    return { total: employees.length, scored: 0, draft: 0, pending: employees.length,
             employees: employees.map(e => ({ ...e, scoreStatus: '未評分' })), quarter };
  }
  const recordData = sheet.getDataRange().getValues();

  const scoredNames = new Set();
  const draftNames = new Set();
  for (let i = 1; i < recordData.length; i++) {
    if (recordData[i][0] === quarter && recordData[i][1] === managerInfo.managerName) {
      if (recordData[i][16] === '已送出') {
        scoredNames.add(recordData[i][2]);
      } else if (recordData[i][16] === '草稿') {
        draftNames.add(recordData[i][2]);
      }
    }
  }

  const result = employees.map(emp => ({
    ...emp,
    scoreStatus: scoredNames.has(emp.name) ? '已送出' :
                 draftNames.has(emp.name) ? '草稿' : '未評分',
  }));

  return {
    total: employees.length,
    scored: scoredNames.size,
    draft: draftNames.size,
    pending: employees.length - scoredNames.size,
    employees: result,
    quarter,
  };
}

/**
 * 取得主管對某員工已填的評分（草稿或已送出）
 * @param {boolean} [isTest=false] - 是否讀取測試環境評分記錄
 */
function getMyScores(lineUid, quarter, isTest) {
  const managerInfo = getManagerInfo(lineUid);
  if (!managerInfo) return {};

  const sheet = _sheet('評分記錄');
  if (!sheet) return {};
  const data = sheet.getDataRange().getValues();

  const result = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === quarter && data[i][1] === managerInfo.managerName) {
      result[data[i][2]] = {
        scores: {
          item1: data[i][5], item2: data[i][6],
          item3: data[i][7], item4: data[i][8],
          item5: data[i][9], item6: data[i][10],
        },
        special: data[i][12],
        note: data[i][15],
        status: data[i][16],
      };
    }
  }
  return result;
}

/**
 * 取得所有主管評分完成進度（HR用）
 */
function getAllManagerStatus(quarter, isTest) {
  const accountData = _sheetRows('LINE帳號');

  const result = [];
  for (let i = 1; i < accountData.length; i++) {
    const name = accountData[i][0];
    const uid = accountData[i][1];
    const status = accountData[i][4];
    if (status !== '已授權') continue;

    const managerInfo = getManagerInfo(uid);
    if (!managerInfo) continue;

    const testUid     = String(accountData[i][COL_ACCOUNT.TEST_UID] || '').trim();
    const scoreStatus = getScoreStatus(managerInfo, quarter, !!isTest);
    result.push({
      managerName: name,
      lineUid: uid,
      testUid,
      total: scoreStatus.total,
      scored: scoreStatus.scored,
      pending: scoreStatus.pending,
    });
  }
  return result;
}

/**
 * 初始化評分記錄工作表
 */
function initScoreSheet() {
  const ss = _ss();
  let sheet = ss.getSheetByName('評分記錄');
  if (!sheet) sheet = ss.insertSheet('評分記錄');

  const headers = [[
    '季度', '評分主管', '被評人員', '被評科別', '主管權重',
    '職能專業度', '工作效率', '成本意識', '部門合作', '責任感', '主動積極',
    '原始平均分', '特殊加減分', '調整後分數', '加權分數',
    '備註', '狀態', '最後更新',
  ]];
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
  sheet.getRange(1, 1, 1, headers[0].length).setFontWeight('bold').setBackground('#4a90d9').setFontColor('#ffffff');
}
