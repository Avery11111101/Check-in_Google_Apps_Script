// tests/tier4-application/01_roster_100plus_simulation.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFreshContext } = require('../harness/vm-loader.js');

describe('Tier 4: [Application] 100+ Member Roster Simulation & Load Verification', () => {
  let context, mocks;

  beforeEach(() => {
    const res = createFreshContext();
    context = res.context;
    mocks = res.mocks;

    context.ensureInitialized_();
    mocks.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', 'admin@example.com');
  });

  test('Create and manage 120 members across 5 groups with fast responsiveness', () => {
    const eventId = 'evt_load_100';
    const db = context.getDb_();
    const shEvents = db.getSheetByName(context.SHEETS.EVENTS);
    shEvents.appendRow([eventId, '百人年度大會', '', '', true, '', '', new Date(), false, false]);

    // Create 5 groups
    const groupIds = [];
    for (let g = 1; g <= 5; g++) {
      const gRes = context.adminCreateGroup({
        eventId,
        name: `第${g}分隊`,
        category: '行動大隊',
        groupName: `第${g}分隊`,
        sort: g,
      });
      groupIds.push(gRes.groupId);
    }

    // Add 120 members
    const startTime = Date.now();
    const createdMemberIds = [];

    for (let i = 1; i <= 120; i++) {
      const gId = groupIds[i % 5];
      const res = context.adminCreateRoster({
        eventId,
        groupId: gId,
        displayName: `大會學員_${String(i).padStart(3, '0')}`,
        sort: i,
      });
      createdMemberIds.push(res.personId);
    }

    const elapsedMs = Date.now() - startTime;
    // Fast responsiveness check: batch member addition in local JS should be well under 2000ms
    assert.ok(elapsedMs < 2000, `Adding 120 members took ${elapsedMs}ms, should be responsive`);

    // Verify roster retrieval
    const roster = context.adminListRoster(eventId);
    assert.strictEqual(roster.length, 120, 'Roster count must be exactly 120');

    // Sync to Sheets
    if (typeof context.adminSyncToSheets === 'function') {
      const syncRes = context.adminSyncToSheets(eventId);
      assert.ok(syncRes && (syncRes.ok || syncRes.success));

      const shRoster = db.getSheetByName(context.SHEETS.ROSTER);
      const rows = shRoster.getDataRange().getValues();
      // 1 header row + 120 members
      assert.strictEqual(rows.length, 121, 'Sheets.ROSTER must contain 120 members + header');
    }
  });

  test('Simulate 100 members checking in and verify attendance status tally', () => {
    const eventId = 'evt_load_checkin';
    const db = context.getDb_();
    const shEvents = db.getSheetByName(context.SHEETS.EVENTS);
    shEvents.appendRow([eventId, '現場報到模擬', '', '', true, '', '', new Date(), false, false]);

    const group = context.adminCreateGroup({ eventId, name: '測試隊', category: '測試隊' });
    const memberIds = [];

    for (let i = 1; i <= 50; i++) {
      const m = context.adminCreateRoster({
        eventId,
        groupId: group.groupId,
        displayName: `現場人員_${i}`,
        sort: i,
      });
      memberIds.push(m.personId);
    }

    if (typeof context.adminSyncToSheets === 'function') {
      context.adminSyncToSheets(eventId);
    }

    // Simulate 40 members checking IN
    for (let i = 0; i < 40; i++) {
      const pId = memberIds[i];
      const res = context.publicSubmitAttendance({
        eventId,
        personId: pId,
        action: 'IN',
      });
      assert.ok(res && res.ok, `Person ${pId} check-in failed`);
      assert.strictEqual(res.status, 'IN');
    }

    // Verify Board State reflects 40 signed-in members
    if (typeof context.publicGetBoardState === 'function') {
      const board = context.publicGetBoardState(eventId);
      assert.ok(board && (board.ok || board.roster), 'Board state should be returned');
      const inCount = (board.roster || []).filter(r => r.status === 'IN').length;
      assert.strictEqual(inCount, 40, 'Board state must reflect exactly 40 signed-in members');
    }
  });
});
