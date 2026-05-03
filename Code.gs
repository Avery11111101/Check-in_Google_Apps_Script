const APP = {
  VERSION: '0.1.0',
  PAGES: {
    CHECKIN: 'checkin',
    ADMIN: 'admin',
    BOARD: 'board',
  },
};

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) ? String(e.parameter.page) : APP.PAGES.CHECKIN;
  const eventId = (e && e.parameter && e.parameter.eventId) ? String(e.parameter.eventId) : '';

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
        : '<p style="margin-top:12px;color:#555;font-size:14px">請確認已登入正確的 Google 帳號，且該 email 已由管理員加入「共同管理員」白名單（指令碼屬性 <code>ADMIN_EMAILS</code>）。</p>';
      const body =
        '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<style>body{font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.55}' +
        '.box{border:1px solid #dadce0;border-radius:12px;padding:20px;background:#fafafa}</style></head><body>' +
        '<div class="box"><h1 style="font-size:1.25rem;margin:0 0 10px">無法開啟管理頁</h1><p>' +
        esc(msg) +
        '</p>' +
        loginBlock +
        hint +
        '</div></body></html>';
      return HtmlService.createHtmlOutput(body)
        .setTitle('簽到系統｜管理')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    const t = HtmlService.createTemplateFromFile('Admin');
    t.bootstrap = getBootstrap_({ page, eventId });
    return t.evaluate().setTitle('簽到系統｜管理').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (page === APP.PAGES.BOARD) {
    const t = HtmlService.createTemplateFromFile('Board');
    t.bootstrap = getBootstrap_({ page, eventId });
    return t.evaluate().setTitle('簽到系統｜看板').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  const t = HtmlService.createTemplateFromFile('Checkin');
  t.bootstrap = getBootstrap_({ page: APP.PAGES.CHECKIN, eventId });
  return t.evaluate().setTitle('簽到系統｜簽到').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
  return {
    version: APP.VERSION,
    page: ctx.page,
    eventId: ctx.eventId,
    webAppUrl: getWebAppUrl_(),
    spreadsheetId: env.spreadsheetId,
    driveFolderId: env.driveFolderId,
    tz: Session.getScriptTimeZone(),
    userEmail: safeGetUserEmail_(),
  };
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

  initSheets_(SpreadsheetApp.openById(spreadsheetId));
  initConfigDefaults_();

  return { spreadsheetId, driveFolderId };
}

function initConfigDefaults_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('POLL_SECONDS')) props.setProperty('POLL_SECONDS', '3');
  if (!props.getProperty('ADMIN_EMAILS')) props.setProperty('ADMIN_EMAILS', safeGetUserEmail_() || '');
}

function safeGetUserEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

