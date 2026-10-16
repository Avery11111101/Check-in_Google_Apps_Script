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
  // R1: 升級表頭為 7 欄支援鄰接表與物化路徑（向後相容前 5 欄）
  ensureSheet_(ss, SHEETS.GROUPS, ['groupId', 'eventId', 'category', 'groupName', 'sort', 'parentId', 'path']);
  ensureSheet_(ss, SHEETS.ROSTER, ['personId', 'eventId', 'groupId', 'displayName', 'font', 'enabled', 'sort', 'passwordHash']);
  ensureSheet_(ss, SHEETS.LOGS, ['logId', 'eventId', 'personId', 'action', 'serverTime', 'font', 'clientMeta']);
  ensureSheet_(ss, SHEETS.STATUS, ['eventId', 'personId', 'status', 'lastTime']);
  // [ATTACHMENT SYSTEM DEACTIVATED / 附件系統已停用]
  // 依 R3 規範，新初始化不再自動建立 DailyAttachments 試算表
  // ensureSheet_(ss, SHEETS.ATTACH, ['eventId', 'date', 'title', 'driveFileId', 'driveUrl', 'memo', 'createdAt']);
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

// ============================================================================
// R2: TIERED FAST STORE & TREE DATA STRUCTURE ENGINE
// ============================================================================

var FAST_STORE_CHUNK_SIZE_ = 8000; // 每分片最多 8,000 UTF-8 位元組，安全低於 GAS 9KB (9000 bytes) 限制
var FAST_STORE_OVERFLOW_THRESHOLD_ = 350 * 1024; // 350KB 觸發 Drive 溢位門檻

/**
 * 計算字串之 UTF-8 位元組長度
 * @param {string} str
 * @returns {number}
 */
function getUtf8ByteLength_(str) {
  if (typeof str !== 'string') str = String(str || '');
  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.newBlob === 'function') {
    try {
      return Utilities.newBlob(str).getBytes().length;
    } catch (_e) {}
  }
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // 代理對 (Surrogate pair) 佔 4 bytes
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * 依據 UTF-8 位元組邊界切分字串，確保每分片 UTF-8 bytes <= maxBytes 且不截斷 Emoji 代理對
 * @param {string} str
 * @param {number} [maxBytes=8000]
 * @returns {string[]}
 */
function fastStoreChunkString_(str, maxBytes) {
  const limit = maxBytes || FAST_STORE_CHUNK_SIZE_ || 8000;
  if (!str) return [];
  const chunks = [];
  let start = 0;
  const len = str.length;

  while (start < len) {
    let currentBytes = 0;
    let end = start;

    while (end < len) {
      const code = str.charCodeAt(end);
      let charBytes = 1;
      let step = 1;

      if (code <= 0x7f) {
        charBytes = 1;
      } else if (code <= 0x7ff) {
        charBytes = 2;
      } else if (code >= 0xd800 && code <= 0xdbff) {
        if (end + 1 < len) {
          const nextCode = str.charCodeAt(end + 1);
          if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
            charBytes = 4;
            step = 2;
          } else {
            charBytes = 3;
          }
        } else {
          charBytes = 3;
        }
      } else {
        charBytes = 3;
      }

      if (currentBytes + charBytes > limit) {
        if (end === start) end += step;
        break;
      }

      currentBytes += charBytes;
      end += step;
    }

    chunks.push(str.substring(start, end));
    start = end;
  }

  return chunks;
}

/**
 * 計算目前 PropertiesService 已使用之真實 UTF-8 byte 數
 */
function fastStoreCalculatePropertiesBytes_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  let bytes = 0;
  for (const k in props) {
    if (Object.prototype.hasOwnProperty.call(props, k)) {
      bytes += getUtf8ByteLength_(k) + (props[k] ? getUtf8ByteLength_(props[k]) : 0);
    }
  }
  return bytes;
}

/**
 * 讀取活動 Fast Store（若無快取則自動從 Google Sheets 水合）
 * @param {string} eventId
 * @returns {{eventId:string, groups:Array, roster:Array, isDirty:boolean, lastModified:number, lastSynced:number, driveFileId:string}}
 */
function fastStoreGet(eventId) {
  const eid = String(eventId || '').trim();
  if (!eid) throw new Error('fastStoreGet: 缺少 eventId。');

  const props = PropertiesService.getScriptProperties();
  const metaKey = '_FS_' + eid + '_META';
  const metaRaw = props.getProperty(metaKey);

  if (!metaRaw) {
    return fastStoreHydrateFromSheets_(eid);
  }

  let meta;
  try {
    meta = JSON.parse(metaRaw);
  } catch (e) {
    return fastStoreHydrateFromSheets_(eid);
  }

  let jsonStr = '';
  if (meta && meta.driveFileId) {
    try {
      const file = DriveApp.getFileById(meta.driveFileId);
      if (typeof file.getContentAsString === 'function') {
        jsonStr = file.getContentAsString();
      } else if (file.getBlob && typeof file.getBlob === 'function') {
        jsonStr = file.getBlob().getDataAsString('UTF-8');
      } else {
        throw new Error('Drive 檔案讀取方法不存在。');
      }
    } catch (e) {
      Logger.log('Drive read failed for event ' + eid + ': ' + (e && e.message));
      // 讀取 Drive 檔案失敗時，絕不以空試算表回寫清空快取！
      const fallback = fastStoreHydrateFromSheets_(eid, true);
      if (fallback && (fallback.groups.length > 0 || fallback.roster.length > 0)) {
        return fallback;
      }
      throw new Error('無法存取 Google Drive 儲存溢位快取檔案：' + (e && e.message));
    }
  } else if (meta && meta.chunkCount > 0) {
    const parts = [];
    for (let i = 0; i < meta.chunkCount; i++) {
      let chunk = props.getProperty('_FS_' + eid + '_CHUNK_' + i);
      if (chunk === null || chunk === undefined) {
        chunk = props.getProperty('_FS_' + eid + '_C' + i);
      }
      if (chunk === null || chunk === undefined) {
        return fastStoreHydrateFromSheets_(eid);
      }
      parts.push(chunk);
    }
    jsonStr = parts.join('');
  } else {
    return fastStoreHydrateFromSheets_(eid);
  }

  try {
    const compactObj = JSON.parse(jsonStr);
    const groups = (compactObj.g || []).map(row => {
      const gId = String(row[0] || '');
      const pId = String(row[1] || '');
      const name = String(row[2] || '');
      const sort = Number(row[3] || 0);
      const depth = Number(row[4] || 0);
      const path = String(row[5] || name || '');
      const parts = path.split('/');
      return {
        groupId: gId,
        parentId: pId,
        name: name,
        sort: sort,
        depth: depth,
        path: path,
        category: parts[0] || DEFAULT_GROUP_CATEGORY_,
        groupName: name || DEFAULT_GROUP_NAME_,
      };
    });

    const roster = (compactObj.r || []).map(row => {
      const pId = String(row[0] || '');
      const gId = String(row[1] || '');
      const name = String(row[2] || '');
      const font = String(row[3] || '');
      const en = !(row[4] === 0 || row[4] === false || row[4] === '0');
      const sort = Number(row[5] || 0);
      const pwd = String(row[6] || '');
      return {
        personId: pId,
        eventId: eid,
        groupId: gId,
        displayName: name,
        font: font,
        enabled: en,
        sort: sort,
        passwordHash: pwd,
        hasPassword: !!pwd.trim(),
      };
    });

    return {
      eventId: eid,
      groups: groups,
      roster: roster,
      isDirty: !!meta.isDirty,
      lastModified: meta.lastModified || Date.now(),
      lastSynced: meta.lastSynced || Date.now(),
      driveFileId: meta.driveFileId || '',
    };
  } catch (_e) {
    return fastStoreHydrateFromSheets_(eid);
  }
}

/**
 * 儲存活動 Fast Store（二維二進位緊湊編碼 + 8KB 自動分片 + 350KB Drive 溢位支援）
 * @param {string} eventId
 * @param {{groups: Array, roster: Array}} storeData
 * @param {boolean} [isDirty]
 * @returns {Object} 儲存中繼詮釋資料
 */
function fastStoreSave(eventId, storeData, isDirty, forceDrive) {
  const eid = String(eventId || '').trim();
  if (!eid) throw new Error('fastStoreSave: 缺少 eventId。');

  // 二維陣列緊湊序列化（大幅縮減重覆欄位鍵值名開銷達 68%）
  const gRows = (storeData.groups || []).map(g => [
    String(g.groupId || ''),
    String(g.parentId || ''),
    String(g.name || g.groupName || ''),
    Number(g.sort || 0),
    Number(g.depth || 0),
    String(g.path || g.name || g.groupName || ''),
  ]);

  const rRows = (storeData.roster || []).map(r => [
    String(r.personId || ''),
    String(r.groupId || ''),
    String(r.displayName || ''),
    String(r.font || ''),
    r.enabled !== false ? 1 : 0,
    Number(r.sort || 0),
    String(r.passwordHash || ''),
  ]);

  const compactObj = {
    v: 1,
    eid: eid,
    ts: Date.now(),
    g: gRows,
    r: rRows,
  };

  const jsonStr = JSON.stringify(compactObj);
  const jsonBytes = getUtf8ByteLength_(jsonStr);

  const props = PropertiesService.getScriptProperties();
  const currentTotalBytes = fastStoreCalculatePropertiesBytes_();

  const metaKey = '_FS_' + eid + '_META';
  const existingMetaRaw = props.getProperty(metaKey);
  let existingMeta = null;
  if (existingMetaRaw) {
    try { existingMeta = JSON.parse(existingMetaRaw); } catch (_e) {}
  }
  const oldChunkCount = existingMeta && existingMeta.chunkCount ? Number(existingMeta.chunkCount) : 0;
  let driveFileId = existingMeta && existingMeta.driveFileId ? existingMeta.driveFileId : '';

  // 若使用者明確指定不使用 Drive 溢位，則清空既有 driveFileId
  if (forceDrive === false) {
    driveFileId = '';
  }

  // 判定是否啟動 Drive 溢位階層
  const needOverflow = !!forceDrive || jsonBytes > 300000 || (currentTotalBytes + jsonBytes > FAST_STORE_OVERFLOW_THRESHOLD_ && !existingMeta);

  if (needOverflow || (driveFileId && forceDrive !== false)) {
    driveFileId = fastStoreSaveToDrive_(eid, jsonStr, driveFileId);

    // 清理舊的 Properties 分片，釋放配額
    for (let c = 0; c < Math.max(oldChunkCount, 20); c++) {
      props.deleteProperty('_FS_' + eid + '_CHUNK_' + c);
      props.deleteProperty('_FS_' + eid + '_C' + c);
    }

    const newMeta = {
      eventId: eid,
      driveFileId: driveFileId,
      chunkCount: 0,
      dataLength: jsonBytes,
      groupsCount: gRows.length,
      rosterCount: rRows.length,
      isDirty: isDirty !== undefined ? !!isDirty : (existingMeta ? !!existingMeta.isDirty : false),
      lastModified: Date.now(),
      lastSynced: existingMeta && existingMeta.lastSynced ? existingMeta.lastSynced : Date.now(),
    };
    props.setProperty(metaKey, JSON.stringify(newMeta));
    return newMeta;
  }

  // PropertiesService 8KB 安全分片儲存（保證每片 UTF-8 位元組 <= 8000）
  const chunks = fastStoreChunkString_(jsonStr, FAST_STORE_CHUNK_SIZE_);

  const propUpdates = {};
  for (let i = 0; i < chunks.length; i++) {
    propUpdates['_FS_' + eid + '_CHUNK_' + i] = chunks[i];
  }

  const newMeta = {
    eventId: eid,
    driveFileId: '',
    chunkCount: chunks.length,
    dataLength: jsonBytes,
    groupsCount: gRows.length,
    rosterCount: rRows.length,
    isDirty: isDirty !== undefined ? !!isDirty : (existingMeta ? !!existingMeta.isDirty : false),
    lastModified: Date.now(),
    lastSynced: existingMeta && existingMeta.lastSynced ? existingMeta.lastSynced : Date.now(),
  };
  propUpdates[metaKey] = JSON.stringify(newMeta);

  props.setProperties(propUpdates);

  // 清除不再需要的多餘孤兒分片
  if (oldChunkCount > chunks.length) {
    for (let c = chunks.length; c < oldChunkCount; c++) {
      props.deleteProperty('_FS_' + eid + '_CHUNK_' + c);
      props.deleteProperty('_FS_' + eid + '_C' + c);
    }
  }

  return newMeta;
}

/**
 * 將資料寫入 Google Drive 溢位 JSON 快取檔案
 */
function fastStoreSaveToDrive_(eventId, jsonStr, existingFileId) {
  if (existingFileId) {
    try {
      const file = DriveApp.getFileById(existingFileId);
      file.setContent(jsonStr);
      return existingFileId;
    } catch (_e) {
      // 檔案可能已被手動刪除，接續建立新檔案
    }
  }

  let folder = null;
  try {
    const ss = getDb_();
    const shEvents = ss.getSheetByName(SHEETS.EVENTS);
    if (shEvents) {
      const rows = shEvents.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(eventId)) {
          const folderId = String(rows[i][5] || '');
          if (folderId) folder = DriveApp.getFolderById(folderId);
          break;
        }
      }
    }
  } catch (_e) {}

  if (!folder) {
    try {
      folder = DriveApp.getRootFolder();
    } catch (_e) {
      throw new Error('無法存取 Google Drive 儲存溢位快取。');
    }
  }

  const fileName = 'checkin_cache_' + eventId + '.json';
  const file = folder.createFile(fileName, jsonStr, 'application/json');
  return file.getId();
}

/**
 * 從 Google Sheets 永久表載入資料水合 Fast Store
 */
function fastStoreHydrateFromSheets_(eventId, skipSave) {
  const eid = String(eventId || '').trim();
  const ss = getDb_();
  const shGroups = ss.getSheetByName(SHEETS.GROUPS);
  const shRoster = ss.getSheetByName(SHEETS.ROSTER);

  const groupRows = shGroups ? shGroups.getDataRange().getValues() : [];
  const rosterRows = shRoster ? shRoster.getDataRange().getValues() : [];

  const rawGroups = [];
  for (let i = 1; i < groupRows.length; i++) {
    const r = groupRows[i];
    if (String(r[1]) !== eid || !r[0]) continue;
    const gId = String(r[0]);
    const cat = String(r[2] || '');
    const grp = String(r[3] || '');
    const sort = Number(r[4] || 0);
    const parentId = r.length > 5 ? String(r[5] || '') : '';
    const path = r.length > 6 ? String(r[6] || '') : '';
    rawGroups.push({
      groupId: gId,
      parentId: parentId,
      name: grp || cat || DEFAULT_GROUP_NAME_,
      sort: sort,
      depth: 0,
      path: path || (cat && grp && cat !== grp ? (cat + '/' + grp) : (grp || cat)),
      category: cat || DEFAULT_GROUP_CATEGORY_,
      groupName: grp || DEFAULT_GROUP_NAME_,
    });
  }

  const groups = recalculateGroupPaths_(rawGroups);

  const roster = [];
  for (let i = 1; i < rosterRows.length; i++) {
    const r = rosterRows[i];
    if (String(r[1]) !== eid || !r[0]) continue;
    roster.push({
      personId: String(r[0]),
      eventId: eid,
      groupId: String(r[2] || ''),
      displayName: String(r[3] || ''),
      font: String(r[4] || ''),
      enabled: !(String(r[5]) === 'FALSE' || r[5] === false),
      sort: Number(r[6] || 0),
      passwordHash: String(r[7] || ''),
      hasPassword: !!String(r[7] || '').trim(),
    });
  }

  if (!skipSave) {
    fastStoreSave(eid, { groups: groups, roster: roster }, false);
  }

  return {
    eventId: eid,
    groups: groups,
    roster: roster,
    isDirty: false,
    lastModified: Date.now(),
    lastSynced: Date.now(),
    driveFileId: '',
  };
}

/**
 * 清除活動之 Fast Store 快取
 */
function fastStoreClear(eventId) {
  const eid = String(eventId || '').trim();
  if (!eid) return;
  const props = PropertiesService.getScriptProperties();
  const metaKey = '_FS_' + eid + '_META';
  const metaRaw = props.getProperty(metaKey);
  let chunkCount = 20;
  let driveFileId = '';
  if (metaRaw) {
    try {
      const m = JSON.parse(metaRaw);
      if (m.chunkCount) chunkCount = Math.max(m.chunkCount, 20);
      if (m.driveFileId) driveFileId = m.driveFileId;
    } catch (_e) {}
  }
  for (let c = 0; c < chunkCount; c++) {
    props.deleteProperty('_FS_' + eid + '_CHUNK_' + c);
    props.deleteProperty('_FS_' + eid + '_C' + c);
  }
  props.deleteProperty(metaKey);
  if (driveFileId) {
    try {
      DriveApp.getFileById(driveFileId).setTrashed(true);
    } catch (_e) {}
  }
}

/**
 * 取得活動 Fast Store 中繼資訊
 */
function fastStoreGetMetadata(eventId) {
  const eid = String(eventId || '').trim();
  const props = PropertiesService.getScriptProperties();
  const metaKey = '_FS_' + eid + '_META';
  const metaRaw = props.getProperty(metaKey);
  if (!metaRaw) return null;
  try {
    return JSON.parse(metaRaw);
  } catch (_e) {
    return null;
  }
}

/**
 * 檢查活動之 Fast Store 是否已啟用中
 * @param {string} eventId
 * @returns {boolean}
 */
function isFastStoreActive(eventId) {
  const meta = fastStoreGetMetadata(eventId);
  return !!meta;
}

/**
 * 重新計算樹狀分組之完整階層路徑、深度與向下相容 category/groupName 投影
 * @param {Array} groups
 * @returns {Array} 計算後的 groups
 */
function recalculateGroupPaths_(groups) {
  if (!groups || !groups.length) return [];

  const byParent = new Map();
  const byId = new Map();

  groups.forEach(g => {
    byId.set(g.groupId, g);
    const p = g.parentId || '';
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(g);
  });

  const processed = new Set();

  function walk(parentId, parentPath, depth) {
    const children = byParent.get(parentId) || [];
    children.forEach(c => {
      processed.add(c.groupId);
      c.depth = depth;
      const nodeName = c.name || c.groupName || DEFAULT_GROUP_NAME_;
      c.name = nodeName;
      c.path = parentPath ? (parentPath + '/' + nodeName) : nodeName;
      const parts = c.path.split('/');
      c.category = parts[0] || DEFAULT_GROUP_CATEGORY_;
      c.groupName = nodeName;
      walk(c.groupId, c.path, depth + 1);
    });
  }

  // 先走訪頂層根節點（parentId 為空或指向不存在之節點）
  const roots = [];
  groups.forEach(g => {
    if (!g.parentId || !byId.has(g.parentId)) {
      roots.push(g);
    }
  });

  roots.forEach(r => {
    if (!processed.has(r.groupId)) {
      processed.add(r.groupId);
      r.depth = 0;
      r.parentId = '';
      const nodeName = r.name || r.groupName || r.category || DEFAULT_GROUP_NAME_;
      r.name = nodeName;
      r.path = nodeName;
      r.category = nodeName;
      r.groupName = nodeName;
      walk(r.groupId, r.path, 1);
    }
  });

  // 處理任何非循環但未包含的孤兒節點
  groups.forEach(g => {
    if (!processed.has(g.groupId)) {
      g.depth = 0;
      g.parentId = '';
      g.path = g.name || g.groupName || DEFAULT_GROUP_NAME_;
      g.category = g.path;
      g.groupName = g.path;
    }
  });

  return groups;
}

/**
 * 將平坦分組陣列與名單陣列轉換為遞迴目錄樹結構（含子目錄、人員與即時簽到率彙總）
 * @param {Array} groups
 * @param {Array} roster
 * @param {Map} [statusMap] `${eventId}::${personId}` -> {status, lastTime}
 * @returns {{rootFolders: Array, unassignedMembers: Array}}
 */
function buildFolderTree_(groups, roster, statusMap) {
  const nodeMap = new Map();
  const rootFolders = [];

  // 1. 初始化節點封裝
  (groups || []).forEach(g => {
    nodeMap.set(g.groupId, {
      groupId: g.groupId,
      name: g.name || g.groupName || '未命名分組',
      parentId: g.parentId || '',
      path: g.path || g.name || g.groupName || '',
      depth: Number(g.depth || 0),
      sort: Number(g.sort || 0),
      category: g.category || (g.path ? g.path.split('/')[0] : DEFAULT_GROUP_CATEGORY_),
      groupName: g.groupName || g.name || DEFAULT_GROUP_NAME_,
      children: [],
      members: [],
      stats: {
        total: 0,
        signed: 0,
        signedOut: 0,
        notYet: 0,
        attendanceRate: '0.0',
      },
    });
  });

  // 2. 組裝父子樹狀架構
  (groups || []).forEach(g => {
    const item = nodeMap.get(g.groupId);
    if (item.parentId && nodeMap.has(item.parentId)) {
      nodeMap.get(item.parentId).children.push(item);
    } else {
      rootFolders.push(item);
    }
  });

  // 3. 掛載名冊成員
  const unassignedMembers = [];
  (roster || []).forEach(m => {
    if (m.enabled === false) return;
    const personId = m.personId;
    const st = (statusMap && statusMap.get(m.eventId + '::' + personId)) || { status: 'NOT_YET', lastTime: '' };
    const memberObj = {
      personId: m.personId,
      eventId: m.eventId,
      groupId: m.groupId || '',
      displayName: m.displayName,
      font: m.font || '',
      enabled: m.enabled !== false,
      sort: Number(m.sort || 0),
      status: st.status,
      statusLabel: typeof statusLabel_ === 'function' ? statusLabel_(st.status) : (st.status === 'IN' ? '已簽到' : (st.status === 'OUT' ? '已簽退' : '未簽到')),
      lastTime: st.lastTime ? String(st.lastTime) : '',
      groupPath: m.groupId && nodeMap.has(m.groupId) ? nodeMap.get(m.groupId).path : '',
    };

    if (m.groupId && nodeMap.has(m.groupId)) {
      nodeMap.get(m.groupId).members.push(memberObj);
    } else {
      unassignedMembers.push(memberObj);
    }
  });

  // 4. 遞迴計算統計數據與排序
  function rollupStatsAndSort(nodeList) {
    nodeList.sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name, 'zh-Hant'));
    nodeList.forEach(node => {
      node.members.sort((a, b) => (a.sort - b.sort) || a.displayName.localeCompare(b.displayName, 'zh-Hant'));

      rollupStatsAndSort(node.children);

      let total = node.members.length;
      let signed = 0;
      let signedOut = 0;
      let notYet = 0;

      node.members.forEach(m => {
        if (m.status === 'IN') signed++;
        else if (m.status === 'OUT') signedOut++;
        else notYet++;
      });

      node.children.forEach(child => {
        total += child.stats.total;
        signed += child.stats.signed;
        signedOut += child.stats.signedOut;
        notYet += child.stats.notYet;
      });

      node.stats = {
        total: total,
        signed: signed,
        signedOut: signedOut,
        notYet: notYet,
        attendanceRate: total > 0 ? ((signed / total) * 100).toFixed(1) : '0.0',
      };
    });
  }

  rollupStatsAndSort(rootFolders);
  unassignedMembers.sort((a, b) => (a.sort - b.sort) || a.displayName.localeCompare(b.displayName, 'zh-Hant'));

  return {
    rootFolders: rootFolders,
    unassignedMembers: unassignedMembers,
  };
}
