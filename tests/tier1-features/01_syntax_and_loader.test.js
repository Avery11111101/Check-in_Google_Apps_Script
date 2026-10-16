// tests/tier1-features/01_syntax_and_loader.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFreshContext, getGsFiles } = require('../harness/vm-loader.js');

describe('Tier 1: Syntax Integrity & VM Loader', () => {
  const projectRoot = path.resolve(__dirname, '../..');

  test('All .gs files must exist and be readable', () => {
    const files = getGsFiles(projectRoot);
    assert.ok(files.length >= 10, `Expected at least 10 .gs files, found ${files.length}`);
    for (const file of files) {
      const fullPath = path.join(projectRoot, file);
      assert.ok(fs.existsSync(fullPath), `File missing: ${file}`);
      const content = fs.readFileSync(fullPath, 'utf8');
      assert.ok(content.length > 0, `File is empty: ${file}`);
    }
  });

  test('All .gs files must compile and load into node:vm without syntax error', () => {
    const { context, loadedFiles, mocks } = createFreshContext({ projectRoot });
    assert.ok(loadedFiles.length >= 10, 'Expected loaded files in VM context');
    assert.strictEqual(typeof context.adminListEvents, 'function', 'adminListEvents should be a defined function');
    assert.strictEqual(typeof context.publicSubmitAttendance, 'function', 'publicSubmitAttendance should be a defined function');
    assert.strictEqual(typeof context.hashPassword_, 'function', 'hashPassword_ should be a defined function');
  });

  test('GAS mocks must be correctly bound in VM sandbox', () => {
    const { context, mocks } = createFreshContext({ projectRoot });
    assert.ok(context.PropertiesService, 'PropertiesService should be defined');
    assert.ok(context.SpreadsheetApp, 'SpreadsheetApp should be defined');
    assert.ok(context.DriveApp, 'DriveApp should be defined');
    assert.ok(context.Utilities, 'Utilities should be defined');
    assert.ok(context.Session, 'Session should be defined');
    assert.ok(context.LockService, 'LockService should be defined');
    assert.ok(context.CacheService, 'CacheService should be defined');
  });
});
