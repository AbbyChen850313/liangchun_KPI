/** Apps Script API から呼ばれる初期化用ヘルパー（外部から直接呼ばない） */
function _setupProp(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

/**
 * Firebase.gs
 * Firestore REST API 整合
 * 私鑰存在 Script Properties → FIREBASE_SA（JSON 字串）
 * 不存在程式碼或 GitHub
 */

const FS_PROJECT = 'linchun-hr';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/(default)/documents`;

// ── Token ────────────────────────────────────────────────

function _fsToken() {
  const cache = CacheService.getScriptCache();
  const hit   = cache.get('fs_token');
  if (hit) return hit;

  const sa  = JSON.parse(PropertiesService.getScriptProperties().getProperty('FIREBASE_SA'));
  const now = Math.floor(Date.now() / 1000);

  const header  = _b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = _b64u(JSON.stringify({
    iss:   sa.client_email,
    sub:   sa.client_email,
    aud:  'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  }));

  const sig = _b64u(Utilities.computeRsaSha256Signature(
    `${header}.${payload}`, sa.private_key
  ));

  const jwt  = `${header}.${payload}.${sig}`;
  const resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method:      'post',
    contentType: 'application/x-www-form-urlencoded',
    payload:     `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const token = JSON.parse(resp.getContentText()).access_token;
  cache.put('fs_token', token, 3500);
  return token;
}

function _b64u(input) {
  const bytes = (typeof input === 'string')
    ? Utilities.newBlob(input).getBytes()
    : input;
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

// ── CRUD ─────────────────────────────────────────────────

/** 寫入/覆蓋單一文件 */
function fsSet(collection, docId, data) {
  const url  = `${FS_BASE}/${collection}/${encodeURIComponent(docId)}`;
  const resp = UrlFetchApp.fetch(url, {
    method:      'PATCH',
    contentType: 'application/json',
    headers:     { Authorization: `Bearer ${_fsToken()}` },
    payload:     JSON.stringify({ fields: _toFields(data) }),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    _log('WARN', 'fsSet', `Firestore 寫入失敗 HTTP ${code}`, `${collection}/${docId}`);
  }
}

/** 讀取單一文件，回傳 plain object；找不到回傳 null */
function fsGet(collection, docId) {
  const url  = `${FS_BASE}/${collection}/${encodeURIComponent(docId)}`;
  const resp = UrlFetchApp.fetch(url, {
    headers:            { Authorization: `Bearer ${_fsToken()}` },
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code === 404) return null;
  if (code < 200 || code >= 300) {
    _log('WARN', 'fsGet', `Firestore 讀取失敗 HTTP ${code}`, `${collection}/${docId}`);
    return null;
  }
  const doc = JSON.parse(resp.getContentText());
  return _fromFields(doc.fields);
}

/** 刪除單一文件 */
function fsDelete(collection, docId) {
  const url  = `${FS_BASE}/${collection}/${encodeURIComponent(docId)}`;
  const resp = UrlFetchApp.fetch(url, {
    method:             'delete',
    headers:            { Authorization: `Bearer ${_fsToken()}` },
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    _log('WARN', 'fsDelete', `Firestore 刪除失敗 HTTP ${code}`, `${collection}/${docId}`);
  }
}

/** 批次寫入（最多 500 筆） */
function fsBatchSet(writes) {
  // writes: [{ collection, docId, data }, ...]
  const url = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/(default)/documents:commit`;
  const body = {
    writes: writes.map(w => ({
      update: {
        name:   `projects/${FS_PROJECT}/databases/(default)/documents/${w.collection}/${encodeURIComponent(w.docId)}`,
        fields: _toFields(w.data),
      },
    })),
  };
  const resp = UrlFetchApp.fetch(url, {
    method:      'POST',
    contentType: 'application/json',
    headers:     { Authorization: `Bearer ${_fsToken()}` },
    payload:     JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    _log('WARN', 'fsBatchSet', `Firestore 批次寫入失敗 HTTP ${code}`, `${writes.length} 筆`);
  }
}

// ── Type conversion ───────────────────────────────────────

function _toFields(obj) {
  const f = {};
  Object.entries(obj).forEach(([k, v]) => { f[k] = _toValue(v); });
  return f;
}

function _toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean')        return { booleanValue: v };
  if (typeof v === 'number')
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string')         return { stringValue: v };
  if (v instanceof Date)             return { timestampValue: v.toISOString() };
  if (Array.isArray(v))
    return { arrayValue: { values: v.map(_toValue) } };
  if (typeof v === 'object')
    return { mapValue: { fields: _toFields(v) } };
  return { stringValue: String(v) };
}

function _fromFields(fields) {
  if (!fields) return {};
  const obj = {};
  Object.entries(fields).forEach(([k, v]) => { obj[k] = _fromValue(v); });
  return obj;
}

function _fromValue(v) {
  if ('nullValue'      in v) return null;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('integerValue'   in v) return parseInt(v.integerValue);
  if ('doubleValue'    in v) return v.doubleValue;
  if ('stringValue'    in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue'     in v) return (v.arrayValue.values || []).map(_fromValue);
  if ('mapValue'       in v) return _fromFields(v.mapValue.fields);
  return null;
}

// ── 初始化 / 全量同步 ─────────────────────────────────────

/**
 * 第一次設定時執行一次，把所有 Sheet 資料同步進 Firestore。
 * 之後每次改動由各模組的 hook 增量同步。
 */
function syncAllToFirebase() {
  Logger.log('開始全量同步 → Firebase...');
  fsSyncSettings();
  fsSyncAccounts();
  fsSyncEmployees();
  fsSyncScoreItems();
  fsSyncAllManagerDashboards();
  Logger.log('全量同步完成');
}

// ── 各模組同步函式 ────────────────────────────────────────

function fsSyncSettings() {
  const settings = getSettings();
  fsSet('meta', 'settings', settings);
  Logger.log('同步 settings 完成');
}

function fsSyncAccounts() {
  const isTest     = _isTestRequest();
  const collection = isTest ? 'test_accounts' : 'accounts';
  const rows       = _sheetRows('LINE帳號'); // 自動路由到正確 Spreadsheet
  const writes     = [];
  for (let i = 1; i < rows.length; i++) {
    const uid = String(rows[i][COL_ACCOUNT.UID] || '').trim();
    if (!uid) continue;
    const data = {
      name:        String(rows[i][COL_ACCOUNT.NAME]         || '').trim(),
      displayName: String(rows[i][COL_ACCOUNT.DISPLAY_NAME] || '').trim(),
      jobTitle:    String(rows[i][COL_ACCOUNT.JOB_TITLE]    || '').trim(),
      role:        String(rows[i][COL_ACCOUNT.ROLE]         || '').trim(),
      status:      String(rows[i][COL_ACCOUNT.STATUS]       || '').trim(),
      employeeId:  String(rows[i][COL_ACCOUNT.EMPLOYEE_ID]  || '').trim(),
    };
    writes.push({ collection, docId: uid, data });
  }
  if (writes.length) fsBatchSet(writes);
  _log('INFO', 'fsSyncAccounts', `同步完成`, { collection, count: writes.length });
}

function fsSyncEmployees() {
  const isTest     = _isTestRequest();
  const collection = isTest ? 'test_employees' : 'employees';
  const rows       = _sheetRows('員工資料');
  const writes     = [];
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][1] || '').trim();
    if (!name) continue;
    writes.push({
      collection,
      docId: name,
      data: {
        name,
        dept:      String(rows[i][2] || '').trim(),
        section:   String(rows[i][3] || '').trim(),
        joinDate:  rows[i][4] ? new Date(rows[i][4]).toISOString() : null,
        leaveDate: rows[i][5] ? new Date(rows[i][5]).toISOString() : null,
      },
    });
  }
  if (writes.length) fsBatchSet(writes);
  Logger.log(`同步 ${collection} ${writes.length} 筆`);
}

function fsSyncScoreItems() {
  const rows  = _sheetRows('評分項目');
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][0] || '').trim();
    if (!name) continue;
    items.push({ name, weight: Number(rows[i][1]) || 0 });
  }
  fsSet('meta', 'scoreItems', { items });
  Logger.log(`同步 scoreItems ${items.length} 項`);
}

function fsSyncAllManagerDashboards() {
  const isTest   = _isTestRequest();
  const accounts = _sheetRows('LINE帳號'); // 自動路由到正確 Spreadsheet
  const quarter  = getCurrentQuarter();
  for (let i = 1; i < accounts.length; i++) {
    const uid  = String(accounts[i][COL_ACCOUNT.UID]  || '').trim();
    const role = String(accounts[i][COL_ACCOUNT.ROLE] || '').trim();
    if (role === 'HR' || role === '系統管理員') continue;
    if (!uid) continue;
    try {
      fsSyncManagerDashboard(uid, quarter, isTest);
    } catch (e) {
      _log('WARN', 'fsSyncAllManagerDashboards', '單筆同步失敗，繼續下一筆', {
        uid: '…' + uid.slice(-4),
        error: e.message,
      });
    }
  }
}

/** 計算並寫入單一主管的 dashboard snapshot（isTest=true 時寫入 test_managerDashboard） */
function fsSyncManagerDashboard(managerUid, quarter, isTest) {
  _setRequestIsTest(isTest); // 確保 _sheet() 路由到正確 Spreadsheet
  const info = getManagerInfo(managerUid);
  if (!info || info.isHR || info.isSysAdmin) return;
  const status     = getScoreStatus(info, quarter || getCurrentQuarter());
  const collection = isTest ? 'test_managerDashboard' : 'managerDashboard';
  fsSet(collection, managerUid, {
    quarter:     status.quarter,
    total:       status.total,
    scored:      status.scored,
    draft:       status.draft,
    managerName: info.managerName,
    employees:   status.employees,
    updatedAt:   new Date().toISOString(),
  });
}

/** 同步單筆評分記錄（isTest=true 時寫入 test_scores collection） */
function fsSyncScore(quarter, managerUid, empName, data, isTest) {
  const collection = isTest ? 'test_scores' : 'scores';
  const docId      = `${quarter}_${managerUid}_${empName}`;
  fsSet(collection, docId, {
    quarter,
    managerUid,
    empName,
    ...data,
    updatedAt: new Date().toISOString(),
  });
}
