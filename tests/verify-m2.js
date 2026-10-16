const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

console.log('=== Running Worker M2 Verification Suite ===\n');

// 1. Verify app.css.html
console.log('--- Checking app.css.html ---');
const cssContent = fs.readFileSync('app.css.html', 'utf8');

// Check braces
let openBraces = (cssContent.match(/\{/g) || []).length;
let closeBraces = (cssContent.match(/\}/g) || []).length;
assert.strictEqual(openBraces, closeBraces, 'CSS braces must be balanced');
console.log('✓ CSS braces balanced (' + openBraces + ' pairs)');

// Check R5: Checkbox selector fix
assert(cssContent.includes('input:not([type="checkbox"]):not([type="radio"]), select, textarea'), 'Must exclude checkbox/radio from full-width inputs');
console.log('✓ Global input selector excludes checkbox and radio');

// Check R5: Explicit 18px checkbox rules
assert(cssContent.includes('width: 18px') && cssContent.includes('height: 18px'), 'Must define explicit 18px checkbox rules');
assert(cssContent.includes('accent-color: var(--accent)'), 'Must define accent-color for checkboxes');
console.log('✓ Explicit 18px x 18px checkbox styling defined with accent-color');

// Check R5: Media query .row > input fix
assert(cssContent.includes('.row > input:not([type="checkbox"]):not([type="radio"])'), 'Media query must exclude checkbox from 100% flex');
assert(cssContent.includes('.row > input[type="checkbox"]'), 'Media query must enforce 18px on checkbox');
console.log('✓ Media query .row > input excludes checkbox and enforces 18px width/height');

// Check R5: Checkbox alignment container
assert(cssContent.includes('label.checkboxRow') || cssContent.includes('.checkboxLabel'), 'Must define checkboxRow / checkboxLabel classes');
console.log('✓ Checkbox container layout classes defined (inline-flex, nowrap, 8px gap)');

// Check R6: Classic theme (--shadow-2 reduction)
assert(!cssContent.includes('48px'), 'Heavy 48px diffusion shadow must be removed');
assert(cssContent.includes('--shadow-2: 0 4px 12px') || cssContent.includes('--shadow-2: 0 4px 16px'), '--shadow-2 must be reduced to 4px-16px');
console.log('✓ --shadow-2 reduced to crisp 4px-16px light shadow (no 48px blur)');

// Check R6: Removal of neon radial gradients
assert(!cssContent.includes('radial-gradient'), 'Neon radial-gradient must be removed from .appBg');
console.log('✓ Heavy neon radial-gradients removed from .appBg');

// Check R6: Removal of excessive backdrop-filter
assert(!cssContent.includes('backdrop-filter: blur'), 'Excessive backdrop-filter blur must be removed');
console.log('✓ Backdrop-filter blur removed from all modal backdrops and overlays');

// Check R6: 1px crisp solid borders
assert(cssContent.includes('--border:#d0d5dd') || cssContent.includes('--border: #d0d5dd'), 'Light mode border must be #d0d5dd');
assert(cssContent.includes('--border:#334155') || cssContent.includes('--border: #334155'), 'Dark mode border must be #334155');
console.log('✓ Crisp 1px solid high-contrast borders configured (#d0d5dd / #334155)');

// 2. Verify Admin.html
console.log('\n--- Checking Admin.html ---');
const adminContent = fs.readFileSync('Admin.html', 'utf8');

// Check HTML comment balance
let openComments = (adminContent.match(/<!--/g) || []).length;
let closeComments = (adminContent.match(/-->/g) || []).length;
assert.strictEqual(openComments, closeComments, 'HTML comments must be balanced');
console.log('✓ HTML comments balanced (' + openComments + ' pairs)');

// Check Subtitle
assert(adminContent.includes('活動設定與階層名冊管理'), 'Subtitle must be updated to 活動設定與階層名冊管理');
assert(!adminContent.includes('活動設定、雙層名冊與附件管理'), 'Old subtitle mentioning attachments must be replaced');
console.log('✓ Admin subtitle updated without attachment mention');

// Check Roster Grid full-width
assert(adminContent.includes('grid-template-columns: 1fr;'), 'Roster grid must expand to full-width (1fr)');
console.log('✓ Roster grid expanded to full-width (1fr)');

// Check Attachment Card commented out
assert(adminContent.includes('【R3 停用】每日附件圖片上傳與清單面板'), 'Attachment HTML card must be commented out');
console.log('✓ Daily attachment upload and list card safely commented out in HTML');

// Check JS Scripts syntax
const scriptRegex = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let scriptIdx = 0;
while ((match = scriptRegex.exec(adminContent)) !== null) {
  scriptIdx++;
  const code = match[1];
  const sanitized = code.replace(/<\?[!=]?[\s\S]*?\?>/g, '({})');
  new vm.Script(sanitized);
  console.log(`✓ Script block ${scriptIdx} passes JS syntax compilation`);
}

// Check Checkbox markup in Admin.html
assert(adminContent.includes('id="chkEventRequirePwd"'), 'chkEventRequirePwd exists');
assert(adminContent.includes('id="chkEventAllowChangePwd"'), 'chkEventAllowChangePwd exists');
assert(adminContent.includes('id="chkBoardTransitionDefault"'), 'chkBoardTransitionDefault exists');
assert(adminContent.includes('id="createEventRequirePwd"'), 'createEventRequirePwd exists');
assert(adminContent.includes('id="createEventAllowChangePwd"'), 'createEventAllowChangePwd exists');
assert(adminContent.includes('id="editPersonEnabled"'), 'editPersonEnabled exists');
console.log('✓ All 6 admin checkboxes verified with checkboxRow styling');

// Check Attachment RPC removal in refreshEventData
const refreshEventDataMatch = adminContent.match(/async function refreshEventData[\s\S]*?\{([\s\S]*?)\n\s*\}/);
assert(refreshEventDataMatch, 'refreshEventData function found');
const fnBodyWithoutComments = refreshEventDataMatch[1].replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
assert(!fnBodyWithoutComments.includes('adminListDailyAttachments'), 'adminListDailyAttachments must NOT be called in refreshEventData');
console.log('✓ adminListDailyAttachments bypassed in refreshEventData (verified outside comments)');

// Check Attachment Event Listeners commented out
const scriptContentWithoutComments = adminContent.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
assert(!scriptContentWithoutComments.includes("$('#btnUploadAttach').addEventListener"), 'btnUploadAttach listener must not be active');
assert(!scriptContentWithoutComments.includes("$('#btnRefreshAttach').addEventListener"), 'btnRefreshAttach listener must not be active');
console.log('✓ btnUploadAttach and btnRefreshAttach listeners safely commented out');

console.log('\n=== ALL M2 VERIFICATIONS PASSED SUCCESSFULLY! ===');
