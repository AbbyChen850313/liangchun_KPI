// ============================================================
// RichMenu.gs — LINE Rich Menu 角色分流設定
// ============================================================
//
// 使用方式：
//   Step 1. 將 4 張圖片上傳到 Google Drive
//   Step 2. 把各圖的 Drive 檔案 ID 填入下方 DRIVE_FILE_IDS
//   Step 3. 確認下方 ACTION_URLS 的連結正確
//   Step 4. 在 GAS 編輯器執行 setupRichMenus()（只需執行一次）
//
// ============================================================

// ── 圖片來源（Google Drive 檔案 ID）────────────────────────
// 上傳圖片到 Drive 後，右鍵 → 取得連結 → 複製 ID 填入
const RICH_MENU_IMAGES = {
  A:   '1w5zK-TqxFUyN_UxGIRkVMN9MoBZJOpA4',  // 雜人/未綁定選單
  B:   '1yB-aWx8781knytIrFXHYsmU_jAJ862zq',  // 同仁選單
  C1:  '1prP0pLQeIbbpLlpz1m0izeu4wl_M5oxu',  // 主管第一頁（頂部150px Tab亮）
  C2:  '1BpXaXmOxNSj-5LJX0LUh7YtT5_48y_Mn',  // 主管第二頁（頂部150px Tab亮）
};

// ── 各按鈕連結────────────────────────────────────────────────
// liffId 依目前環境動態取得（在 setupRichMenus() 呼叫時才決定，不是 load-time）
function _getActionUrls() {
  const liffId = getActiveEnv().liffId;
  return {
    官網:         'https://www.liangchun.com.tw/article.php?lang=tw&tb=5',
    綁定帳號:     `https://liff.line.me/${liffId}`,
    考核系統:     `https://liff.line.me/${liffId}`,
    // A、B：直接連結到 Ragic 表單
    我要請款:     'https://ap10.ragic.com/liangchun/ragicadministration/20005?webview&webaction=form&ver=new&version=2',
    查詢請款:     'https://ap10.ragic.com/liangchun/ragicadministration/20005?webview&webaction=query',
    // C~F：發出關鍵字文字，觸發 LINE OA 自動回應的多頁選單
    重要表單QA:   '重要表單',
    公司活動報名: '我要報名',
    讚賞幣:       '我要發出讚賞幣!!',
    出勤:         '出勤相關',
  };
}

// ── Rich Menu Alias 名稱（Tab 切換用，不需修改）────────────
const ALIAS_MANAGER_P1 = 'alias-manager-p1';
const ALIAS_MANAGER_P2 = 'alias-manager-p2';

// ============================================================
// 一次性設定函式（執行一次即可）
// ============================================================

/**
 * 建立所有 Rich Menu 並設定預設值
 * 執行完成後，在 GAS 執行記錄查看各 richMenuId
 */
function setupRichMenus() {
  Logger.log('=== 開始建立 Rich Menu ===');

  // 1. 建立 4 個 Rich Menu，取得 ID
  const idA  = _createRichMenu(_buildMenuA());
  const idB  = _createRichMenu(_buildMenuB());
  const idC1 = _createRichMenu(_buildMenuC1());
  const idC2 = _createRichMenu(_buildMenuC2());

  Logger.log(`A  (雜人)     richMenuId: ${idA}`);
  Logger.log(`B  (同仁)     richMenuId: ${idB}`);
  Logger.log(`C1 (主管Tab1) richMenuId: ${idC1}`);
  Logger.log(`C2 (主管Tab2) richMenuId: ${idC2}`);

  // 2. 上傳圖片到各 Rich Menu
  _uploadRichMenuImage(idA,  RICH_MENU_IMAGES.A);
  _uploadRichMenuImage(idB,  RICH_MENU_IMAGES.B);
  _uploadRichMenuImage(idC1, RICH_MENU_IMAGES.C1);
  _uploadRichMenuImage(idC2, RICH_MENU_IMAGES.C2);
  Logger.log('圖片上傳完成');

  // 3. 建立 Alias（Tab 切換要用）
  _createOrUpdateAlias(ALIAS_MANAGER_P1, idC1);
  _createOrUpdateAlias(ALIAS_MANAGER_P2, idC2);
  Logger.log('Alias 建立完成');

  // 4. 設定 A 為全域預設（所有人預設看到雜人選單）
  _setDefaultRichMenu(idA);
  Logger.log('預設選單設定完成（A）');

  // 5. 將 richMenuId 存到系統設定，方便後續查詢
  updateSettings({
    'RichMenu_A':  idA,
    'RichMenu_B':  idB,
    'RichMenu_C1': idC1,
    'RichMenu_C2': idC2,
  });

  // 6. 重新連結所有已綁定使用者到對應的新選單
  //    （避免舊個人連結蓋過新全域預設，造成使用者停在舊選單）
  _relinkAllBoundUsers();

  Logger.log('=== Rich Menu 設定完成 ===');
}

/**
 * 將「LINE帳號」表裡所有已授權使用者重新連結到對應的新選單
 * 在 setupRichMenus() 後呼叫，確保沒有人停在舊選單上
 */
function _relinkAllBoundUsers() {
  const rows = _sheetRows('LINE帳號');
  let count = 0;
  for (let i = 1; i < rows.length; i++) {
    const uid    = String(rows[i][1] || '').trim();
    const status = String(rows[i][4] || '').trim();
    const role   = String(rows[i][7] || '').trim();
    if (!uid || status !== '已授權') continue;
    switchRichMenuByRole(uid, role);
    count++;
  }
  Logger.log(`重新連結完成，共 ${count} 位使用者`);
}

// ============================================================
// 綁定後切換 Rich Menu（Auth.gs 綁定成功後呼叫）
// ============================================================

/**
 * 依職稱類別為使用者切換 Rich Menu
 * @param {string} lineUid
 * @param {string} titleCategory - HR Sheet O欄的職稱類別值（如 '經理', '協理', '董事長', 'HR'）
 */
/**
 * @param {string} lineUid
 * @param {string} [role] - 已知角色可直接傳入，省去重新查 Sheet（'系統管理員'|'HR'|'主管'|'同仁'）
 */
function switchRichMenuByRole(lineUid, role) {
  const settings = getSettings();
  const resolvedRole = role || (getManagerInfo(lineUid) || {}).role || '';
  // 系統管理員/HR/主管 → C1；同仁或未知 → B
  const needsManagerMenu = ['系統管理員', 'HR', '主管'].includes(resolvedRole);
  const richMenuId = needsManagerMenu ? settings['RichMenu_C1'] : settings['RichMenu_B'];

  if (!richMenuId) {
    _log('WARN', 'switchRichMenuByRole', '找不到 RichMenu ID，請先執行 setupRichMenus()', { lineUid: '…' + lineUid.slice(-4) });
    return;
  }

  _linkRichMenuToUser(lineUid, richMenuId);
  _log('INFO', 'switchRichMenuByRole', `Rich Menu 已切換`, { uid: '…' + lineUid.slice(-4), role: resolvedRole, menuKey: needsManagerMenu ? 'C1' : 'B' });
}

// ============================================================
// Rich Menu JSON 定義
// ============================================================

/** A — 雜人/未綁定（2格，全高，無 Tab） */
function _buildMenuA() {
  const urls = _getActionUrls();
  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: 'menu_a_public',
    chatBarText: '選單',
    areas: [
      _area(0, 0, 1250, 1686, { type: 'uri', uri: urls.官網 }),
      _area(1250, 0, 1250, 1686, { type: 'uri', uri: urls.綁定帳號 }),
    ],
  };
}

/** B — 一般同仁（6格，2列×3欄，無 Tab） */
function _buildMenuB() {
  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: 'menu_b_employee',
    chatBarText: '選單',
    areas: _sixCellAreas(0),
  };
}

/** C-1 — 主管第一頁（Tab bar + 6格，Tab1 選中） */
function _buildMenuC1() {
  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: 'menu_c1_manager_p1',
    chatBarText: '選單',
    areas: [
      // Tab bar 高度 300px（手機顯示約 47px，符合觸控最小尺寸）
      // 兩個都用 richmenuswitch，避免 postback 在部分 LINE 版本觸發瀏覽器跳轉
      _area(0,    0, 1250, 300, { type: 'richmenuswitch', richMenuAliasId: ALIAS_MANAGER_P1, data: 'tab=1' }),
      _area(1250, 0, 1250, 300, { type: 'richmenuswitch', richMenuAliasId: ALIAS_MANAGER_P2, data: 'tab=2' }),
      // 六宮格內容（從 y=300 開始）
      ..._sixCellAreas(300),
    ],
  };
}

/** C-2 — 主管第二頁（Tab bar + 1格考核系統，Tab2 選中） */
function _buildMenuC2() {
  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: 'menu_c2_manager_p2',
    chatBarText: '選單',
    areas: [
      // Tab bar 高度 300px（與 C-1 一致）
      _area(0,    0, 1250, 300, { type: 'richmenuswitch', richMenuAliasId: ALIAS_MANAGER_P1, data: 'tab=1' }),
      _area(1250, 0, 1250, 300, { type: 'richmenuswitch', richMenuAliasId: ALIAS_MANAGER_P2, data: 'tab=2' }),
      // 整塊大按鈕：考核系統
      _area(0, 300, 2500, 1386, { type: 'uri', uri: _getActionUrls().考核系統 }),
    ],
  };
}

// ============================================================
// Helper：Rich Menu 座標與六宮格
// ============================================================

/**
 * 建立 area 物件
 * @param {number} x
 * @param {number} y
 * @param {number} w - 寬度
 * @param {number} h - 高度
 * @param {Object} action - LINE action 物件
 */
function _area(x, y, w, h, action) {
  return {
    bounds: { x, y, width: w, height: h },
    action,
  };
}

/**
 * 建立標準六宮格（2列 × 3欄）的 areas 陣列
 * @param {number} startY - 內容區起始 Y 座標（有 Tab 時傳 300，無 Tab 時傳 0）
 */
function _sixCellAreas(startY) {
  const totalH = 1686 - startY;
  const rowH = Math.floor(totalH / 2);
  const colW = [833, 833, 834]; // 三欄寬（總和 2500）

  const urls = _getActionUrls();
  const actions = [
    { type: 'uri',     uri:  urls.我要請款 },
    { type: 'uri',     uri:  urls.查詢請款 },
    { type: 'message', text: urls.重要表單QA },    // 發關鍵字 → 自動回應多頁選單
    { type: 'message', text: urls.公司活動報名 },
    { type: 'message', text: urls.讚賞幣 },
    { type: 'message', text: urls.出勤 },
  ];

  const areas = [];
  for (let row = 0; row < 2; row++) {
    let xOffset = 0;
    for (let col = 0; col < 3; col++) {
      areas.push(_area(
        xOffset,
        startY + row * rowH,
        colW[col],
        rowH,
        actions[row * 3 + col]
      ));
      xOffset += colW[col];
    }
  }
  return areas;
}

// ============================================================
// LINE API 呼叫
// ============================================================

/** 取得目前作用中環境的 Bot Token（依 request context 決定，確保測試請求用測試 token） */
function _getBotToken() {
  return _isTestRequest() ? CONFIG.LINE_BOT_TOKEN_TEST : CONFIG.LINE_BOT_TOKEN;
}

function _lineApiPost(path, payload) {
  const response = UrlFetchApp.fetch(`https://api.line.me${path}`, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${_getBotToken()}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code !== 200) throw new Error(`LINE API ${path} 失敗 (${code}): ${text}`);
  return JSON.parse(text);
}

/** 建立 Rich Menu，回傳 richMenuId */
function _createRichMenu(menuDef) {
  const result = _lineApiPost('/v2/bot/richmenu', menuDef);
  return result.richMenuId;
}

/** 上傳圖片到 Rich Menu（從 Google Drive 讀取） */
function _uploadRichMenuImage(richMenuId, driveFileId) {
  const file = DriveApp.getFileById(driveFileId);
  const blob = file.getBlob();
  const mimeType = blob.getContentType();

  const response = UrlFetchApp.fetch(
    `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
    {
      method: 'post',
      contentType: mimeType,
      headers: { Authorization: `Bearer ${_getBotToken()}` },
      payload: blob.getBytes(),
      muteHttpExceptions: true,
    }
  );
  const code = response.getResponseCode();
  if (code !== 200) {
    throw new Error(`圖片上傳失敗 (${richMenuId}): ${response.getContentText()}`);
  }
}

/** 建立 Rich Menu Alias（若已存在則先刪除再建立） */
function _createOrUpdateAlias(aliasId, richMenuId) {
  // 嘗試刪除舊的（若不存在會失敗，忽略即可）
  try {
    UrlFetchApp.fetch(`https://api.line.me/v2/bot/richmenu/alias/${aliasId}`, {
      method: 'delete',
      headers: { Authorization: `Bearer ${_getBotToken()}` },
      muteHttpExceptions: true,
    });
  } catch (e) { console.warn('[setRichMenuAlias] delete old alias failed (expected if not exist):', e?.message); }

  _lineApiPost('/v2/bot/richmenu/alias', {
    richMenuAliasId: aliasId,
    richMenuId: richMenuId,
  });
}

/**
 * 清除全域預設 Rich Menu（還原正式帳號原本的選單）
 * 在 GAS 編輯器手動執行一次即可
 */
function clearDefaultRichMenu() {
  const token = CONFIG.LINE_BOT_TOKEN; // ⚠️ 這個函式專門修復正式帳號，故意用正式 token
  const response = UrlFetchApp.fetch(
    'https://api.line.me/v2/bot/user/all/richmenu',
    {
      method: 'delete',
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true,
    }
  );
  Logger.log(`清除預設 Rich Menu: ${response.getResponseCode()} ${response.getContentText()}`);
}

/** 設定全域預設 Rich Menu */
function _setDefaultRichMenu(richMenuId) {
  UrlFetchApp.fetch(
    `https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`,
    {
      method: 'post',
      headers: { Authorization: `Bearer ${_getBotToken()}` },
      muteHttpExceptions: true,
    }
  );
}

/** 將指定 Rich Menu 綁定給特定使用者 */
function _linkRichMenuToUser(lineUid, richMenuId) {
  UrlFetchApp.fetch(
    `https://api.line.me/v2/bot/user/${lineUid}/richmenu/${richMenuId}`,
    {
      method: 'post',
      headers: { Authorization: `Bearer ${_getBotToken()}` },
      muteHttpExceptions: true,
    }
  );
}
