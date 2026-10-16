function normalizeAdminEmail_(s) {
  return String(s || '').trim().toLowerCase();
}

function getAdminEmails_() {
  const raw = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '';
  return raw
    .split(/[,\n;]/g)
    .map(s => String(s).trim())
    .filter(Boolean);
}

function getAdminSecretToken_() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('ADMIN_SECRET_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    props.setProperty('ADMIN_SECRET_TOKEN', token);
  }
  return token;
}

function verifyAdminSecretToken_(token) {
  const t = String(token || '').trim();
  if (!t) return false;
  const expected = String(getAdminSecretToken_() || '').trim();
  return expected.length > 0 && t === expected;
}

function setAdminUserSession_() {
  try {
    const userCache = CacheService.getUserCache();
    if (userCache) {
      userCache.put('admin_auth_passed', 'true', 21600);
      return true;
    }
  } catch (_e) {}
  return false;
}

function clearAdminUserSession_() {
  try {
    const userCache = CacheService.getUserCache();
    if (userCache) userCache.remove('admin_auth_passed');
  } catch (_e) {}
}

function checkAdminAuth_(optionalToken) {
  // 軌道 1：Google Email 驗證
  const raw = safeGetUserEmail_();
  const email = normalizeAdminEmail_(raw);
  if (email) {
    const admins = getAdminEmails_().map(normalizeAdminEmail_);
    if (admins.length && admins.includes(email)) {
      return true;
    }
  }

  // 軌道 2：UserCache Session 檢查
  try {
    const userCache = CacheService.getUserCache();
    if (userCache && userCache.get('admin_auth_passed') === 'true') {
      return true;
    }
  } catch (_e) {}

  // 軌道 3：傳入的 ADMIN_SECRET_TOKEN 驗證
  if (optionalToken && verifyAdminSecretToken_(optionalToken)) {
    setAdminUserSession_();
    return true;
  }

  return false;
}

function requireAdmin_(optionalToken) {
  if (checkAdminAuth_(optionalToken)) return;

  const raw = safeGetUserEmail_();
  const email = normalizeAdminEmail_(raw);
  if (!email) {
    throw new Error('需要登入 Google 帳號或輸入正確的 ADMIN_SECRET_TOKEN 才能使用管理頁。');
  }
  const admins = getAdminEmails_().map(normalizeAdminEmail_);
  if (!admins.length) {
    throw new Error('尚未設定管理員（請在 Apps Script「專案設定」→「指令碼屬性」檢查 ADMIN_EMAILS 或 ADMIN_SECRET_TOKEN）。');
  }
  if (!admins.includes(email)) {
    throw new Error('你沒有管理員權限（此 Google 帳號與 ADMIN_EMAILS 不符）。');
  }
}

/** 提供公開 API 供前端透過金鑰登入並獲取 Session */
function adminLoginWithToken(token) {
  if (verifyAdminSecretToken_(token)) {
    setAdminUserSession_();
    return { ok: true };
  }
  throw new Error('管理員金鑰錯誤。');
}

