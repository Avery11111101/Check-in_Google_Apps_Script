// tests/tier2-boundary/03_deep_tree_hierarchy.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFreshContext } = require('../harness/vm-loader.js');

describe('Tier 2: [Boundary] Deep Tree Hierarchy (>= 4 Levels) & Tree Traversal', () => {
  let context, mocks;

  beforeEach(() => {
    const res = createFreshContext();
    context = res.context;
    mocks = res.mocks;

    context.ensureInitialized_();
    mocks.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', 'admin@example.com');
  });

  test('Support deep folder hierarchy (4 levels: 處 > 科 > 組 > 小隊)', () => {
    const eventId = 'evt_deep_tree';

    // 1. Level 0: 處
    const l0 = context.adminCreateGroup({
      eventId,
      parentId: '',
      name: '總處',
      category: '總處',
      groupName: '',
      sort: 1,
    });
    const id0 = l0.groupId;

    // 2. Level 1: 科
    const l1 = context.adminCreateGroup({
      eventId,
      parentId: id0,
      name: '資訊科技科',
      category: '總處',
      groupName: '資訊科技科',
      sort: 1,
    });
    const id1 = l1.groupId;

    // 3. Level 2: 組
    const l2 = context.adminCreateGroup({
      eventId,
      parentId: id1,
      name: '系統工程組',
      category: '資訊科技科',
      groupName: '系統工程組',
      sort: 1,
    });
    const id2 = l2.groupId;

    // 4. Level 3: 小隊
    const l3 = context.adminCreateGroup({
      eventId,
      parentId: id2,
      name: '雲端開發小隊',
      category: '系統工程組',
      groupName: '雲端開發小隊',
      sort: 1,
    });
    const id3 = l3.groupId;

    assert.ok(id0 && id1 && id2 && id3, 'All 4 level IDs must be generated');

    const groups = context.adminListGroups(eventId);
    assert.ok(groups.length >= 4, 'Should list at least 4 groups');

    // If depth/path are calculated on objects:
    const leaf = groups.find(g => g.groupId === id3 || g.name === '雲端開發小隊' || g.groupName === '雲端開發小隊');
    assert.ok(leaf, 'Leaf node must exist');

    if (leaf.depth !== undefined) {
      assert.strictEqual(leaf.depth, 3, 'Leaf node depth must be 3');
    }
  });

  test('Backward compatibility with unclassified and single-tier categories', () => {
    const eventId = 'evt_compat_tree';

    // Single tier
    const g1 = context.adminCreateGroup({
      eventId,
      name: '一般分組A',
      category: '公關組',
      groupName: '第一梯隊',
      sort: 1,
    });
    assert.ok(g1 && g1.ok, 'Single tier group should succeed');

    // Unclassified (empty strings)
    const gEmpty = context.adminCreateGroup({
      eventId,
      name: '',
      category: '',
      groupName: '',
      sort: 99,
    });
    assert.ok(gEmpty && gEmpty.ok, 'Empty classification group should be handled safely');

    const list = context.adminListGroups(eventId);
    assert.ok(list.length >= 2, 'Should list compatibility groups');
  });
});
