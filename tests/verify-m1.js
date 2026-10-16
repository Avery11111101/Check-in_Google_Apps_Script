const assert = require('node:assert');
const { createFreshContext } = require('./harness/vm-loader.js');

console.log('=== Running Worker M1 Backend Architecture Verification Suite ===\n');

const { context, mocks } = createFreshContext();

// ============================================================================
// 1. R1: Infinite Tree Classification & Adjacency List
// ============================================================================
console.log('--- Testing R1: Infinite Folder-Tree Classification ---');
const eventId = 'evt_m1_test';
const db = context.getDb_();
const shEvents = db.getSheetByName(context.SHEETS.EVENTS);
shEvents.appendRow([eventId, 'M1 測試活動', '', '', true, '', '', new Date(), false, false]);

// 1.1 Create 4-level deep hierarchy: 處 > 科 > 組 > 小隊
const g1 = context.adminCreateGroup({ eventId, name: '行政處', parentId: '', sort: 1 });
assert.strictEqual(g1.depth, 0);
assert.strictEqual(g1.path, '行政處');
assert.strictEqual(g1.parentId, '');
console.log('✓ Root level group created: 行政處 (depth 0, path: 行政處)');

const g2 = context.adminCreateGroup({ eventId, name: '資訊科', parentId: g1.groupId, sort: 1 });
assert.strictEqual(g2.depth, 1);
assert.strictEqual(g2.path, '行政處/資訊科');
assert.strictEqual(g2.parentId, g1.groupId);
console.log('✓ Level 1 group created: 資訊科 (depth 1, path: 行政處/資訊科)');

const g3 = context.adminCreateGroup({ eventId, name: '系統組', parentId: g2.groupId, sort: 1 });
assert.strictEqual(g3.depth, 2);
assert.strictEqual(g3.path, '行政處/資訊科/系統組');
console.log('✓ Level 2 group created: 系統組 (depth 2, path: 行政處/資訊科/系統組)');

const g4 = context.adminCreateGroup({ eventId, name: '第一小隊', parentId: g3.groupId, sort: 1 });
assert.strictEqual(g4.depth, 3);
assert.strictEqual(g4.path, '行政處/資訊科/系統組/第一小隊');
console.log('✓ Level 3 group created: 第一小隊 (depth 3, path: 行政處/資訊科/系統組/第一小隊)');

// 1.2 adminListGroups verification
const listG = context.adminListGroups(eventId);
assert.strictEqual(listG.length, 4);
const foundG4 = listG.find(g => g.groupId === g4.groupId);
assert.ok(foundG4);
assert.strictEqual(foundG4.category, '行政處');
assert.strictEqual(foundG4.groupName, '第一小隊');
assert.strictEqual(foundG4.depth, 3);
console.log('✓ adminListGroups returns accurate tree nodes with category/groupName legacy mappings');

// 1.3 Deletion protection: cannot delete if child exists
assert.throws(() => {
  context.adminDeleteGroup({ groupId: g1.groupId, eventId });
}, /此分組下尚有子分類/);
console.log('✓ adminDeleteGroup prevents deletion when child groups exist');

// 1.4 Member binding and member deletion protection
const p1 = context.adminCreateRoster({
  eventId,
  groupId: g4.groupId,
  displayName: '林系統',
  password: 'pass',
});
assert.ok(p1.personId);
assert.strictEqual(p1.hasPassword, true);

assert.throws(() => {
  context.adminDeleteGroup({ groupId: g4.groupId, eventId });
}, /此分組仍有名單綁定/);
console.log('✓ adminDeleteGroup prevents deletion when members are bound');

// 1.5 Batch import with deep path auto-generation
const batchRes = context.adminImportRosterBatch({
  eventId,
  rawText: `處/科/維運組/機房班, 陳機房, 8888\n無分類人員\n舊主類別, 舊子類別, 舊人員`,
});
assert.strictEqual(batchRes.ok, true);
assert.strictEqual(batchRes.importedCount, 3);
console.log('✓ adminImportRosterBatch parsed deep path and generated intermediate nodes correctly');

// 1.6 Verify breadcrumbs in adminListRoster
const roster = context.adminListRoster(eventId);
const pChen = roster.find(r => r.displayName === '陳機房');
assert.ok(pChen);
assert.strictEqual(pChen.groupPath, '處/科/維運組/機房班');
const pUnassigned = roster.find(r => r.displayName === '無分類人員');
assert.ok(pUnassigned);
assert.strictEqual(pUnassigned.groupId, '');
assert.strictEqual(pUnassigned.groupPath, '');
console.log('✓ adminListRoster returns groupPath breadcrumbs and unassigned members');

// ============================================================================
// 2. R2: Tiered Fast Store (Sharding, Hydration, Drive Overflow, Sync, Health)
// ============================================================================
console.log('\n--- Testing R2: Tiered Fast Store ---');

// 2.1 Fast store sharding verification
const props = context.PropertiesService.getScriptProperties();
const meta = context.fastStoreGetMetadata(eventId);
assert.ok(meta);
assert.strictEqual(meta.eventId, eventId);
console.log(`✓ Fast store saved metadata with chunkCount=${meta.chunkCount}, dataLength=${meta.dataLength}`);

// 2.2 Routine CRUD does 0 Sheet RPCs
mocks.SpreadsheetApp._resetStats();
context.adminCreateRoster({ eventId, displayName: '王快取', sort: 99 });
context.adminListRoster(eventId);
context.adminListGroups(eventId);
const rpcStats = mocks.SpreadsheetApp.rpcStats;
assert.strictEqual(rpcStats.setValues, 0, 'Fast Store CRUD does 0 setValues');
assert.strictEqual(rpcStats.appendRow, 0, 'Fast Store CRUD does 0 appendRow');
console.log('✓ Fast Store CRUD operated with 0 Sheet setValues and 0 appendRow RPCs');

// 2.3 adminSyncToSheets batch write
const syncRes = context.adminSyncToSheets(eventId);
assert.ok(syncRes.ok && syncRes.success);
const shRoster = db.getSheetByName(context.SHEETS.ROSTER);
const rosterData = shRoster.getDataRange().getValues();
const syncWang = rosterData.find(r => String(r[3]) === '王快取');
assert.ok(syncWang, '王快取 must exist in Google Sheets after sync');
console.log('✓ adminSyncToSheets permanently wrote roster and groups to Google Sheets');

// 2.4 Storage health monitoring
const health = context.adminGetStorageHealth(eventId);
assert.ok(health.ok);
assert.strictEqual(typeof health.usedBytes, 'number');
assert.strictEqual(health.maxBytes, 512000);
assert.strictEqual(health.tier, 'properties');
assert.strictEqual(health.status, 'HEALTHY');
console.log(`✓ adminGetStorageHealth reported health: ${health.usedBytes} bytes / 512000 (${health.percent}%), status: ${health.status}`);

// 2.5 Board state retrieval with tree hierarchy
const boardState = context.publicGetBoardState(eventId);
assert.ok(boardState.ok);
assert.ok(boardState.groups && boardState.groups.length > 0);
assert.ok(boardState.categories && boardState.categories.length > 0);
assert.ok(boardState.tree && boardState.tree.rootFolders.length > 0);
assert.ok(boardState.roster && boardState.roster.length > 0);
console.log('✓ publicGetBoardState returns groups, categories, roster, and hierarchical tree');

// ============================================================================
// 3. R3: Attachment System Safe Deactivation
// ============================================================================
console.log('\n--- Testing R3: Attachment System Safe Stubs ---');
const attachList = context.adminListDailyAttachments(eventId, '2026-10-16');
assert.strictEqual(Array.isArray(attachList), true);
assert.strictEqual(attachList.length, 0);
console.log('✓ adminListDailyAttachments returns empty array safely');

const uploadRes = context.adminUploadDailyAttachment({ eventId, base64: 'abc' });
assert.strictEqual(uploadRes.disabled, true);
assert.strictEqual(uploadRes.success, false);
console.log('✓ adminUploadDailyAttachment returns disabled: true without error');

const delRes = context.adminDeleteDailyAttachment({ eventId });
assert.strictEqual(delRes.disabled, true);
assert.strictEqual(delRes.ok, true);
console.log('✓ adminDeleteDailyAttachment returns disabled: true safely');

console.log('\n=== ALL WORKER M1 VERIFICATIONS PASSED 100%! ===');
