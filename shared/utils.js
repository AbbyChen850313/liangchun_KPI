// ============================================================
// shared/utils.js — 共用工具函式（單一維護點）
// ============================================================

function callGAS(action, args) {
  return fetch(GAS_URL, {
    method: 'POST',
    body: JSON.stringify({ action, args: args || [] }),
  }).then(r => r.json());
}

function showToast(msg, duration) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration || 3000);
}

/** HTML 跳脫，防止 innerHTML 插入時的 XSS */
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
