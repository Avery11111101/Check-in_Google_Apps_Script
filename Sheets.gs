const SHEETS = {
  CONFIG: 'Attendance_Config',
  EVENTS: 'Events',
  GROUPS: 'Groups',
  ROSTER: 'Roster',
  LOGS: 'Logs',
  STATUS: 'StatusCache',
  ATTACH: 'DailyAttachments',
};

let _cachedDbSpreadsheet = null;
let _cachedConfigMap = null;

function clearConfigCache_() {
  _cachedConfigMap = null;
}

function loadAllConfigMap_() {
  if (_cachedConfigMap) return _cachedConfigMap;
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.CONFIG);
  if (!sh) return {};
  const values = sh.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < values.length; i++) {
    const k = String(values[i][0] || '');
    if (k) map[k] = values[i][1];
  }
  _cachedConfigMap = map;
  return _cachedConfigMap;
}

function getDb_() {
  if (_cachedDbSpreadsheet) return _cachedDbSpreadsheet;
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SPREADSHEET_ID');
  if (!id) {
    ensureInitialized_();
    id = props.getProperty('SPREADSHEET_ID');
    if (!id) throw new Error('無法建立或開啟資料試算表。');
    _cachedDbSpreadsheet = SpreadsheetApp.openById(id);
    return _cachedDbSpreadsheet;
  }
  try {
    _cachedDbSpreadsheet = SpreadsheetApp.openById(id);
    return _cachedDbSpreadsheet;
  } catch (_e) {
    props.deleteProperty('SPREADSHEET_ID');
    ensureInitialized_();
    id = props.getProperty('SPREADSHEET_ID');
    if (!id) throw new Error('試算表已不存在或無權限，且自動重建失敗。');
    _cachedDbSpreadsheet = SpreadsheetApp.openById(id);
    return _cachedDbSpreadsheet;
  }
}

function initSheets_(ss) {
  ensureSheet_(ss, SHEETS.CONFIG, ['key', 'value']);
  ensureSheet_(ss, SHEETS.EVENTS, ['eventId', 'name', 'startAt', 'endAt', 'isOpen', 'driveFolderId', 'driveFolderUrl', 'createdAt', 'requirePassword', 'allowChangePassword']);
  ensureSheet_(ss, SHEETS.GROUPS, ['groupId', 'eventId', 'category', 'groupName', 'sort']);
  ensureSheet_(ss, SHEETS.ROSTER, ['personId', 'eventId', 'groupId', 'displayName', 'font', 'enabled', 'sort', 'passwordHash']);
  ensureSheet_(ss, SHEETS.LOGS, ['logId', 'eventId', 'personId', 'action', 'serverTime', 'font', 'clientMeta']);
  ensureSheet_(ss, SHEETS.STATUS, ['eventId', 'personId', 'status', 'lastTime']);
  ensureSheet_(ss, SHEETS.ATTACH, ['eventId', 'date', 'title', 'driveFileId', 'driveUrl', 'memo', 'createdAt']);
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const lastRow = sh.getLastRow();
  if (lastRow === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    return sh;
  }
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const mismatch = headers.some((h, i) => existing[i] !== h) || existing.length < headers.length;
  if (mismatch) {
    // 僅安全更新表頭列，絕不抹除資料列 (移除 sh.clear())
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function hashPassword_(password, salt) {
  const pwd = String(password || '').trim();
  if (!pwd) return '';
  const text = (salt ? String(salt) : '') + pwd;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return digest.map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

function upsertConfig_(key, value) {
  const k = String(key || '');
  if (!k) return;
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.CONFIG);
  const values = sh.getDataRange().getValues();
  for (let r = 2; r <= values.length; r++) {
    if (String(values[r - 1][0]) === k) {
      sh.getRange(r, 2).setValue(value);
      if (_cachedConfigMap) _cachedConfigMap[k] = value;
      return;
    }
  }
  sh.appendRow([k, value]);
  if (_cachedConfigMap) _cachedConfigMap[k] = value;
}

function getConfig_(key, fallback) {
  const k = String(key || '');
  if (!k) return fallback;
  const map = loadAllConfigMap_();
  if (Object.prototype.hasOwnProperty.call(map, k)) {
    return map[k] !== undefined && map[k] !== '' ? map[k] : fallback;
  }
  return fallback;
}

function deleteConfig_(key) {
  const k = String(key || '');
  if (!k) return false;
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.CONFIG);
  const values = sh.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === k) {
      sh.deleteRow(i + 1);
      if (_cachedConfigMap) delete _cachedConfigMap[k];
      return true;
    }
  }
  return false;
}

function newId_(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}


