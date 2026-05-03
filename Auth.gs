function normalizeAdminEmail_(s) {
  return String(s || '').trim().toLowerCase();
}

function requireAdmin_() {
  const raw = safeGetUserEmail_();
  const email = normalizeAdminEmail_(raw);
  if (!email) throw new Error('需要登入 Google 帳號才能使用管理頁。');
  const admins = getAdminEmails_().map(normalizeAdminEmail_);
  if (!admins.length) {
    throw new Error('尚未設定管理員（請在 Apps Script「專案設定」→「指令碼屬性」檢查 ADMIN_EMAILS）。');
  }
  if (!admins.includes(email)) {
    throw new Error('你沒有管理員權限（此 Google 帳號與 ADMIN_EMAILS 不符）。');
  }
}

function getAdminEmails_() {
  const raw = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '';
  return raw
    .split(/[,\n;]/g)
    .map(s => String(s).trim())
    .filter(Boolean);
}
