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

function getBootstrap_(ctx) {
  const env = ensureInitialized_();
  return {
    version: APP.VERSION,
    page: ctx.page,
    eventId: ctx.eventId,
    webAppUrl: ScriptApp.getService().getUrl(),
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

