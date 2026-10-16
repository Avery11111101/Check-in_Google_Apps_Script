// tests/harness/vm-loader.js
// Loads Google Apps Script .gs files into a unified node:vm context with GAS mocks

const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createGasMocks } = require('./gas-mock.js');

const DEFAULT_LOAD_ORDER = [
  'Utils.gs',
  'Sheets.gs',
  'DriveNaming.gs',
  'Auth.gs',
  'PublicAccess.gs',
  'RosterService.gs',
  'AttendanceService.gs',
  'BoardService.gs',
  'AdminService.gs',
  'AttachmentService.gs',
  'Seed.gs',
  'Code.gs',
];

/**
 * Discovers and orders all .gs files in the project root
 */
function getGsFiles(projectRoot) {
  const allFiles = fs.readdirSync(projectRoot);
  const gsFiles = allFiles.filter(f => f.endsWith('.gs'));

  // Put known files in order first, followed by any new/additional .gs files
  const ordered = [];
  for (const f of DEFAULT_LOAD_ORDER) {
    if (gsFiles.includes(f)) {
      ordered.push(f);
    }
  }
  for (const f of gsFiles) {
    if (!ordered.includes(f)) {
      ordered.push(f);
    }
  }
  return ordered;
}

/**
 * Creates a fresh VM context with GAS mocks and loads all project .gs files
 */
function createFreshContext(options = {}) {
  const projectRoot = options.projectRoot || path.resolve(__dirname, '../..');
  const mocks = options.mocks || createGasMocks({
    basePath: projectRoot,
    adminEmail: options.adminEmail || 'admin@example.com',
    timeZone: options.timeZone || 'Asia/Taipei',
  });

  const sandbox = {
    // GAS Services
    Logger: mocks.Logger,
    PropertiesService: mocks.PropertiesService,
    SpreadsheetApp: mocks.SpreadsheetApp,
    DriveApp: mocks.DriveApp,
    Utilities: mocks.Utilities,
    LockService: mocks.LockService,
    CacheService: mocks.CacheService,
    Session: mocks.Session,
    HtmlService: mocks.HtmlService,

    // Standard JavaScript globals
    console,
    Date,
    Math,
    JSON,
    parseInt,
    parseFloat,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    TypeError,
    RangeError,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,

    // Custom globals if supplied
    ...(options.customGlobals || {}),
  };

  // Self-reference globalThis
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;

  const context = vm.createContext(sandbox);

  const filesToLoad = options.files || getGsFiles(projectRoot);
  const loadedFiles = [];

  for (const file of filesToLoad) {
    const fullPath = path.isAbsolute(file) ? file : path.join(projectRoot, file);
    if (fs.existsSync(fullPath)) {
      const code = fs.readFileSync(fullPath, 'utf8');
      vm.runInContext(code, context, {
        filename: path.basename(fullPath),
        displayErrors: true,
      });
      loadedFiles.push(path.basename(fullPath));
    }
  }

  // Expose eval helper and common top-level lexical constants onto context
  context.eval = (expr) => vm.runInContext(expr, context);
  try {
    context.SHEETS = vm.runInContext('typeof SHEETS !== "undefined" ? SHEETS : undefined', context);
    context.APP = vm.runInContext('typeof APP !== "undefined" ? APP : undefined', context);
  } catch (_e) {}

  return {
    context,
    mocks,
    loadedFiles,
    projectRoot,
  };
}

module.exports = {
  createFreshContext,
  getGsFiles,
  DEFAULT_LOAD_ORDER,
};
