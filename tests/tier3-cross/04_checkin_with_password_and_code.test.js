// tests/tier3-cross/04_checkin_with_password_and_code.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFreshContext } = require('../harness/vm-loader.js');

describe('Tier 3: [Cross-Feature] Public Attendance Check-in & Security Verification', () => {
  let context, mocks;

  beforeEach(() => {
    const res = createFreshContext();
    context = res.context;
    mocks = res.mocks;

    context.ensureInitialized_();
    mocks.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', 'admin@example.com');
  });

  test('validateAttendancePayload_ rejects invalid or missing fields', () => {
    // Missing eventId
    assert.throws(() => {
      context.validateAttendancePayload_({ personId: 'p1', action: 'IN' });
    }, /缺少 eventId/);

    // Missing personId
    assert.throws(() => {
      context.validateAttendancePayload_({ eventId: 'evt1', action: 'IN' });
    }, /缺少 personId/);

    // Invalid action
    assert.throws(() => {
      context.validateAttendancePayload_({ eventId: 'evt1', personId: 'p1', action: 'INVALID' });
    }, /action 必須是 IN 或 OUT/);
  });

  test('Password-protected check-in enforces password hash verification', () => {
    const eventId = 'evt_pwd_checkin';
    const db = context.getDb_();
    const shEvents = db.getSheetByName(context.SHEETS.EVENTS);

    // Create event with requirePassword = true, isOpen = true
    shEvents.appendRow([eventId, '密碼保護大會', '', '', true, '', '', new Date(), true, true]);

    // Create member with hashed password
    const group = context.adminCreateGroup({ eventId, name: '貴賓組', category: '貴賓組' });
    const correctPassword = 'SecretPassword99!';
    const memberRes = context.adminCreateRoster({
      eventId,
      groupId: group.groupId,
      displayName: '貴賓張先生',
      sort: 1,
      password: correctPassword,
    });
    const personId = memberRes.personId;

    // Sync Fast Store to Sheets so public attendance reader sees the member
    if (typeof context.adminSyncToSheets === 'function') {
      context.adminSyncToSheets(eventId);
    }

    // 1. Submit with WRONG password -> should throw
    assert.throws(
      () => {
        context.publicSubmitAttendance({
          eventId,
          personId,
          action: 'IN',
          password: 'WrongPassword!',
        });
      },
      /(密碼錯誤|個人簽到密碼)/,
      'Should reject check-in when wrong password is provided'
    );

    // 2. Submit with missing password -> should throw
    assert.throws(
      () => {
        context.publicSubmitAttendance({
          eventId,
          personId,
          action: 'IN',
          password: '',
        });
      },
      /(需要輸入個人簽到密碼|密碼不可為空)/,
      'Should reject check-in when password is omitted'
    );

    // 3. Submit with CORRECT password -> succeeds
    const checkinRes = context.publicSubmitAttendance({
      eventId,
      personId,
      action: 'IN',
      password: correctPassword,
    });

    assert.ok(checkinRes && checkinRes.ok, 'Check-in should succeed with correct password');
    assert.strictEqual(checkinRes.status, 'IN', 'Status should be IN');
  });

  test('Check-in status transitions: IN to OUT', () => {
    const eventId = 'evt_trans_checkin';
    const db = context.getDb_();
    const shEvents = db.getSheetByName(context.SHEETS.EVENTS);

    shEvents.appendRow([eventId, '一般簽退測試', '', '', true, '', '', new Date(), false, false]);

    const group = context.adminCreateGroup({ eventId, name: '測試組', category: '測試組' });
    const member = context.adminCreateRoster({
      eventId,
      groupId: group.groupId,
      displayName: '簽退測試員',
      sort: 1,
    });
    const personId = member.personId;

    if (typeof context.adminSyncToSheets === 'function') {
      context.adminSyncToSheets(eventId);
    }

    // Check IN
    const inRes = context.publicSubmitAttendance({ eventId, personId, action: 'IN' });
    assert.ok(inRes && inRes.ok);
    assert.strictEqual(inRes.status, 'IN');

    // Simulate clock advancing past 15 seconds rate limit window
    const shStatus = db.getSheetByName(context.SHEETS.STATUS);
    const rows = shStatus.getDataRange().getValues();
    for (let r = 1; r < rows.length; r++) {
      if (rows[r][0] === eventId && rows[r][1] === personId) {
        // Set lastTime to 20 seconds ago
        shStatus.getRange(r + 1, 4).setValue(new Date(Date.now() - 20000));
        break;
      }
    }

    // Check OUT
    const outRes = context.publicSubmitAttendance({ eventId, personId, action: 'OUT' });
    assert.ok(outRes && outRes.ok);
    assert.strictEqual(outRes.status, 'OUT');
  });
});
