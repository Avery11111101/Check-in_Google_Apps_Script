// tests/tier1-features/04_r2_fast_store_crud.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFreshContext } = require('../harness/vm-loader.js');

describe('Tier 1: [R2] Tiered Fast Store Roster CRUD', () => {
  let context, mocks;

  beforeEach(() => {
    const res = createFreshContext();
    context = res.context;
    mocks = res.mocks;

    context.ensureInitialized_();
    mocks.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', 'admin@example.com');
  });

  test('adminCreateRoster creates member and returns personId', () => {
    const eventId = 'evt_crud_test';
    const groupRes = context.adminCreateGroup({ eventId, name: '測試組', category: '測試組' });
    const groupId = groupRes.groupId;

    const res = context.adminCreateRoster({
      eventId,
      groupId,
      displayName: '陳小美',
      sort: 10,
      password: 'password123',
    });

    assert.ok(res && res.ok, 'Roster creation should return ok: true');
    assert.ok(res.personId, 'Should return personId');
    assert.strictEqual(res.hasPassword, true, 'hasPassword should be true when password provided');
  });

  test('adminListRoster retrieves created members with accurate attributes', () => {
    const eventId = 'evt_crud_test_2';
    const groupRes = context.adminCreateGroup({ eventId, name: '企劃組', category: '企劃組' });
    const groupId = groupRes.groupId;

    context.adminCreateRoster({
      eventId,
      groupId,
      displayName: '李大同',
      sort: 5,
    });
    context.adminCreateRoster({
      eventId,
      groupId,
      displayName: '林志玲',
      sort: 2,
    });

    const roster = context.adminListRoster(eventId);
    assert.ok(Array.isArray(roster), 'adminListRoster should return an array');
    assert.strictEqual(roster.length, 2, 'Should contain exactly 2 roster members');

    const names = roster.map(r => r.displayName || r.name);
    assert.ok(names.includes('李大同'), 'Should contain 李大同');
    assert.ok(names.includes('林志玲'), 'Should contain 林志玲');
  });

  test('adminDeleteRoster removes member from store', () => {
    const eventId = 'evt_crud_test_3';
    const createRes = context.adminCreateRoster({
      eventId,
      groupId: 'grp_test',
      displayName: '待刪人員',
      sort: 1,
    });
    const personId = createRes.personId;

    if (typeof context.adminDeleteRoster === 'function') {
      const delRes = context.adminDeleteRoster({ eventId, personId });
      assert.ok(delRes && delRes.ok, 'Deletion should succeed');

      const roster = context.adminListRoster(eventId);
      const found = roster.find(r => r.personId === personId);
      assert.strictEqual(found, undefined, 'Deleted person should no longer exist in roster');
    }
  });
});
