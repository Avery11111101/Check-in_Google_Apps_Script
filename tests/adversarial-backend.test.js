// tests/adversarial-backend.test.js
// Challenger 1: Backend & Storage Empirical Adversarial Verifier Suite
// Stress-tests deep hierarchies, cyclic references, UTF-8 emoji sharding, Drive overflow, and consecutive syncs.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFreshContext } = require('./harness/vm-loader.js');

describe('Adversarial Verification: Backend & Fast Store Stress Suite', () => {
  let context, mocks;

  beforeEach(() => {
    const res = createFreshContext();
    context = res.context;
    mocks = res.mocks;

    context.ensureInitialized_();
    mocks.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', 'admin@example.com');
  });

  // ==========================================================================
  // Dimension 1: Deep Hierarchy Stress Test (12 Levels)
  // ==========================================================================
  describe('Dimension 1: Deep Tree Hierarchy (10+ Levels to 12 Levels)', () => {
    test('1.1 Create and traverse 12-level hierarchical structure with accurate depths and paths', () => {
      const eventId = 'evt_deep_12_levels';
      const levelNames = [
        '層級0_總處', '層級1_大部', '層級2_指揮部', '層級3_資訊處',
        '層級4_系統科', '層級5_架構組', '層級6_雲端隊', '層級7_核心班',
        '層級8_第一分隊', '層級9_研發組', '層級10_測試哨', '層級11_特勤末端'
      ];

      const createdGroups = [];
      let parentId = '';

      for (let i = 0; i < levelNames.length; i++) {
        const name = levelNames[i];
        const res = context.adminCreateGroup({
          eventId,
          parentId,
          name,
          sort: i + 1,
        });
        assert.ok(res.ok, `Level ${i} creation must succeed`);
        assert.strictEqual(res.depth, i, `Level ${i} depth must equal ${i}`);
        createdGroups.push(res);
        parentId = res.groupId;
      }

      assert.strictEqual(createdGroups.length, 12, 'Must create 12 levels');

      const allGroups = context.adminListGroups(eventId);
      assert.strictEqual(allGroups.length, 12, 'Must list all 12 groups');

      const leaf = allGroups.find(g => g.groupId === createdGroups[11].groupId);
      assert.ok(leaf, 'Deepest leaf node must exist');
      assert.strictEqual(leaf.depth, 11, 'Leaf depth must be 11');
      const expectedPath = levelNames.join('/');
      assert.strictEqual(leaf.path, expectedPath, 'Leaf path must accurately reflect all 12 levels');
    });

    test('1.2 Member assignment across deep levels and rollup statistics calculation', () => {
      const eventId = 'evt_deep_members_rollup';
      const levelIds = [];
      let parentId = '';

      for (let i = 0; i < 12; i++) {
        const res = context.adminCreateGroup({
          eventId,
          parentId,
          name: `L_${i}`,
          sort: 1,
        });
        levelIds.push(res.groupId);
        parentId = res.groupId;
      }

      const m0 = context.adminCreateRoster({ eventId, groupId: levelIds[0], displayName: '人員_根層' });
      const m5 = context.adminCreateRoster({ eventId, groupId: levelIds[5], displayName: '人員_中層' });
      const m11 = context.adminCreateRoster({ eventId, groupId: levelIds[11], displayName: '人員_深層' });

      assert.ok(m0.ok && m5.ok && m11.ok, 'All 3 members must be created');

      const store = context.fastStoreGet(eventId);
      const statusMap = new Map();
      statusMap.set(`${eventId}::${m0.personId}`, { status: 'IN', lastTime: '08:00' });
      statusMap.set(`${eventId}::${m11.personId}`, { status: 'IN', lastTime: '08:30' });

      const tree = context.buildFolderTree_(store.groups, store.roster, statusMap);
      assert.strictEqual(tree.rootFolders.length, 1, 'Only 1 root folder at L0');

      const root = tree.rootFolders[0];
      assert.strictEqual(root.stats.total, 3, 'Root stats.total must roll up all 3 members across all 12 levels');
      assert.strictEqual(root.stats.signed, 2, 'Root stats.signed must roll up 2 signed-in members');
      assert.strictEqual(root.stats.notYet, 1, 'Root stats.notYet must roll up 1 not-yet member');
      assert.strictEqual(root.stats.attendanceRate, '66.7', 'Root attendanceRate must be 66.7%');
    });

    test('1.3 adminImportRosterBatch with 10-level slash-separated path', () => {
      const eventId = 'evt_deep_import_batch';
      const deepPath = 'A/B/C/D/E/F/G/H/I/J';
      const rawText = `${deepPath}, 極深人員01, pass123\n${deepPath}, 極深人員02, pass456`;

      const res = context.adminImportRosterBatch({ eventId, rawText });
      assert.ok(res.ok, 'Deep batch import must succeed');
      assert.strictEqual(res.importedCount, 2, 'Must import 2 members');
      assert.strictEqual(res.createdGroupsCount, 10, 'Must create 10 intermediate/leaf group levels');

      const groups = context.adminListGroups(eventId);
      assert.strictEqual(groups.length, 10, 'Total groups should be 10');

      const leafGroup = groups.find(g => g.name === 'J');
      assert.ok(leafGroup, 'Leaf group J must exist');
      assert.strictEqual(leafGroup.depth, 9, 'Leaf group depth must be 9');
      assert.strictEqual(leafGroup.path, deepPath, 'Leaf group path must match deepPath');

      const roster = context.adminListRoster(eventId);
      assert.strictEqual(roster.length, 2, 'Roster count must be 2');
      assert.strictEqual(roster[0].groupPath, deepPath, 'Member breadcrumb groupPath must match 10-level path');
    });

    test('1.4 Deep tree intermediate rename cascades path to all descendants', () => {
      const eventId = 'evt_deep_rename_cascade';
      const g0 = context.adminCreateGroup({ eventId, name: '處', sort: 1 });
      const g1 = context.adminCreateGroup({ eventId, name: '科', parentId: g0.groupId, sort: 1 });
      const g2 = context.adminCreateGroup({ eventId, name: '組', parentId: g1.groupId, sort: 1 });
      const g3 = context.adminCreateGroup({ eventId, name: '隊', parentId: g2.groupId, sort: 1 });

      const updateRes = context.adminUpdateGroup({
        eventId,
        groupId: g1.groupId,
        name: '新科技科',
      });
      assert.ok(updateRes.ok, 'Intermediate update must succeed');

      const groups = context.adminListGroups(eventId);
      const leaf = groups.find(g => g.groupId === g3.groupId);
      assert.ok(leaf, 'Leaf group must exist');
      assert.strictEqual(leaf.path, '處/新科技科/組/隊', 'Path must cascade through intermediate rename');
    });
  });

  // ==========================================================================
  // Dimension 2: Cyclic ParentId References Protection
  // ==========================================================================
  describe('Dimension 2: Cyclic ParentId References Adversarial Testing', () => {
    test('2.1 Self-loop reference rejection (groupId === parentId)', () => {
      const eventId = 'evt_cycle_self';
      const g = context.adminCreateGroup({ eventId, name: '自我節點', sort: 1 });

      assert.throws(() => {
        context.adminUpdateGroup({
          eventId,
          groupId: g.groupId,
          parentId: g.groupId,
        });
      }, /不能將分組的父分類設為自己/, 'Must throw error when parentId is set to self');
    });

    test('2.2 [Verified: Tree Cycle Guard] Mutual 2-node cycle (A -> B, update A with parentId = B)', () => {
      const eventId = 'evt_cycle_mutual';
      const gA = context.adminCreateGroup({ eventId, name: '節點A', sort: 1 });
      const gB = context.adminCreateGroup({ eventId, name: '節點B', parentId: gA.groupId, sort: 1 });

      assert.throws(() => {
        context.adminUpdateGroup({
          eventId,
          groupId: gA.groupId,
          parentId: gB.groupId,
        });
      }, /不能將分類移動至其子分類下/, 'Moving parent under child must be rejected with cycle error');

      const groups = context.adminListGroups(eventId);
      const nodeA = groups.find(g => g.groupId === gA.groupId);
      const nodeB = groups.find(g => g.groupId === gB.groupId);

      assert.strictEqual(nodeA.parentId, '', 'NodeA parentId should remain intact');
      assert.strictEqual(nodeB.parentId, gA.groupId, 'NodeB parentId should remain intact');
    });

    test('2.3 [Verified: Transitive Cycle Guard] (A -> B -> C -> D, update A to parentId = D)', () => {
      const eventId = 'evt_cycle_transitive';
      const gA = context.adminCreateGroup({ eventId, name: '處', sort: 1 });
      const gB = context.adminCreateGroup({ eventId, name: '科', parentId: gA.groupId, sort: 1 });
      const gC = context.adminCreateGroup({ eventId, name: '組', parentId: gB.groupId, sort: 1 });
      const gD = context.adminCreateGroup({ eventId, name: '隊', parentId: gC.groupId, sort: 1 });

      assert.throws(() => {
        context.adminUpdateGroup({
          eventId,
          groupId: gA.groupId,
          parentId: gD.groupId,
        });
      }, /不能將分類移動至其子分類下/, 'Transitive cycle must throw error');

      const groups = context.adminListGroups(eventId);
      const nodeA = groups.find(g => g.groupId === gA.groupId);
      const nodeD = groups.find(g => g.groupId === gD.groupId);
      assert.strictEqual(nodeA.depth, 0, 'Root node depth preserved');
      assert.strictEqual(nodeD.depth, 3, 'Leaf node depth preserved');
    });

    test('2.4 Corrupted disconnected cycle input to buildFolderTree_ does not trigger call stack overflow', () => {
      const corruptGroups = [
        { groupId: 'grp_loop_1', parentId: 'grp_loop_2', name: 'Loop1', path: 'Loop1', depth: 0, sort: 1 },
        { groupId: 'grp_loop_2', parentId: 'grp_loop_1', name: 'Loop2', path: 'Loop2', depth: 0, sort: 2 },
      ];
      const roster = [
        { personId: 'p_loop', eventId: 'e_test', groupId: 'grp_loop_1', displayName: '孤兒成員', enabled: true }
      ];

      const tree = context.buildFolderTree_(corruptGroups, roster);
      assert.ok(tree, 'buildFolderTree_ returns an object');
      assert.strictEqual(tree.rootFolders.length, 0, 'Cyclic groups without a valid root are excluded from rootFolders');
    });
  });

  // ==========================================================================
  // Dimension 3: 8KB Sharding Boundary & UTF-8 Multi-byte Characters
  // ==========================================================================
  describe('Dimension 3: Sharding Boundary, UTF-8 Multi-byte & Emoji Integrity', () => {
    test('3.1 [Verified: UTF-8 Byte Boundary Sharding Eliminates QuotaExceededError]', () => {
      const eventId = 'evt_utf8_sharding';

      // 40 members with Traditional Chinese names and long notes
      // JSON character length is ~4,500 chars (< 8000), but UTF-8 byte length is > 15,000 bytes (> 9000 bytes GAS limit)
      const members = [];
      for (let i = 0; i < 40; i++) {
        members.push({
          personId: `p_utf8_${String(i).padStart(3, '0')}`,
          eventId,
          groupId: '',
          displayName: `測試中文姓名繁體長字元_${i}_` + '測試繁體中文字符'.repeat(10),
          font: '微軟正黑體',
          enabled: true,
          sort: i,
          passwordHash: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
          hasPassword: true,
        });
      }

      let quotaExceeded = false;
      let errorMsg = '';
      try {
        context.fastStoreSave(eventId, { groups: [], roster: members }, true);
      } catch (e) {
        if (e.message.includes('QuotaExceededError')) {
          quotaExceeded = true;
          errorMsg = e.message;
        } else {
          throw e;
        }
      }

      assert.strictEqual(quotaExceeded, false, 'UTF-8 byte sharding must not throw QuotaExceededError');
      const loaded = context.fastStoreGet(eventId);
      assert.strictEqual(loaded.roster.length, 40, 'All 40 members must be loaded successfully across chunks');
    });

    test('3.2 Emoji surrogate pair integrity across chunk boundaries', () => {
      const eventId = 'evt_emoji_surrogate';
      const emojis = ['🚀', '🌟', '💻', '🎉', '🔥', '🏆', '🎯', '⚡'];
      const members = [];
      for (let i = 0; i < 20; i++) {
        const emo = emojis[i % emojis.length];
        members.push({
          personId: `p_emo_${i}`,
          eventId,
          groupId: '',
          displayName: `測試成員${emo}_${i}`,
          font: '',
          enabled: true,
          sort: i,
          passwordHash: '',
          hasPassword: false,
        });
      }

      const meta = context.fastStoreSave(eventId, { groups: [], roster: members }, true);
      assert.ok(meta, 'Fast store save should complete');

      const loaded = context.fastStoreGet(eventId);
      assert.strictEqual(loaded.roster.length, 20, 'All 20 members must be loaded');
      for (let i = 0; i < 20; i++) {
        const emo = emojis[i % emojis.length];
        assert.ok(loaded.roster[i].displayName.includes(emo), `DisplayName must retain exact emoji ${emo}`);
      }
    });

    test('3.3 Fast Store data integrity across repeated save/load cycles', () => {
      const eventId = 'evt_integrity_cycles';
      const initialGroups = [{ groupId: 'g1', name: '分組一', path: '分組一', sort: 1, depth: 0 }];
      const initialRoster = [{ personId: 'p1', eventId, groupId: 'g1', displayName: '張大千', enabled: true, sort: 1 }];

      context.fastStoreSave(eventId, { groups: initialGroups, roster: initialRoster }, false);

      for (let cycle = 1; cycle <= 5; cycle++) {
        const current = context.fastStoreGet(eventId);
        current.roster.push({
          personId: `p_cycle_${cycle}`,
          eventId,
          groupId: 'g1',
          displayName: `週期成員_${cycle}`,
          enabled: true,
          sort: cycle + 1,
        });
        context.fastStoreSave(eventId, current, true);
      }

      const finalState = context.fastStoreGet(eventId);
      assert.strictEqual(finalState.roster.length, 6, 'Roster must contain 1 initial + 5 cycle members');
      assert.strictEqual(finalState.isDirty, true, 'isDirty flag must remain true');
    });
  });

  // ==========================================================================
  // Dimension 4: Large Volume Simulation & Drive Overflow
  // ==========================================================================
  describe('Dimension 4: Large Volume Roster & Drive Overflow Trigger', () => {
    test('4.1 [Verified: Drive Overflow Read Preserves Data via getBlob]', () => {
      const eventId = 'evt_drive_overflow_trigger';

      const db = context.getDb_();
      const shEvents = db.getSheetByName(context.SHEETS.EVENTS);
      const folder = mocks.DriveApp.createFolder('EventStorageFolder');
      shEvents.appendRow([
        eventId, '大活動', new Date(), new Date(), true,
        folder.getId(), folder.getUrl(), new Date(), false, false
      ]);

      const heavyRoster = [];
      for (let i = 0; i < 3500; i++) {
        heavyRoster.push({
          personId: `p_heavy_${String(i).padStart(4, '0')}`,
          eventId,
          groupId: 'g_main',
          displayName: `模擬大容量人員_${i}`,
          font: '',
          enabled: true,
          sort: i,
          passwordHash: '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92',
          hasPassword: true,
        });
      }

      const meta = context.fastStoreSave(eventId, {
        groups: [{ groupId: 'g_main', name: '總組', path: '總組', sort: 1, depth: 0 }],
        roster: heavyRoster,
      }, true);

      assert.ok(meta.driveFileId, 'Drive overflow must be triggered and return driveFileId');
      assert.strictEqual(meta.chunkCount, 0, 'Chunk count must be 0 for Drive overflow');

      // Verify fastStoreGet reads back via file.getBlob().getDataAsString('UTF-8') or getContentAsString()
      const loaded = context.fastStoreGet(eventId);
      assert.strictEqual(loaded.roster.length, 3500, 'Loaded roster length must match 3500 items preserved in Drive');
    });

    test('4.2 [Verified: Drive Overflow Fallback to Root Folder When No driveFolderId Configured]', () => {
      const eventId = 'evt_drive_no_folder';
      // Do not configure driveFolderId in SHEETS.EVENTS
      const heavyRoster = [];
      for (let i = 0; i < 6000; i++) {
        heavyRoster.push({
          personId: `p_heavy_${i}`,
          eventId,
          groupId: 'g1',
          displayName: `人員_${i}_` + '長備註'.repeat(15),
          font: '',
          enabled: true,
          sort: i,
          passwordHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          hasPassword: true,
        });
      }

      let threw = false;
      let errorMsg = '';
      try {
        context.fastStoreSave(eventId, {
          groups: [{ groupId: 'g1', name: '組1' }],
          roster: heavyRoster,
        }, true);
      } catch (e) {
        threw = true;
        errorMsg = e.message;
      }

      assert.strictEqual(threw, false, 'DriveApp.getRootFolder() fallback must succeed without throwing');
      const loaded = context.fastStoreGet(eventId);
      assert.strictEqual(loaded.roster.length, 6000, 'Loaded roster length must match 6000 items from root folder');
    });

    test('4.3 Storage health monitor indicators reflect drive overflow tier', () => {
      const eventId = 'evt_health_monitor';
      const metaKey = '_FS_' + eventId + '_META';
      mocks.PropertiesService.getScriptProperties().setProperty(metaKey, JSON.stringify({
        eventId,
        driveFileId: 'fil_mock_overflow',
        chunkCount: 0,
        dataLength: 400000,
        groupsCount: 5,
        rosterCount: 500,
        isDirty: true,
        lastModified: Date.now(),
        lastSynced: Date.now(),
      }));

      const health = context.adminGetStorageHealth(eventId);
      assert.ok(health.ok, 'Health check must return ok');
      assert.strictEqual(health.tier, 'drive', 'tier must be drive when driveFileId exists');
      assert.strictEqual(health.isDriveOverflowActive, true, 'isDriveOverflowActive must be true');
    });
  });

  // ==========================================================================
  // Dimension 5: Consecutive Operations & Spreadsheet Sync Integrity
  // ==========================================================================
  describe('Dimension 5: Consecutive adminSyncToSheets & CRUD Sequence', () => {
    test('5.1 [Verified: Consecutive adminSyncToSheets Succeeds via RangeMock.clearContent]', () => {
      const eventId = 'evt_consecutive_sync';
      context.adminCreateGroup({ eventId, name: '同步組', sort: 1 });
      context.adminCreateRoster({ eventId, displayName: '同步成員A' });

      // First sync succeeds
      const res1 = context.adminSyncToSheets(eventId);
      assert.ok(res1.ok || res1.success, 'First sync must succeed');

      // Add another member
      context.adminCreateRoster({ eventId, displayName: '同步成員B' });

      // Second sync: existingGroupRows.length > 1, calls shGroups.getRange(...).clearContent()
      let threwSecondSync = false;
      let secondSyncError = '';
      try {
        context.adminSyncToSheets(eventId);
      } catch (e) {
        threwSecondSync = true;
        secondSyncError = e.message;
      }

      assert.strictEqual(threwSecondSync, false, 'Second sync must succeed without error');
    });

    test('5.2 Rapid multi-step Fast Store CRUD sequence maintains integrity', () => {
      const eventId = 'evt_rapid_crud';

      const gRoot = context.adminCreateGroup({ eventId, name: '營運部', sort: 1 });
      const gSub = context.adminCreateGroup({ eventId, name: '客服科', parentId: gRoot.groupId, sort: 1 });

      const pIds = [];
      for (let i = 1; i <= 5; i++) {
        const r = context.adminCreateRoster({ eventId, groupId: gSub.groupId, displayName: `專員_${i}` });
        pIds.push(r.personId);
      }
      assert.strictEqual(pIds.length, 5, 'Must create 5 members');

      context.adminUpdateRoster({ eventId, personId: pIds[1], displayName: '專員_已更名' });
      context.adminDeleteRoster({ eventId, personId: pIds[3] });

      const rosterList = context.adminListRoster(eventId);
      assert.strictEqual(rosterList.length, 4, 'Must have 4 members remaining');
      const updated = rosterList.find(m => m.personId === pIds[1]);
      assert.strictEqual(updated.displayName, '專員_已更名', 'Updated name must persist');
      const deleted = rosterList.find(m => m.personId === pIds[3]);
      assert.strictEqual(deleted, undefined, 'Deleted member must not exist');
    });
  });

  // ==========================================================================
  // Dimension 6: Attendance Fast Store Integration & Drive Toggle
  // ==========================================================================
  describe('Dimension 6: Attendance Fast Store Integration & Drive Toggle', () => {
    test('6.1 Newly created member can check in immediately without prior Sheet sync', () => {
      const eventId = 'evt_checkin_immediate';
      const db = context.getDb_();
      const shEvents = db.getSheetByName(context.SHEETS.EVENTS);
      shEvents.appendRow([eventId, '即刻簽到活動', '', '', true, '', '', new Date(), false, false]);

      // Create member in Fast Store (NOT synced to Sheets yet)
      const member = context.adminCreateRoster({ eventId, displayName: '現場即刻進場者', sort: 1 });
      assert.ok(member.ok, 'Member creation in Fast Store must succeed');

      // Submit attendance check-in immediately
      const res = context.publicSubmitAttendance({
        eventId,
        personId: member.personId,
        action: 'IN',
      });

      assert.ok(res.ok, 'Immediate check-in must succeed');
      assert.strictEqual(res.status, 'IN', 'Check-in status must be IN');
    });

    test('6.2 Password changed via publicChangePassword is not wiped by adminSyncToSheets', () => {
      const eventId = 'evt_pwd_sync_preserve';
      const db = context.getDb_();
      const shEvents = db.getSheetByName(context.SHEETS.EVENTS);
      shEvents.appendRow([eventId, '密碼保護活動', '', '', true, '', '', new Date(), true, true]);

      const group = context.adminCreateGroup({ eventId, name: '安全組' });
      const member = context.adminCreateRoster({
        eventId,
        groupId: group.groupId,
        displayName: '小美',
        password: 'oldPassword123',
      });

      // Perform initial sync to Sheets
      context.adminSyncToSheets(eventId);

      // Change password
      const changeRes = context.publicChangePassword({
        eventId,
        personId: member.personId,
        oldPassword: 'oldPassword123',
        newPassword: 'newSecretPassword456',
      });
      assert.ok(changeRes.ok, 'Password change must succeed');

      // Trigger adminSyncToSheets
      context.adminSyncToSheets(eventId);

      // Verify that the person in Fast Store and Sheets still has the new password hash
      const person = context.getPersonInEvent_(eventId, member.personId);
      const expectedHash = context.hashPassword_('newSecretPassword456');
      assert.strictEqual(person.passwordHash, expectedHash, 'New password hash must be preserved after adminSyncToSheets');

      // Verify check-in works with new password
      const checkinRes = context.publicSubmitAttendance({
        eventId,
        personId: member.personId,
        action: 'IN',
        password: 'newSecretPassword456',
      });
      assert.ok(checkinRes.ok, 'Check-in with new password must succeed');
    });

    test('6.3 adminToggleDriveOverflow switches storage tier between Drive and Properties accurately', () => {
      const eventId = 'evt_toggle_tier';
      context.adminCreateGroup({ eventId, name: '切換組' });
      context.adminCreateRoster({ eventId, displayName: '切換成員' });

      // Toggle to Drive
      const toggleOn = context.adminToggleDriveOverflow({ eventId, enabled: true });
      assert.ok(toggleOn.ok, 'Toggle on must succeed');
      assert.strictEqual(toggleOn.isDriveOverflowActive, true, 'isDriveOverflowActive must be true');

      const healthOn = context.adminGetStorageHealth(eventId);
      assert.strictEqual(healthOn.tier, 'drive', 'Health tier must be drive');
      assert.strictEqual(healthOn.isDriveOverflowActive, true, 'isDriveOverflowActive must be true');

      // Toggle back to Properties
      const toggleOff = context.adminToggleDriveOverflow({ eventId, enabled: false });
      assert.ok(toggleOff.ok, 'Toggle off must succeed');
      assert.strictEqual(toggleOff.isDriveOverflowActive, false, 'isDriveOverflowActive must be false');

      const healthOff = context.adminGetStorageHealth(eventId);
      assert.strictEqual(healthOff.tier, 'properties', 'Health tier must be properties');
      assert.strictEqual(healthOff.isDriveOverflowActive, false, 'isDriveOverflowActive must be false');
    });
  });
});
