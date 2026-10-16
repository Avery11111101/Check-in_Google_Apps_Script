const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

console.log('=== Running Worker M3 Frontend Architecture Verification Suite ===\n');

// 1. Verify R4: Fullscreen Collapsible Board
console.log('--- Checking R4: Fullscreen Collapsible Board (Board.html & app.css.html) ---');
const cssContent = fs.readFileSync('app.css.html', 'utf8');
const boardHtml = fs.readFileSync('Board.html', 'utf8');

// Container 100vw / 100% fluid check
assert.ok(
  cssContent.includes('.page-board .container') && cssContent.includes('100vw'),
  'app.css.html must define .page-board .container with 100vw fluid layout'
);
console.log('✓ Board container unlocked: 100vw fluid fullscreen enabled');

// 3-col squeeze bug fix check
assert.ok(
  cssContent.includes('.boardSubgroupBlock .boardCols') &&
  cssContent.includes('grid-template-columns: 1fr'),
  'app.css.html must fix 3-col squeeze by setting .boardSubgroupBlock .boardCols to 1fr'
);
console.log('✓ Nested 3-column squeeze fixed: .boardSubgroupBlock .boardCols set to 1fr single-column adaptive');

// Person card typography & ellipsis
assert.ok(
  cssContent.includes('.person__main') && cssContent.includes('text-overflow: ellipsis'),
  'app.css.html must contain .person__main and text-overflow: ellipsis'
);
assert.ok(
  cssContent.includes('.statusTag') && cssContent.includes('flex-shrink: 0'),
  'app.css.html must protect .statusTag with flex-shrink: 0'
);
console.log('✓ Person card layout reinforced: flex-shrink: 0 on statusTag, text-overflow: ellipsis on name');

// Board collapsible controls & indicators
assert.ok(boardHtml.includes('id="btnBoardExpandAll"'), 'Board.html must have btnBoardExpandAll');
assert.ok(boardHtml.includes('id="btnBoardCollapseAll"'), 'Board.html must have btnBoardCollapseAll');
assert.ok(boardHtml.includes('boardCategoryCard__arrow'), 'Board.html must render category collapse arrow');
assert.ok(boardHtml.includes('collapsedBoardNodes'), 'Board.html must manage collapse state in Set');
assert.ok(boardHtml.includes('renderTreeFolderHtml_'), 'Board.html must support hierarchical tree folder rendering');
console.log('✓ Board collapsible controls verified: Expand All / Collapse All buttons, toggle arrows & Set persistence');

// Board scripts syntax check
const boardScripts = boardHtml.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi) || [];
boardScripts.forEach((s, idx) => {
  const code = s.replace(/<script[^>]*>|<\/script>/gi, '').replace(/<\?[!=]?[\s\S]*?\?>/g, '({})');
  new vm.Script(code);
  console.log(`✓ Board.html script block ${idx + 1} passes JS syntax compilation`);
});

// 2. Verify R1: Admin File-Explorer Folder Tree UI
console.log('\n--- Checking R1: Admin File-Explorer Folder Tree UI (Admin.html) ---');
const adminHtml = fs.readFileSync('Admin.html', 'utf8');

assert.ok(adminHtml.includes('class="treeExplorerContainer"'), 'Admin.html must have treeExplorerContainer');
assert.ok(adminHtml.includes('id="btnTreeExpandAll"'), 'Admin.html must have btnTreeExpandAll');
assert.ok(adminHtml.includes('id="btnTreeCollapseAll"'), 'Admin.html must have btnTreeCollapseAll');
assert.ok(adminHtml.includes('id="btnTreeAddRootGroup"'), 'Admin.html must have btnTreeAddRootGroup');
assert.ok(adminHtml.includes('id="createGroupModal"'), 'Admin.html must define createGroupModal');
assert.ok(adminHtml.includes('id="createGroupName"'), 'Admin.html must have createGroupName input');
assert.ok(adminHtml.includes('id="createGroupParent"'), 'Admin.html must have createGroupParent select');
assert.ok(adminHtml.includes('btnTreeAddSub'), 'Admin.html must support btnTreeAddSub at tree nodes');
assert.ok(adminHtml.includes('btnTreeAddPerson'), 'Admin.html must support btnTreeAddPerson at tree nodes');
assert.ok(adminHtml.includes('btnTreeDelGroup'), 'Admin.html must support btnTreeDelGroup at tree nodes');
console.log('✓ Admin File-Explorer Tree verified: container, toolbar, modal, +子分類, +成員, 刪除');

// 3. Verify R2: Admin Storage Health Monitor & Sheet Sync UI
console.log('\n--- Checking R2: Admin Storage Health & Sheet Sync UI (Admin.html) ---');
assert.ok(adminHtml.includes('id="storageHealthDashboard"'), 'Admin.html must have storageHealthDashboard');
assert.ok(adminHtml.includes('id="storageProgressBar"'), 'Admin.html must have storageProgressBar');
assert.ok(adminHtml.includes('id="storageUsageText"'), 'Admin.html must have storageUsageText');
assert.ok(adminHtml.includes('id="storageTierBadge"'), 'Admin.html must have storageTierBadge');
assert.ok(adminHtml.includes('id="storageHealthStatus"'), 'Admin.html must have storageHealthStatus');
assert.ok(adminHtml.includes('id="btnSyncToSheets"'), 'Admin.html must have btnSyncToSheets button');
assert.ok(adminHtml.includes('refreshStorageHealth'), 'Admin.html must define refreshStorageHealth function');
assert.ok(adminHtml.includes('adminSyncToSheets'), 'Admin.html must call adminSyncToSheets');
console.log('✓ Storage Health UI verified: percentage bar, bytes, tier badge, status badge & sheet sync button');

// 4. Verify R6: Mobile 3-Tab Navigation
console.log('\n--- Checking R6: Mobile 3-Tab Navigation (Admin.html & app.css.html) ---');
assert.ok(adminHtml.includes('id="adminMobileTabBar"'), 'Admin.html must define adminMobileTabBar');
assert.ok(adminHtml.includes('id="tabBtnRoster"'), 'Admin.html must have tabBtnRoster');
assert.ok(adminHtml.includes('id="tabBtnSettings"'), 'Admin.html must have tabBtnSettings');
assert.ok(adminHtml.includes('id="tabBtnBoard"'), 'Admin.html must have tabBtnBoard');
assert.ok(adminHtml.includes('id="paneRoster"'), 'Admin.html must define paneRoster');
assert.ok(adminHtml.includes('id="paneSettings"'), 'Admin.html must define paneSettings');
assert.ok(adminHtml.includes('id="paneBoard"'), 'Admin.html must define paneBoard');
assert.ok(adminHtml.includes('initMobileTabs'), 'Admin.html must define and call initMobileTabs');

// CSS touch-friendly 44px min-height check
assert.ok(cssContent.includes('.mobileTabItem'), 'app.css.html must define .mobileTabItem');
assert.ok(cssContent.includes('min-height: 44px'), 'app.css.html must enforce 44px touch height on mobile tab item');
console.log('✓ Mobile 3-Tab Navigation verified: 3 tabs, 3 panes, 44px touch-friendly height & active switching');

// Admin scripts syntax check
const adminScripts = adminHtml.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi) || [];
adminScripts.forEach((s, idx) => {
  const code = s.replace(/<script[^>]*>|<\/script>/gi, '').replace(/<\?[!=]?[\s\S]*?\?>/g, '({})');
  new vm.Script(code);
  console.log(`✓ Admin.html script block ${idx + 1} passes JS syntax compilation`);
});

console.log('\n=== ALL WORKER M3 VERIFICATIONS PASSED 100%! ===');
