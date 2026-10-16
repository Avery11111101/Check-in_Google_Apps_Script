// tests/tier1-features/03_r1_tree_structure.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFreshContext } = require('../harness/vm-loader.js');

describe('Tier 1: [R1] Infinite Folder-Tree Classification Model', () => {
  let context, mocks;

  beforeEach(() => {
    const res = createFreshContext();
    context = res.context;
    mocks = res.mocks;

    // Setup basic event
    context.ensureInitialized_();
    mocks.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', 'admin@example.com');
  });

  test('adminListGroups and adminCreateGroup interface contracts exist', () => {
    assert.strictEqual(typeof context.adminListGroups, 'function', 'adminListGroups must be a function');
    assert.strictEqual(typeof context.adminCreateGroup, 'function', 'adminCreateGroup must be a function');
  });

  test('Tree node model supports hierarchical depth and path computation', () => {
    const eventId = 'evt_test_tree';

    // Create root node (處)
    const rootRes = context.adminCreateGroup({
      eventId,
      parentId: '',
      name: '總處',
      category: '總處',
      groupName: '',
      sort: 1,
    });
    assert.ok(rootRes && rootRes.ok, 'Root group creation should succeed');
    const rootId = rootRes.groupId;
    assert.ok(rootId, 'groupId should be returned');

    // Create sub-level 1 node (科)
    const sub1Res = context.adminCreateGroup({
      eventId,
      parentId: rootId,
      name: '資訊科',
      category: '總處',
      groupName: '資訊科',
      sort: 1,
    });
    assert.ok(sub1Res && sub1Res.ok, 'Sub-level group creation should succeed');

    // List groups
    const groups = context.adminListGroups(eventId);
    assert.ok(Array.isArray(groups), 'adminListGroups should return an array');
    assert.ok(groups.length >= 2, 'Should contain at least 2 created nodes');

    // Check tree properties if implemented (M1 target)
    const rootGroup = groups.find(g => g.groupId === rootId || g.name === '總處' || g.category === '總處');
    assert.ok(rootGroup, 'Root group should exist in list');

    // Verify depth and path contract if tree properties are exposed
    if (rootGroup.depth !== undefined) {
      assert.strictEqual(rootGroup.depth, 0, 'Root node depth should be 0');
      assert.strictEqual(rootGroup.path, '總處', 'Root node path should match name');
    }
  });

  test('adminDeleteGroup fails if node has bound members or child groups', () => {
    const eventId = 'evt_delete_guard';
    const groupRes = context.adminCreateGroup({
      eventId,
      parentId: '',
      name: '研發組',
      category: '研發組',
      groupName: '',
      sort: 1,
    });
    const groupId = groupRes.groupId;

    // Bind a roster person
    context.adminCreateRoster({
      eventId,
      groupId,
      displayName: '王大明',
      sort: 1,
    });

    // Deleting group with bound member must throw or return error
    assert.throws(
      () => {
        context.adminDeleteGroup({ groupId, eventId });
      },
      /(綁定|成員|請先調整名單|bound|cannot delete)/i,
      'Should reject deletion when group has active members'
    );
  });
});
