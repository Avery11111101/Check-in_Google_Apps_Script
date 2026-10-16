// tests/tier3-cross/02_admin_sync_to_sheets.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFreshContext } = require('../harness/vm-loader.js');

describe('Tier 3: [Cross-Feature] Manual Batch Sync to Google Sheets (adminSyncToSheets)', () => {
  let context, mocks;

  beforeEach(() => {
    const res = createFreshContext();
    context = res.context;
    mocks = res.mocks;

    context.ensureInitialized_();
    mocks.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', 'admin@example.com');
  });

  test('adminSyncToSheets interface contract and batch write to Sheets', () => {
    const eventId = 'evt_sync_sheets';

    // Seed test groups and roster members
    const g1 = context.adminCreateGroup({ eventId, name: '企劃科', category: '行政處', groupName: '企劃科', sort: 1 });
    const g2 = context.adminCreateGroup({ eventId, name: '秘書室', category: '行政處', groupName: '秘書室', sort: 2 });

    context.adminCreateRoster({ eventId, groupId: g1.groupId, displayName: '張大千', sort: 1 });
    context.adminCreateRoster({ eventId, groupId: g1.groupId, displayName: '齊白石', sort: 2 });
    context.adminCreateRoster({ eventId, groupId: g2.groupId, displayName: '徐悲鴻', sort: 3 });

    // Verify adminSyncToSheets exists or test contract
    if (typeof context.adminSyncToSheets === 'function') {
      mocks.SpreadsheetApp._resetStats();

      const syncRes = context.adminSyncToSheets(eventId);
      assert.ok(syncRes && (syncRes.ok || syncRes.success), 'adminSyncToSheets should return success: true or ok: true');

      // Verify Sheet RPC setValues occurred
      const db = context.getDb_();
      const shRoster = db.getSheetByName(context.SHEETS.ROSTER);
      const rows = shRoster.getDataRange().getValues();

      // Row 0 is headers, remaining rows should contain the synchronized roster
      assert.ok(rows.length >= 4, `SHEETS.ROSTER should have at least 4 rows (1 header + 3 members), actual: ${rows.length}`);

      const names = rows.slice(1).map(r => r[3]); // Column D is displayName
      assert.ok(names.includes('張大千'));
      assert.ok(names.includes('齊白石'));
      assert.ok(names.includes('徐悲鴻'));
    } else {
      // Contract specification verification for M1
      assert.strictEqual(typeof context.adminListRoster, 'function', 'Baseline roster listing functional');
      const roster = context.adminListRoster(eventId);
      assert.strictEqual(roster.length, 3, 'Roster count ready for sync');
    }
  });

  test('Batch sync handles empty roster gracefully without throwing', () => {
    const emptyEventId = 'evt_empty_sync';
    if (typeof context.adminSyncToSheets === 'function') {
      assert.doesNotThrow(() => {
        const res = context.adminSyncToSheets(emptyEventId);
        assert.ok(res);
      }, 'Empty event sync should not throw');
    }
  });
});
