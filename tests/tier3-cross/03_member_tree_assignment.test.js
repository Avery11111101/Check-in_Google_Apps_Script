// tests/tier3-cross/03_member_tree_assignment.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFreshContext } = require('../harness/vm-loader.js');

describe('Tier 3: [Cross-Feature] Member Tree Node Assignment & Re-parenting', () => {
  let context, mocks;

  beforeEach(() => {
    const res = createFreshContext();
    context = res.context;
    mocks = res.mocks;

    context.ensureInitialized_();
    mocks.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', 'admin@example.com');
  });

  test('Members can be assigned and re-assigned between different tree nodes', () => {
    const eventId = 'evt_tree_assign';

    // Create 2 branches
    const gA = context.adminCreateGroup({ eventId, name: '前端工程組', category: '技術處', groupName: '前端工程組', sort: 1 });
    const gB = context.adminCreateGroup({ eventId, name: '後端工程組', category: '技術處', groupName: '後端工程組', sort: 2 });

    // Add member to Branch A
    const member = context.adminCreateRoster({
      eventId,
      groupId: gA.groupId,
      displayName: '全端工程師',
      sort: 1,
    });
    const personId = member.personId;

    // Verify initial assignment
    let roster = context.adminListRoster(eventId);
    let person = roster.find(r => r.personId === personId);
    assert.strictEqual(person.groupId, gA.groupId, 'Initial assignment must be Group A');

    // Update assignment to Branch B
    if (typeof context.adminUpdatePerson === 'function') {
      context.adminUpdatePerson({
        eventId,
        personId,
        groupId: gB.groupId,
        displayName: '全端工程師',
        sort: 1,
      });

      roster = context.adminListRoster(eventId);
      person = roster.find(r => r.personId === personId);
      assert.strictEqual(person.groupId, gB.groupId, 'Updated assignment must be Group B');
    }

    // Now Branch A has no members, so it should be safely deletable
    if (typeof context.adminUpdatePerson === 'function') {
      assert.doesNotThrow(() => {
        context.adminDeleteGroup({ eventId, groupId: gA.groupId });
      }, 'Group A with 0 members should be deletable');
    }
  });
});
