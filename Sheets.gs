const SHEETS = {
  CONFIG: 'Attendance_Config',
  EVENTS: 'Events',
  GROUPS: 'Groups',
  ROSTER: 'Roster',
  LOGS: 'Logs',
  STATUS: 'StatusCache',
  ATTACH: 'DailyAttachments',
};

function getDb_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('尚未初始化 SPREADSHEET_ID。請先開啟任一頁面完成初始化。');
  return SpreadsheetApp.openById(id);
}

function initSheets_(ss) {
  ensureSheet_(ss, SHEETS.CONFIG, ['key', 'value']);
  ensureSheet_(ss, SHEETS.EVENTS, ['eventId', 'name', 'startAt', 'endAt', 'isOpen', 'driveFolderId', 'driveFolderUrl', 'createdAt']);
  ensureSheet_(ss, SHEETS.GROUPS, ['groupId', 'eventId', 'category', 'groupName', 'sort']);
  ensureSheet_(ss, SHEETS.ROSTER, ['personId', 'eventId', 'groupId', 'displayName', 'font', 'enabled', 'sort']);
  ensureSheet_(ss, SHEETS.LOGS, ['logId', 'eventId', 'personId', 'action', 'serverTime', 'font', 'clientMeta']);
  ensureSheet_(ss, SHEETS.STATUS, ['eventId', 'personId', 'status', 'lastTime']);
  ensureSheet_(ss, SHEETS.ATTACH, ['eventId', 'date', 'title', 'driveFileId', 'driveUrl', 'memo', 'createdAt']);
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const range = sh.getRange(1, 1, 1, headers.length);
  const existing = range.getValues()[0].map(String);
  const mismatch = existing.length !== headers.length || headers.some((h, i) => existing[i] !== h);
  if (mismatch) {
    sh.clear();
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function upsertConfig_(key, value) {
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.CONFIG);
  const values = sh.getDataRange().getValues();
  for (let r = 2; r <= values.length; r++) {
    if (String(values[r - 1][0]) === key) {
      sh.getRange(r, 2).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value]);
}

function getConfig_(key, fallback) {
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.CONFIG);
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === key) return values[i][1];
  }
  return fallback;
}

function newId_(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

