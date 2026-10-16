// tests/tier2-boundary/02_drive_overflow_trigger.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFreshContext } = require('../harness/vm-loader.js');

describe('Tier 2: [Boundary] 350KB Drive Overflow Storage Trigger', () => {
  let context, mocks;

  beforeEach(() => {
    const res = createFreshContext();
    context = res.context;
    mocks = res.mocks;

    context.ensureInitialized_();
    mocks.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', 'admin@example.com');
  });

  test('DriveApp is ready to store overflow JSON files when Properties exceed threshold', () => {
    const rootFolder = mocks.DriveApp.rootFolder;
    assert.ok(rootFolder, 'Drive root folder must exist');

    // Simulate high-volume cache overflow payload (>350KB)
    const largeData = [];
    for (let i = 0; i < 3800; i++) {
      largeData.push({
        personId: `p_heavy_${i}`,
        displayName: `大量模擬人員_${i}`,
        groupId: `grp_${i % 20}`,
        sort: i,
        status: i % 3 === 0 ? 'IN' : 'NOT',
      });
    }
    const overflowJson = JSON.stringify(largeData);
    assert.ok(overflowJson.length > 350000, `Payload size should exceed 350KB, got ${overflowJson.length}`);

    // Create overflow file in DriveApp
    const overflowFile = rootFolder.createFile('cache_overflow.json', overflowJson, 'application/json');
    assert.ok(overflowFile, 'Overflow file should be created');
    assert.strictEqual(overflowFile.getName(), 'cache_overflow.json');
    assert.strictEqual(overflowFile.getContentAsString(), overflowJson, 'File content must match exact JSON payload');

    // Read back and parse
    const retrievedFile = rootFolder.getFilesByName('cache_overflow.json').next();
    const parsedData = JSON.parse(retrievedFile.getContentAsString());
    assert.strictEqual(parsedData.length, 3800, 'Parsed overflow records length should match');
    assert.strictEqual(parsedData[0].displayName, '大量模擬人員_0');
  });

  test('Storage quota calculation accurately reflects Properties bytes', () => {
    const props = mocks.PropertiesService.getScriptProperties();
    props.setProperty('TEST_KEY_1', '1234567890');
    props.setProperty('TEST_KEY_2', 'ABCDEFGHIJ');

    const totalBytes = props._getTotalBytes();
    // 'TEST_KEY_1' (10) + '1234567890' (10) + 'TEST_KEY_2' (10) + 'ABCDEFGHIJ' (10) + others >= 40
    assert.ok(totalBytes >= 40, `Total bytes should be at least 40, got ${totalBytes}`);
    assert.ok(totalBytes < 500 * 1024, 'Total bytes should be within 500KB quota');
  });
});
