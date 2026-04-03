// ============================================================
// Integration.gs — 整合層（外部功能在此掛鉤，不修改主程式）
// ============================================================
//
// 設計原則：
//   主程式（Auth.gs / Scoring.gs）只呼叫 _emit('event', payload)
//   外部整合（Rich Menu / Firestore / 未來模組）在此登記 _on('event', handler)
//   新增整合只需在本檔案加 _on(...)，不需要改任何主程式。
//
// 觸發點：
//   account.bound   { lineUid, name, jobTitle, role }
//     → 帳號綁定成功（含初次綁定與重綁）
//
//   account.unbound { lineUid }
//     → 帳號解除綁定（系統或使用者自行解除）
//
//   score.saved     { quarter, managerUid, managerName, empName, section,
//                     scores, note, rawScore, finalScore, weightedScore, status }
//     → 評分草稿儲存或正式送出
//
// ============================================================

const _INTEGRATION_HOOKS = {};

/** 登記事件 handler */
function _on(event, handler) {
  if (!_INTEGRATION_HOOKS[event]) _INTEGRATION_HOOKS[event] = [];
  _INTEGRATION_HOOKS[event].push(handler);
}

/**
 * 觸發事件，依序執行所有已登記的 handler
 * 單一 handler 失敗不影響其他 handler，也不影響主流程
 */
function _emit(event, payload) {
  const handlers = _INTEGRATION_HOOKS[event] || [];
  for (const h of handlers) {
    try {
      h(payload);
    } catch (e) {
      _log('WARN', `_emit[${event}]`, '整合 hook 執行失敗', e.message);
    }
  }
}

// ============================================================
// ── 整合：Rich Menu ───────────────────────────────────────────
// ============================================================

_on('account.bound', ({ lineUid, role }) => {
  switchRichMenuByRole(lineUid, role);
});

_on('account.unbound', ({ lineUid }) => {
  const richMenuA = getSettings()['RichMenu_A'];
  if (richMenuA) _linkRichMenuToUser(lineUid, richMenuA);
});

// ============================================================
// ── 整合：Firestore ───────────────────────────────────────────
// ============================================================

_on('account.bound', () => {
  fsSyncAccounts();
});

_on('score.saved', ({ quarter, managerUid, managerName, empName, section,
                      scores, note, rawScore, finalScore, weightedScore, status }) => {
  fsSyncScore(quarter, managerUid, empName, {
    managerName, section, scores, note,
    rawScore, finalScore, weightedScore, status,
  }, _isTestRequest());
  fsSyncManagerDashboard(managerUid, quarter, _isTestRequest());
});
