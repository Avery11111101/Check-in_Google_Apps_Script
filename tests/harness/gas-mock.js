// tests/harness/gas-mock.js
// Complete Zero-Dependency Google Apps Script Mock Suite

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// --- Logger Mock ---
class LoggerMock {
  constructor() {
    this.logs = [];
  }
  log(...args) {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    this.logs.push(msg);
  }
  clear() {
    this.logs = [];
  }
}

// --- PropertiesService Mock with Quota Verification ---
class PropertiesMock {
  constructor(name = 'ScriptProperties') {
    this.name = name;
    this.store = new Map();
    this.enforceQuotas = true;
    this.MAX_VALUE_BYTES = 9000; // GAS max 9KB per property
    this.MAX_TOTAL_BYTES = 500 * 1024; // GAS max 500KB total
  }

  _calculateTotalBytes() {
    let total = 0;
    for (const [k, v] of this.store.entries()) {
      total += Buffer.byteLength(k, 'utf8') + Buffer.byteLength(v, 'utf8');
    }
    return total;
  }

  getProperty(key) {
    const k = String(key || '');
    return this.store.has(k) ? this.store.get(k) : null;
  }

  setProperty(key, value) {
    const k = String(key || '');
    const v = String(value != null ? value : '');
    const valBytes = Buffer.byteLength(v, 'utf8');

    if (this.enforceQuotas && valBytes > this.MAX_VALUE_BYTES) {
      throw new Error(`QuotaExceededError: Property "${k}" length (${valBytes} bytes) exceeds 9KB limit (${this.MAX_VALUE_BYTES} bytes)`);
    }

    const currentTotal = this._calculateTotalBytes();
    const existingValBytes = this.store.has(k) ? Buffer.byteLength(this.store.get(k), 'utf8') : 0;
    const newTotal = currentTotal - existingValBytes + Buffer.byteLength(k, 'utf8') + valBytes;

    if (this.enforceQuotas && newTotal > this.MAX_TOTAL_BYTES) {
      throw new Error(`QuotaExceededError: PropertiesStore total size (${newTotal} bytes) exceeds 500KB limit (${this.MAX_TOTAL_BYTES} bytes)`);
    }

    this.store.set(k, v);
    return this;
  }

  getProperties() {
    const obj = {};
    for (const [k, v] of this.store.entries()) {
      obj[k] = v;
    }
    return obj;
  }

  setProperties(props, deleteAllOthers = false) {
    if (deleteAllOthers) {
      this.store.clear();
    }
    if (props && typeof props === 'object') {
      for (const [k, v] of Object.entries(props)) {
        this.setProperty(k, v);
      }
    }
    return this;
  }

  deleteProperty(key) {
    this.store.delete(String(key || ''));
    return this;
  }

  deleteAllProperties() {
    this.store.clear();
    return this;
  }

  getKeys() {
    return Array.from(this.store.keys());
  }

  _getTotalBytes() {
    return this._calculateTotalBytes();
  }

  _reset() {
    this.store.clear();
  }

  _setEnforceQuota(enforce) {
    this.enforceQuotas = !!enforce;
  }
}

class PropertiesServiceMock {
  constructor() {
    this.scriptProperties = new PropertiesMock('ScriptProperties');
    this.userProperties = new PropertiesMock('UserProperties');
    this.documentProperties = new PropertiesMock('DocumentProperties');
  }

  getScriptProperties() {
    return this.scriptProperties;
  }

  getUserProperties() {
    return this.userProperties;
  }

  getDocumentProperties() {
    return this.documentProperties;
  }

  _reset() {
    this.scriptProperties._reset();
    this.userProperties._reset();
    this.documentProperties._reset();
  }
}

// --- SpreadsheetApp Mock with 2D Grid & RPC Stats ---
class RangeMock {
  constructor(sheet, startRow, startCol, numRows = 1, numCols = 1) {
    this.sheet = sheet;
    this.startRow = startRow; // 1-indexed
    this.startCol = startCol; // 1-indexed
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getRow() { return this.startRow; }
  getColumn() { return this.startCol; }
  getLastRow() { return this.startRow + this.numRows - 1; }
  getLastColumn() { return this.startCol + this.numCols - 1; }
  getNumRows() { return this.numRows; }
  getNumColumns() { return this.numCols; }

  getValues() {
    this.sheet.spreadsheet.rpcStats.getValues++;
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowIdx = this.startRow - 1 + r;
      const rowArr = [];
      const srcRow = this.sheet.grid[rowIdx] || [];
      for (let c = 0; c < this.numCols; c++) {
        const colIdx = this.startCol - 1 + c;
        const val = srcRow[colIdx];
        rowArr.push(val !== undefined ? val : '');
      }
      out.push(rowArr);
    }
    return out;
  }

  setValues(values) {
    this.sheet.spreadsheet.rpcStats.setValues++;
    if (!Array.isArray(values)) throw new Error('setValues expects 2D array');
    for (let r = 0; r < values.length; r++) {
      const rowIdx = this.startRow - 1 + r;
      if (!this.sheet.grid[rowIdx]) this.sheet.grid[rowIdx] = [];
      const rowVals = values[r];
      for (let c = 0; c < rowVals.length; c++) {
        const colIdx = this.startCol - 1 + c;
        this.sheet.grid[rowIdx][colIdx] = rowVals[c];
      }
    }
    return this;
  }

  getValue() {
    const vals = this.getValues();
    return (vals[0] && vals[0][0] !== undefined) ? vals[0][0] : '';
  }

  setValue(val) {
    return this.setValues([[val]]);
  }

  clearContent() {
    this.sheet.spreadsheet.rpcStats.setValues++;
    for (let r = 0; r < this.numRows; r++) {
      const rowIdx = this.startRow - 1 + r;
      if (this.sheet.grid[rowIdx]) {
        for (let c = 0; c < this.numCols; c++) {
          const colIdx = this.startCol - 1 + c;
          this.sheet.grid[rowIdx][colIdx] = '';
        }
      }
    }
    return this;
  }

  clear() {
    return this.clearContent();
  }
}

class SheetMock {
  constructor(spreadsheet, name) {
    this.spreadsheet = spreadsheet;
    this.name = name;
    this.grid = []; // 0-indexed array of rows
    this.frozenRows = 0;
    this.columnWidths = {};
  }

  getName() { return this.name; }
  setName(name) { this.name = name; return this; }

  getLastRow() {
    for (let r = this.grid.length - 1; r >= 0; r--) {
      const row = this.grid[r];
      if (row && row.some(cell => cell !== '' && cell !== undefined && cell !== null)) {
        return r + 1;
      }
    }
    return 0;
  }

  getLastColumn() {
    let maxCol = 0;
    for (const row of this.grid) {
      if (row) {
        for (let c = row.length - 1; c >= 0; c--) {
          if (row[c] !== '' && row[c] !== undefined && row[c] !== null) {
            maxCol = Math.max(maxCol, c + 1);
            break;
          }
        }
      }
    }
    return maxCol;
  }

  getDataRange() {
    this.spreadsheet.rpcStats.getDataRange++;
    const numRows = Math.max(1, this.getLastRow());
    const numCols = Math.max(1, this.getLastColumn());
    return new RangeMock(this, 1, 1, numRows, numCols);
  }

  getRange(row, col, numRows = 1, numCols = 1) {
    this.spreadsheet.rpcStats.getRange++;
    return new RangeMock(this, row, col, numRows, numCols);
  }

  appendRow(rowArr) {
    this.spreadsheet.rpcStats.appendRow++;
    const nextRowIdx = this.getLastRow();
    this.grid[nextRowIdx] = [...rowArr];
    return this;
  }

  deleteRow(rowNumber) {
    this.spreadsheet.rpcStats.deleteRow++;
    const idx = rowNumber - 1;
    if (idx >= 0 && idx < this.grid.length) {
      this.grid.splice(idx, 1);
    }
    return this;
  }

  clear() {
    this.spreadsheet.rpcStats.clear++;
    this.grid = [];
    return this;
  }

  clearContents() {
    return this.clear();
  }

  setFrozenRows(n) {
    this.frozenRows = n;
    return this;
  }

  setColumnWidth(col, width) {
    this.columnWidths[col] = width;
    return this;
  }
}

class SpreadsheetMock {
  constructor(id, name, appMock) {
    this.id = id;
    this.name = name;
    this.appMock = appMock;
    this.sheets = [];
    this.rpcStats = {
      openById: 0,
      getSheetByName: 0,
      insertSheet: 0,
      getRange: 0,
      getDataRange: 0,
      getValues: 0,
      setValues: 0,
      appendRow: 0,
      deleteRow: 0,
      clear: 0,
    };
  }

  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return `https://docs.google.com/spreadsheets/d/${this.id}/edit`; }

  getSheets() {
    return this.sheets;
  }

  getSheetByName(name) {
    this.rpcStats.getSheetByName++;
    return this.sheets.find(s => s.getName() === name) || null;
  }

  insertSheet(name) {
    this.rpcStats.insertSheet++;
    const sheet = new SheetMock(this, name);
    this.sheets.push(sheet);
    return sheet;
  }

  deleteSheet(sheet) {
    const idx = this.sheets.indexOf(sheet);
    if (idx !== -1) {
      this.sheets.splice(idx, 1);
    }
  }

  _resetStats() {
    for (const key of Object.keys(this.rpcStats)) {
      this.rpcStats[key] = 0;
    }
  }
}

class SpreadsheetAppMock {
  constructor(driveAppMock = null) {
    this.driveAppMock = driveAppMock;
    this.spreadsheets = new Map();
    this.activeSpreadsheet = null;
    this.rpcStats = {
      openById: 0,
      create: 0,
      getSheetByName: 0,
      getRange: 0,
      getDataRange: 0,
      getValues: 0,
      setValues: 0,
      appendRow: 0,
      deleteRow: 0,
      clear: 0,
    };
  }

  openById(id) {
    this.rpcStats.openById++;
    const ss = this.spreadsheets.get(String(id));
    if (!ss) {
      throw new Error(`Spreadsheet not found for id: ${id}`);
    }
    // Link sheet stats to app stats via proxy or aggregation
    return ss;
  }

  create(name) {
    this.rpcStats.create++;
    const id = 'ss_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const ss = new SpreadsheetMock(id, name, this);
    ss.insertSheet('工作表1');
    this.spreadsheets.set(id, ss);
    this.activeSpreadsheet = ss;

    // Auto-create corresponding file in DriveApp if available
    if (this.driveAppMock) {
      this.driveAppMock._registerFile(id, name, 'application/vnd.google-apps.spreadsheet');
    }

    return ss;
  }

  getActiveSpreadsheet() {
    return this.activeSpreadsheet;
  }

  _resetStats() {
    for (const k of Object.keys(this.rpcStats)) {
      this.rpcStats[k] = 0;
    }
    for (const ss of this.spreadsheets.values()) {
      ss._resetStats();
    }
  }

  _reset() {
    this.spreadsheets.clear();
    this.activeSpreadsheet = null;
    this._resetStats();
  }
}

// --- DriveApp Mock with In-Memory Tree ---
class IteratorMock {
  constructor(items = []) {
    this.items = [...items];
    this.index = 0;
  }
  hasNext() {
    return this.index < this.items.length;
  }
  next() {
    if (!this.hasNext()) throw new Error('No more items in iterator');
    return this.items[this.index++];
  }
}

class FileMock {
  constructor(id, name, content = '', mimeType = 'text/plain', driveMock = null) {
    this.id = id;
    this.name = name;
    this.content = typeof content === 'string' ? content : (content && content.getDataAsString ? content.getDataAsString() : String(content));
    this.mimeType = mimeType;
    this.driveMock = driveMock;
    this.parents = [];
    this.trashed = false;
  }

  getId() { return this.id; }
  getName() { return this.name; }
  getContentAsString() { return this.content; }
  setContent(c) { this.content = String(c); return this; }
  getMimeType() { return this.mimeType; }
  getSize() { return Buffer.byteLength(this.content, 'utf8'); }
  getUrl() { return `https://drive.google.com/file/d/${this.id}/view`; }
  setTrashed(b) { this.trashed = !!b; return this; }
  getBlob() {
    return new BlobMock(this.content, this.mimeType, this.name);
  }

  getParents() {
    return new IteratorMock(this.parents);
  }

  moveTo(targetFolder) {
    // Remove from current parents
    for (const p of this.parents) {
      const idx = p.files.indexOf(this);
      if (idx !== -1) p.files.splice(idx, 1);
    }
    this.parents = [targetFolder];
    targetFolder.files.push(this);
    return this;
  }
}

class FolderMock {
  constructor(id, name, driveMock) {
    this.id = id;
    this.name = name;
    this.driveMock = driveMock;
    this.folders = [];
    this.files = [];
    this.parents = [];
  }

  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return `https://drive.google.com/drive/folders/${this.id}`; }

  createFolder(name) {
    const subFolder = this.driveMock.createFolder(name);
    this.folders.push(subFolder);
    subFolder.parents = [this];
    return subFolder;
  }

  createFile(nameOrBlob, content = '', mimeType = 'text/plain') {
    let name = nameOrBlob;
    let fileContent = content;
    let type = mimeType;

    if (nameOrBlob && typeof nameOrBlob === 'object' && typeof nameOrBlob.getName === 'function') {
      name = nameOrBlob.getName();
      fileContent = nameOrBlob.getDataAsString();
      type = nameOrBlob.getContentType();
    }

    const file = this.driveMock.createFile(name, fileContent, type);
    file.moveTo(this);
    return file;
  }

  getFilesByName(name) {
    const matched = this.files.filter(f => f.getName() === name && !f.trashed);
    return new IteratorMock(matched);
  }

  getFoldersByName(name) {
    const matched = this.folders.filter(f => f.getName() === name);
    return new IteratorMock(matched);
  }

  getFiles() {
    return new IteratorMock(this.files.filter(f => !f.trashed));
  }

  getFolders() {
    return new IteratorMock(this.folders);
  }
}

class DriveAppMock {
  constructor() {
    this.folders = new Map();
    this.files = new Map();
    this.rootFolder = new FolderMock('root_folder', 'My Drive', this);
    this.folders.set('root_folder', this.rootFolder);
  }

  getRootFolder() {
    return this.rootFolder;
  }

  getFolderById(id) {
    const folder = this.folders.get(String(id));
    if (!folder) throw new Error(`Folder not found with id: ${id}`);
    return folder;
  }

  getFileById(id) {
    const file = this.files.get(String(id));
    if (!file) throw new Error(`File not found with id: ${id}`);
    return file;
  }

  createFolder(name) {
    const id = 'fld_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const folder = new FolderMock(id, name, this);
    this.folders.set(id, folder);
    this.rootFolder.folders.push(folder);
    folder.parents = [this.rootFolder];
    return folder;
  }

  createFile(nameOrBlob, content = '', mimeType = 'text/plain') {
    let name = nameOrBlob;
    let fileContent = content;
    let type = mimeType;

    if (nameOrBlob && typeof nameOrBlob === 'object' && typeof nameOrBlob.getName === 'function') {
      name = nameOrBlob.getName();
      fileContent = nameOrBlob.getDataAsString ? nameOrBlob.getDataAsString() : '';
      type = nameOrBlob.getContentType ? nameOrBlob.getContentType() : 'application/octet-stream';
    }

    const id = 'fil_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const file = new FileMock(id, name, fileContent, type, this);
    this.files.set(id, file);
    this.rootFolder.files.push(file);
    file.parents = [this.rootFolder];
    return file;
  }

  getFilesByName(name) {
    const matched = Array.from(this.files.values()).filter(f => f.getName() === name && !f.trashed);
    return new IteratorMock(matched);
  }

  _registerFile(id, name, mimeType) {
    const file = new FileMock(id, name, '', mimeType, this);
    this.files.set(id, file);
    this.rootFolder.files.push(file);
    file.parents = [this.rootFolder];
    return file;
  }

  _reset() {
    this.folders.clear();
    this.files.clear();
    this.rootFolder = new FolderMock('root_folder', 'My Drive', this);
    this.folders.set('root_folder', this.rootFolder);
  }
}

// --- Utilities Mock ---
class BlobMock {
  constructor(data, contentType = 'application/octet-stream', name = 'blob') {
    this.name = name;
    this.contentType = contentType;
    if (Buffer.isBuffer(data)) {
      this.buffer = data;
    } else if (Array.isArray(data)) {
      this.buffer = Buffer.from(data.map(b => (b < 0 ? b + 256 : b)));
    } else {
      this.buffer = Buffer.from(String(data || ''), 'utf8');
    }
  }

  getName() { return this.name; }
  getContentType() { return this.contentType; }
  getDataAsString() { return this.buffer.toString('utf8'); }
  getBytes() {
    // Return signed byte array (-128 to 127) to mirror GAS Utilities
    const out = [];
    for (let i = 0; i < this.buffer.length; i++) {
      const u = this.buffer[i];
      out.push(u > 127 ? u - 256 : u);
    }
    return out;
  }
}

class UtilitiesMock {
  constructor() {
    this.DigestAlgorithm = {
      MD5: 'MD5',
      SHA_1: 'SHA_1',
      SHA_256: 'SHA_256',
      SHA_384: 'SHA_384',
      SHA_512: 'SHA_512',
    };
    this.Charset = {
      UTF_8: 'UTF_8',
    };
  }

  computeDigest(algorithm, value, charset = 'UTF_8') {
    const algMap = {
      MD5: 'md5',
      SHA_1: 'sha1',
      SHA_256: 'sha256',
      SHA_384: 'sha384',
      SHA_512: 'sha512',
    };
    const alg = algMap[algorithm] || 'sha256';
    const hash = crypto.createHash(alg);

    if (Array.isArray(value)) {
      hash.update(Buffer.from(value.map(b => (b < 0 ? b + 256 : b))));
    } else {
      hash.update(String(value || ''), 'utf8');
    }

    const buf = hash.digest();
    const signedBytes = [];
    for (let i = 0; i < buf.length; i++) {
      const u = buf[i];
      signedBytes.push(u > 127 ? u - 256 : u);
    }
    return signedBytes;
  }

  getUuid() {
    return crypto.randomUUID();
  }

  formatDate(date, timeZone, formatStr) {
    const d = date instanceof Date ? date : new Date(date);
    const pad = (n, len = 2) => String(n).padStart(len, '0');

    // Interpret common GAS formats
    const yyyy = d.getFullYear();
    const MM = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const HH = pad(d.getHours());
    const mm = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    const SSS = pad(d.getMilliseconds(), 3);

    return formatStr
      .replace('yyyy', yyyy)
      .replace('MM', MM)
      .replace('dd', dd)
      .replace('HH', HH)
      .replace('mm', mm)
      .replace('ss', ss)
      .replace('SSS', SSS);
  }

  base64Encode(data) {
    if (Array.isArray(data)) {
      const buf = Buffer.from(data.map(b => (b < 0 ? b + 256 : b)));
      return buf.toString('base64');
    }
    return Buffer.from(String(data || ''), 'utf8').toString('base64');
  }

  base64Decode(str) {
    const buf = Buffer.from(String(str || ''), 'base64');
    const out = [];
    for (let i = 0; i < buf.length; i++) {
      const u = buf[i];
      out.push(u > 127 ? u - 256 : u);
    }
    return out;
  }

  newBlob(data, contentType, name) {
    return new BlobMock(data, contentType, name);
  }

  sleep(ms) {
    // Non-blocking in test runner
  }
}

// --- LockService Mock ---
class LockMock {
  constructor() {
    this.locked = false;
  }
  waitLock(timeoutMs) {
    this.locked = true;
    return true;
  }
  tryLock(timeoutMs) {
    this.locked = true;
    return true;
  }
  releaseLock() {
    this.locked = false;
  }
  hasLock() {
    return this.locked;
  }
}

class LockServiceMock {
  constructor() {
    this.scriptLock = new LockMock();
    this.userLock = new LockMock();
    this.documentLock = new LockMock();
  }
  getScriptLock() { return this.scriptLock; }
  getUserLock() { return this.userLock; }
  getDocumentLock() { return this.documentLock; }
}

// --- CacheService Mock ---
class CacheMock {
  constructor() {
    this.store = new Map();
  }
  get(key) {
    const entry = this.store.get(String(key));
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.store.delete(String(key));
      return null;
    }
    return entry.value;
  }
  put(key, value, ttlSeconds = 600) {
    this.store.set(String(key), {
      value: String(value),
      expiry: Date.now() + (ttlSeconds * 1000),
    });
  }
  remove(key) {
    this.store.delete(String(key));
  }
}

class CacheServiceMock {
  constructor() {
    this.scriptCache = new CacheMock();
    this.userCache = new CacheMock();
    this.documentCache = new CacheMock();
  }
  getScriptCache() { return this.scriptCache; }
  getUserCache() { return this.userCache; }
  getDocumentCache() { return this.documentCache; }
}

// --- Session Mock ---
class UserMock {
  constructor(email = 'admin@example.com') {
    this.email = email;
  }
  getEmail() {
    return this.email;
  }
}

class SessionMock {
  constructor(email = 'admin@example.com', tz = 'Asia/Taipei') {
    this.user = new UserMock(email);
    this.timeZone = tz;
  }
  getActiveUser() { return this.user; }
  getEffectiveUser() { return this.user; }
  getScriptTimeZone() { return this.timeZone; }
}

// --- HtmlService Mock ---
class HtmlOutputMock {
  constructor(content = '') {
    this.content = content;
    this.title = '';
    this.meta = {};
  }
  getContent() { return this.content; }
  setContent(c) { this.content = c; return this; }
  setTitle(t) { this.title = t; return this; }
  getTitle() { return this.title; }
  addMetaTag(k, v) { this.meta[k] = v; return this; }
  setXFrameOptionsMode() { return this; }
}

class HtmlTemplateMock {
  constructor(rawHtml, basePath = process.cwd()) {
    this.rawHtml = rawHtml;
    this.basePath = basePath;
  }
  evaluate() {
    // Process GAS scriptlets like <?!= include('filename') ?> and <?= variable ?>
    let processed = this.rawHtml.replace(/<\?!=\s*include\(['"]([^'"]+)['"]\)\s*\?>/g, (match, filename) => {
      const candidates = [
        path.join(this.basePath, `${filename}.html`),
        path.join(this.basePath, filename),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          return fs.readFileSync(p, 'utf8');
        }
      }
      return `<!-- Missing include: ${filename} -->`;
    });

    for (const [k, v] of Object.entries(this)) {
      if (k !== 'rawHtml' && k !== 'basePath' && typeof v !== 'function') {
        const regex = new RegExp(`<\?=\\s*${k}\\s*\?>`, 'g');
        processed = processed.replace(regex, String(v));
      }
    }

    return new HtmlOutputMock(processed);
  }
}

class HtmlServiceMock {
  constructor(basePath = process.cwd()) {
    this.basePath = basePath;
    this.XFrameOptionsMode = { ALLOWALL: 'ALLOWALL' };
  }
  createHtmlOutput(content = '') {
    return new HtmlOutputMock(content);
  }
  createHtmlOutputFromFile(filename) {
    const fullPath = filename.endsWith('.html') ? path.join(this.basePath, filename) : path.join(this.basePath, `${filename}.html`);
    const content = fs.readFileSync(fullPath, 'utf8');
    return new HtmlOutputMock(content);
  }
  createTemplate(rawHtml) {
    return new HtmlTemplateMock(rawHtml, this.basePath);
  }
  createTemplateFromFile(filename) {
    const fullPath = filename.endsWith('.html') ? path.join(this.basePath, filename) : path.join(this.basePath, `${filename}.html`);
    const content = fs.readFileSync(fullPath, 'utf8');
    return new HtmlTemplateMock(content, this.basePath);
  }
}

// Master factory
function createGasMocks(options = {}) {
  const logger = new LoggerMock();
  const propertiesService = new PropertiesServiceMock();
  const driveApp = new DriveAppMock();
  const spreadsheetApp = new SpreadsheetAppMock(driveApp);
  const utilities = new UtilitiesMock();
  const lockService = new LockServiceMock();
  const cacheService = new CacheServiceMock();
  const session = new SessionMock(options.adminEmail || 'admin@example.com', options.timeZone || 'Asia/Taipei');
  const htmlService = new HtmlServiceMock(options.basePath || process.cwd());

  return {
    Logger: logger,
    PropertiesService: propertiesService,
    SpreadsheetApp: spreadsheetApp,
    DriveApp: driveApp,
    Utilities: utilities,
    LockService: lockService,
    CacheService: cacheService,
    Session: session,
    HtmlService: htmlService,
  };
}

module.exports = {
  createGasMocks,
  LoggerMock,
  PropertiesServiceMock,
  PropertiesMock,
  SpreadsheetAppMock,
  SpreadsheetMock,
  SheetMock,
  RangeMock,
  DriveAppMock,
  FolderMock,
  FileMock,
  UtilitiesMock,
  BlobMock,
  LockServiceMock,
  LockMock,
  CacheServiceMock,
  CacheMock,
  SessionMock,
  HtmlServiceMock,
  HtmlOutputMock,
  HtmlTemplateMock,
};
