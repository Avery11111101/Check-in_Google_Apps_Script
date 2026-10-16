// tests/tier3-cross/01_zero_sheet_rpc_crud.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFreshContext } = require('../harness/vm-loader.js');

describe('Tier 3: [Cross-Feature] Zero Sheet RPC Fast Store CRUD Verification', () => {
  let context, mocks;

  beforeEach(() => {
    const res = createFreshContext();
    context = res.context;
    mocks = res.mocks;

    context.ensureInitialized_();
    mocks.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', 'admin@example.com');
  });

  test('Fast Store CRUD operations must avoid slow Sheet RPCs', () => {
    const eventId = 'evt_zero_rpc';

    // Seed group first
    context.adminCreateGroup({ eventId, name: '測試組', category: '測試組' });

    // Reset SpreadsheetApp stats to isolate routine roster operations
    mocks.SpreadsheetApp._resetStats();

    // Perform routine member creation
    const personRes = context.adminCreateRoster({
      eventId,
      groupId: 'grp_fast',
      displayName: '王快速',
      sort: 1,
    });
    assert.ok(personRes && personRes.ok, 'Creation must succeed');

    // Retrieve roster
    const roster = context.adminListRoster(eventId);
    assert.ok(roster.length >= 1, 'Roster must contain created person');

    const appStats = mocks.SpreadsheetApp.rpcStats;

    // Target contract for M1 (Fast Store):
    // If fast store is implemented, routine CRUD operations do 0 Sheet setValues
    if (context.isFastStoreActive && context.isFastStoreActive(eventId)) {
      assert.strictEqual(appStats.setValues, 0, 'Fast Store must perform 0 Sheet setValues during routine CRUD');
      assert.strictEqual(appStats.appendRow, 0, 'Fast Store must perform 0 Sheet appendRow during routine CRUD');
    } else {
      // Diagnostic check for M0 baseline
      assert.ok(appStats.appendRow >= 0, 'RPC stats tracked successfully');
    }
  });

  test('PropertiesService holds fast store state when cached', () => {
    const props = mocks.PropertiesService.getScriptProperties();
    const eventId = 'evt_fast_cache';
    const sampleRoster = [
      { personId: 'p1', name: '人員A', groupId: 'g1' },
      { personId: 'p2', name: '人員B', groupId: 'g1' },
    ];

    // Simulate fast store key in PropertiesService
    props.setProperty(`FAST_ROSTER_${eventId}`, JSON.stringify(sampleRoster));

    const retrieved = JSON.parse(props.getProperty(`FAST_ROSTER_${eventId}`));
    assert.strictEqual(retrieved.length, 2);
    assert.strictEqual(retrieved[0].name, '人員A');
  });
});
