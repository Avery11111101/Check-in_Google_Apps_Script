function requireAdmin_() {
  const email = safeGetUserEmail_();
  if (!email) throw new Error('需要登入 Google 帳號才能使用管理頁。');
  const admins = getAdminEmails_();
  if (!admins.includes(email)) throw new Error('你沒有管理員權限。');
}

function getAdminEmails_() {
  const raw = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '';
  return raw
    .split(/[,\n;]/g)
    .map(s => String(s).trim())
    .filter(Boolean);
}

function adminAddCurrentUser() {
  const email = safeGetUserEmail_();
  if (!email) throw new Error('無法取得登入 email。');
  const admins = new Set(getAdminEmails_());
  admins.add(email);
  PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', Array.from(admins).join(','));
  return { ok: true, admins: Array.from(admins) };
}

function adminListAdmins() {
  requireAdmin_();
  return { ok: true, admins: getAdminEmails_().sort((a, b) => a.localeCompare(b)) };
}

function adminAddAdminEmail(payload) {
  requireAdmin_();
  const email = (payload && payload.email) ? String(payload.email).trim().toLowerCase() : '';
  if (!email || !email.includes('@')) throw new Error('請輸入正確的 email。');
  const admins = new Set(getAdminEmails_().map(e => e.toLowerCase()));
  admins.add(email);
  PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', Array.from(admins).join(','));
  return { ok: true, admins: Array.from(admins).sort((a, b) => a.localeCompare(b)) };
}

function adminRemoveAdminEmail(payload) {
  requireAdmin_();
  const email = (payload && payload.email) ? String(payload.email).trim().toLowerCase() : '';
  const current = safeGetUserEmail_().trim().toLowerCase();
  if (!email) throw new Error('缺少 email。');
  if (email === current) throw new Error('不能移除自己（避免鎖死管理權限）。');

  const admins = new Set(getAdminEmails_().map(e => e.toLowerCase()));
  admins.delete(email);
  PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', Array.from(admins).join(','));
  return { ok: true, admins: Array.from(admins).sort((a, b) => a.localeCompare(b)) };
}

