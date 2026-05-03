const APP = {
  VERSION: '0.2.6',
  PAGES: {
    CHECKIN: 'checkin',
    ADMIN: 'admin',
    BOARD: 'board',
  },
};

/**
 * 讀取 Web App GET 參數：少數情境下 e.parameter 未帶齊（例如內嵌載入），改由 e.parameters／e.queryString 補齊。
 * @param {GoogleAppsScript.Events.DoGet} e
 * @param {string} key
 * @returns {string}
 */
function getDoGetParamFirst_(e, key) {
  const k = String(key || '').trim();
  if (!k || !e) return '';
  try {
    if (e.parameter && e.parameter[k] != null && String(e.parameter[k]).trim() !== '') {
      return String(e.parameter[k]).trim();
    }
  } catch (_err) {}
  try {
    const arr = e.parameters && e.parameters[k];
    if (Array.isArray(arr) && arr.length) {
      const v = String(arr[0] != null ? arr[0] : '').trim();
      if (v) return v;
    }
  } catch (_err2) {}
  const qs = e.queryString != null ? String(e.queryString) : '';
  if (!qs) return '';
  try {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?:^|&)' + esc + '=([^&]*)');
    const m = qs.replace(/^\?/, '').match(re);
    if (!m || m.length < 2) return '';
    const raw = String(m[1] || '');
    try {
      return decodeURIComponent(raw.replace(/\+/g, ' ')).trim();
    } catch (_err3) {
      return raw.trim();
    }
  } catch (_err4) {
    return '';
  }
}

function doGet(e) {
  const pageRaw = getDoGetParamFirst_(e, 'page');
  const page = pageRaw ? String(pageRaw) : APP.PAGES.CHECKIN;
  const eventId = getDoGetParamFirst_(e, 'eventId');
  let checkinToken = getDoGetParamFirst_(e, 'checkinToken');
  if (!checkinToken) checkinToken = getDoGetParamFirst_(e, 'token');

  if (page === APP.PAGES.ADMIN) {
    try {
      requireAdmin_();
    } catch (authErr) {
      const msg = authErr && authErr.message ? String(authErr.message) : '無法驗證管理員身分。';
      const needLogin = msg.indexOf('需要登入 Google 帳號') !== -1;
      const continuePath = (function () {
        const base = getWebAppUrl_();
        if (!base) return '';
        return String(base).split(/[?#]/)[0].replace(/\/$/, '') + '?page=admin';
      })();
      const loginHref = continuePath
        ? 'https://accounts.google.com/signin?hl=zh-TW&continue=' + encodeURIComponent(continuePath)
        : 'https://accounts.google.com/signin?hl=zh-TW';
      const loginBlock = needLogin
        ? '<p style="margin-top:16px"><a href="' +
          esc(loginHref) +
          '" target="_top" rel="noopener noreferrer" style="display:inline-block;padding:10px 18px;background:#1a73e8;color:#fff;text-decoration:none;border-radius:8px;font-weight:650">由此登入 Google 帳號</a></p>' +
          '<p style="margin-top:10px;color:#666;font-size:14px">登入完成後請<strong>重新整理本頁</strong>，或再次開啟管理頁連結。</p>'
        : '';
      const hint = needLogin
        ? '<p style="margin-top:12px;color:#555;font-size:14px">若已登入仍看到此訊息，請改用與管理員相同的瀏覽器設定檔，或改用無痕視窗只登入一個帳號。</p>'
        : '<p style="margin-top:12px;color:#555;font-size:14px">請確認已登入與指令碼屬性 <code>ADMIN_EMAILS</code> 相符之 Google 帳號（<strong>不分大小寫</strong>；多筆以逗號分隔時，目前登入者須為其中一筆）。</p>';
      let activeForHint = '';
      let effectiveForHint = '';
      try {
        activeForHint = Session.getActiveUser().getEmail() || '';
      } catch (_e0) {}
      try {
        effectiveForHint = Session.getEffectiveUser().getEmail() || '';
      } catch (_e0b) {}
      const likelyWebAppRunAsDeployer = !String(activeForHint).trim() && !!String(effectiveForHint).trim();
      const deployModeHint = likelyWebAppRunAsDeployer
        ? '<div style="margin-top:14px;padding:14px;background:#fff8e1;border:1px solid #f0b429;border-radius:8px;color:#5c4a00;font-size:14px;line-height:1.6">' +
          '<strong>常見原因：</strong>Web App 為「<strong>以擁有者身分執行</strong>」時，為了讓訪客可不登入即簽到，伺服端通常<strong>讀不到</strong>您瀏覽器目前登入之 Google email。' +
          '<p style="margin:10px 0 0">請以<strong>建立此 Apps Script 專案的同一 Google 帳號</strong>登入後再開管理頁。若 <code>ADMIN_EMAILS</code> 曾手動改成其他 email，請改回可在此模式下取得 email 的帳號，或改為「使用者存取應用程式」部署（與匿名簽到較難並存於同一設定）。</p>' +
          '</div>'
        : '';
      const body =
        '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<style>body{font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.55}' +
        '.box{border:1px solid #dadce0;border-radius:12px;padding:20px;background:#fafafa}</style></head><body>' +
        '<div class="box"><h1 style="font-size:1.25rem;margin:0 0 10px">無法開啟管理頁</h1><p>' +
        esc(msg) +
        '</p>' +
        loginBlock +
        hint +
        deployModeHint +
        '</div>' +
        '</body></html>';
      return HtmlService.createHtmlOutput(body)
        .setTitle('簽到系統｜管理')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    const t = HtmlService.createTemplateFromFile('Admin');
    t.bootstrap = getBootstrap_({ page, eventId, checkinToken: '' });
    return t.evaluate().setTitle('簽到系統｜管理').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (page === APP.PAGES.BOARD) {
    const t = HtmlService.createTemplateFromFile('Board');
    t.bootstrap = getBootstrap_({ page, eventId, checkinToken });
    return t.evaluate().setTitle('簽到系統｜看板').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  let checkinForBootstrap = checkinToken;
  if (String(eventId || '').trim() && checkinToken) {
    checkinForBootstrap = resolveCheckinTokenForBootstrap_(eventId, checkinToken);
  }
  const t = HtmlService.createTemplateFromFile('Checkin');
  t.bootstrap = getBootstrap_({ page: APP.PAGES.CHECKIN, eventId, checkinToken: checkinForBootstrap });
  return t.evaluate().setTitle('簽到系統｜簽到').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 簽到頁載入：若網址 token 仍有效（含上一組／歷史組），改注入伺服端「目前」密鑰，避免稍舊 QR 或 iframe 內網址列與實際可用密鑰不同步。
 */
function resolveCheckinTokenForBootstrap_(eventId, urlToken) {
  const eid = String(eventId || '').trim();
  const got = String(urlToken || '').trim();
  if (!eid || !got) return got;
  try {
    assertPublicEventToken_(eid, got);
    const latest = String(getEventCheckinToken_(eid) || '').trim();
    return latest || got;
  } catch (_e) {
    return got;
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function esc(s) {
  const str = (s === null || s === undefined) ? '' : String(s);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Web App 的 /exec（或 /dev）根網址，供導覽與對外連結使用。
 * HtmlService iframe 內有時 ScriptApp.getService().getUrl() 為空，故快取在指令碼屬性 WEB_APP_URL。
 * 若仍為空，可於「專案設定 → 指令碼屬性」手動新增 WEB_APP_URL（完整 …/exec 前綴、不含查詢字串）。
 */
function getWebAppUrl_() {
  const props = PropertiesService.getScriptProperties();
  const cached = (props.getProperty('WEB_APP_URL') || '').trim();
  try {
    const u = ScriptApp.getService().getUrl();
    if (u) {
      const clean = String(u).split(/[?#]/)[0].replace(/\/$/, '');
      props.setProperty('WEB_APP_URL', clean);
      return clean;
    }
  } catch (e) {
    // 未部署為 Web App 等
  }
  return cached ? String(cached).split(/[?#]/)[0].replace(/\/$/, '') : '';
}

/** 供前端 google.script.run 取得 /exec 網址；iframe 內 document.referrer 可能被政策清空。 */
function getWebAppExecUrlForClient() {
  return getWebAppUrl_();
}

function getBootstrap_(ctx) {
  const env = ensureInitialized_();
  const base = {
    version: APP.VERSION,
    page: ctx.page,
    eventId: ctx.eventId,
    checkinToken: ctx.checkinToken != null ? String(ctx.checkinToken) : '',
    webAppUrl: getWebAppUrl_(),
    spreadsheetId: env.spreadsheetId,
    driveFolderId: env.driveFolderId,
    tz: Session.getScriptTimeZone(),
    userEmail: safeGetUserEmail_(),
  };
  if (ctx.page === APP.PAGES.BOARD) {
    base.boardTransitionDefault = getBoardTransitionDefault_();
  }
  return base;
}

/** Script Property BOARD_TRANSITION_DEFAULT：未設定時視為開啟。 */
function getBoardTransitionDefault_() {
  const raw = String(PropertiesService.getScriptProperties().getProperty('BOARD_TRANSITION_DEFAULT') || 'true')
    .trim()
    .toLowerCase();
  return raw !== 'false' && raw !== '0';
}

function ensureInitialized_() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheetId = props.getProperty('SPREADSHEET_ID');
  let driveFolderId = props.getProperty('DRIVE_FOLDER_ID');

  if (driveFolderId) {
    try {
      DriveApp.getFolderById(driveFolderId);
    } catch (_e) {
      driveFolderId = '';
      props.deleteProperty('DRIVE_FOLDER_ID');
    }
  }

  if (!driveFolderId) {
    const folder = DriveApp.createFolder(driveRootFolderName_());
    driveFolderId = folder.getId();
    props.setProperty('DRIVE_FOLDER_ID', driveFolderId);
  }

  if (spreadsheetId) {
    try {
      SpreadsheetApp.openById(spreadsheetId);
    } catch (_e) {
      spreadsheetId = '';
      props.deleteProperty('SPREADSHEET_ID');
    }
  }

  if (!spreadsheetId) {
    const ss = SpreadsheetApp.create('簽到系統資料_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss'));
    spreadsheetId = ss.getId();
    props.setProperty('SPREADSHEET_ID', spreadsheetId);
  }

  ensureSpreadsheetInDriveFolder_(spreadsheetId, driveFolderId);

  initSheets_(SpreadsheetApp.openById(spreadsheetId));
  initConfigDefaults_();

  return { spreadsheetId, driveFolderId };
}

function initConfigDefaults_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('POLL_SECONDS')) props.setProperty('POLL_SECONDS', '3');
  if (!props.getProperty('ADMIN_EMAILS')) {
    let initial = '';
    try {
      initial = safeGetUserEmail_() || '';
    } catch (_e) {}
    if (!String(initial).trim()) {
      try {
        initial = Session.getEffectiveUser().getEmail() || '';
      } catch (_e2) {}
    }
    props.setProperty('ADMIN_EMAILS', String(initial).trim());
  }
  if (!props.getProperty('BOARD_STATE_CACHE_TTL_SECONDS')) props.setProperty('BOARD_STATE_CACHE_TTL_SECONDS', '2');
  if (!props.getProperty('BOARD_TRANSITION_DEFAULT')) props.setProperty('BOARD_TRANSITION_DEFAULT', 'true');
}

function safeGetUserEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

