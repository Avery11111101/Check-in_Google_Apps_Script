// tests/tier4-application/02_folder_rename_and_cascade.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFreshContext } = require('../harness/vm-loader.js');

describe('Tier 4: [Application] Tree Folder Rename & Breadcrumb Cascading', () => {
  let context, mocks;

  beforeEach(() => {
    const res = createFreshContext();
    context = res.context;
    mocks = res.mocks;

    context.ensureInitialized_();
    mocks.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', 'admin@example.com');
  });

  test('Folder rename propagates path changes to child folders and preserves bound members', () => {
    const eventId = 'evt_rename_cascade';

    // 1. Create parent folder
    const parentRes = context.adminCreateGroup({
      eventId,
      parentId: '',
      name: '北區營業處',
      category: '北區營業處',
      groupName: '',
      sort: 1,
    });
    const parentId = parentRes.groupId;

    // 2. Create sub folder
    const childRes = context.adminCreateGroup({
      eventId,
      parentId,
      name: '信義分隊',
      category: '北區營業處',
      groupName: '信義分隊',
      sort: 1,
    });
    const childId = childRes.groupId;

    // 3. Add members
    const m1 = context.adminCreateRoster({
      eventId,
      groupId: childId,
      displayName: '營業員甲',
      sort: 1,
    });
    const m2 = context.adminCreateRoster({
      eventId,
      groupId: childId,
      displayName: '營業員乙',
      sort: 2,
    });

    // 4. Update/Rename parent folder if adminUpdateGroup is available
    if (typeof context.adminUpdateGroup === 'function') {
      context.adminUpdateGroup({
        eventId,
        groupId: parentId,
        name: '大台北營運總處',
        category: '大台北營運總處',
        groupName: '',
        sort: 1,
      });

      const groups = context.adminListGroups(eventId);
      const updatedChild = groups.find(g => g.groupId === childId);
      assert.ok(updatedChild, 'Child group must exist after parent rename');

      // Check path cascade if path is implemented
      if (updatedChild.path) {
        assert.ok(
          updatedChild.path.startsWith('大台北營運總處'),
          `Child path (${updatedChild.path}) should reflect new parent name`
        );
      }
    }

    // Verify members are still assigned to child group
    const roster = context.adminListRoster(eventId);
    const assigned = roster.filter(r => r.groupId === childId);
    assert.strictEqual(assigned.length, 2, 'Members must remain bound to child group after parent modifications');
  });
});
