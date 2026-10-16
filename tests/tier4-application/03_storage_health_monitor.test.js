// tests/tier4-application/03_storage_health_monitor.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFreshContext } = require('../harness/vm-loader.js');

describe('Tier 4: [Application] Storage Health Monitoring & Threshold Calculation', () => {
  let context, mocks;

  beforeEach(() => {
    const res = createFreshContext();
    context = res.context;
    mocks = res.mocks;

    context.ensureInitialized_();
    mocks.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', 'admin@example.com');
  });

  test('adminGetStorageHealth reports healthy status under normal usage', () => {
    const eventId = 'evt_health_normal';
    context.adminCreateGroup({ eventId, name: '企劃組', category: '企劃組' });
    context.adminCreateRoster({ eventId, groupId: 'grp_1', displayName: '成員1' });

    const health = context.adminGetStorageHealth(eventId);
    assert.ok(health && health.ok, 'Storage health should return ok: true');
    assert.strictEqual(typeof health.usedBytes, 'number', 'usedBytes must be a number');
    assert.strictEqual(typeof health.maxBytes, 'number', 'maxBytes must be a number');
    assert.strictEqual(typeof health.percent, 'number', 'percent must be a number');
    assert.strictEqual(health.status, 'HEALTHY', 'Status should be HEALTHY under low usage');
    assert.strictEqual(health.tier, 'properties', 'Tier should be properties under normal usage');
    assert.ok(health.percent >= 0 && health.percent <= 100, 'Percent should be within 0-100');
  });

  test('adminGetStorageHealth reflects WARNING and CRITICAL thresholds accurately', () => {
    const props = mocks.PropertiesService.getScriptProperties();

    // Simulate usage > 307200 bytes (WARNING threshold)
    // Create properties to fill ~320KB
    props._setEnforceQuota(false); // Temporarily allow mock to hold bytes for calculation test
    props.setProperty('FILLER_WARNING', 'X'.repeat(320000));

    let health = context.adminGetStorageHealth('evt_test_warn');
    assert.strictEqual(health.status, 'WARNING', 'Status should be WARNING when usage > 300KB');

    // Simulate usage > 409600 bytes (CRITICAL threshold)
    props.setProperty('FILLER_CRITICAL', 'X'.repeat(420000));
    health = context.adminGetStorageHealth('evt_test_crit');
    assert.strictEqual(health.status, 'CRITICAL', 'Status should be CRITICAL when usage > 400KB');

    // Reset filler
    props.deleteProperty('FILLER_WARNING');
    props.deleteProperty('FILLER_CRITICAL');
  });

  test('adminGetStorageHealth detects Drive overflow tier', () => {
    const eventId = 'evt_drive_tier';
    const props = mocks.PropertiesService.getScriptProperties();

    // Mock metadata showing Drive overflow is active
    props.setProperty(`_FS_${eventId}_META`, JSON.stringify({
      driveFileId: 'fil_overflow_test_id',
      isDirty: false,
      lastSynced: Date.now(),
      groupsCount: 10,
      rosterCount: 500,
    }));

    const health = context.adminGetStorageHealth(eventId);
    assert.strictEqual(health.tier, 'drive', 'Tier should be "drive" when driveFileId exists in metadata');
    assert.strictEqual(health.isDriveOverflowActive, true, 'isDriveOverflowActive should be true');
    assert.strictEqual(health.itemCounts.roster, 500, 'Item count should report 500 members');
  });
});
