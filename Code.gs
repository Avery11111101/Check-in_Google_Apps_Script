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
    requireAdmin_();
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

  if (!driveFolderId) {
    const folder = DriveApp.createFolder(driveRootFolderName_());
    driveFolderId = folder.getId();
    props.setProperty('DRIVE_FOLDER_ID', driveFolderId);
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

