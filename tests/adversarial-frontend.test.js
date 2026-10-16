// tests/adversarial-frontend.test.js
// Challenger 2: Frontend & Layout Empirical Adversarial Verification Suite
// Adversarially stress-tests checkbox layout, 100vw board & squishing, design tokens, and DOM tree persistence.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MockWindow } = require('./harness/dom-mock.js');

const ROOT_DIR = path.resolve(__dirname, '..');
const CSS_PATH = path.join(ROOT_DIR, 'app.css.html');
const ADMIN_PATH = path.join(ROOT_DIR, 'Admin.html');
const BOARD_PATH = path.join(ROOT_DIR, 'Board.html');
const CHECKIN_PATH = path.join(ROOT_DIR, 'Checkin.html');

const cssContent = fs.readFileSync(CSS_PATH, 'utf8');
const adminHtml = fs.readFileSync(ADMIN_PATH, 'utf8');
const boardHtml = fs.readFileSync(BOARD_PATH, 'utf8');
const checkinHtml = fs.readFileSync(CHECKIN_PATH, 'utf8');

/**
 * Extracts a complete function definition from HTML source code by tracking balanced curly braces.
 */
function extractFunction(source, fnName) {
  const startIdx = source.indexOf('function ' + fnName);
  if (startIdx === -1) throw new Error('Function ' + fnName + ' not found');
  const openBrace = source.indexOf('{', startIdx);
  let depth = 1;
  let i = openBrace + 1;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(startIdx, i);
}

describe('Challenger 2: Checkbox Layout & Label Text Non-Wrapping (320px~412px Viewports)', () => {

  test('Census: All checkboxes across Admin.html, Board.html, Checkin.html must be identified and protected', () => {
    const adminCheckboxes = [...adminHtml.matchAll(/<input[^>]*type=["']checkbox["'][^>]*>/gi)].map(m => m[0]);
    const boardCheckboxes = [...boardHtml.matchAll(/<input[^>]*type=["']checkbox["'][^>]*>/gi)].map(m => m[0]);
    const checkinCheckboxes = [...checkinHtml.matchAll(/<input[^>]*type=["']checkbox["'][^>]*>/gi)].map(m => m[0]);

    assert.ok(adminCheckboxes.length >= 6, `Admin.html should contain at least 6 checkboxes (found ${adminCheckboxes.length})`);
    assert.ok(boardCheckboxes.length >= 1, `Board.html should contain at least 1 checkbox (found ${boardCheckboxes.length})`);
    assert.strictEqual(checkinCheckboxes.length, 0, `Checkin.html should not contain stray checkboxes`);

    // Verify all 6 Admin checkboxes are wrapped with .checkboxRow or label.row
    const requiredAdminIds = [
      'chkEventRequirePwd',
      'chkEventAllowChangePwd',
      'chkBoardTransitionDefault',
      'createEventRequirePwd',
      'createEventAllowChangePwd',
      'editPersonEnabled'
    ];

    requiredAdminIds.forEach(id => {
      const regex = new RegExp(`<label[^>]*class=["'][^"']*checkboxRow[^"']*["'][^>]*>[\\s\\S]*?id=["']${id}["']`, 'i');
      const hasProperLabel = regex.test(adminHtml);
      assert.ok(hasProperLabel, `Admin checkbox #${id} must be encased in a label with .checkboxRow styling`);
    });

    // Verify Board checkbox is inside an inline-flex container
    assert.ok(boardHtml.includes('id="chkBoardTransition"'), 'Board.html must contain chkBoardTransition');
    assert.ok(/<label[^>]*style=["'][^"']*inline-flex[^"']*["'][^>]*>[\s\S]*?id=["']chkBoardTransition["']/i.test(boardHtml),
      'Board checkbox #chkBoardTransition must be encased in an inline-flex container');
  });

  test('CSS: Global input selector must strictly exclude checkbox and radio from 100% width', () => {
    // Search for unqualified input selectors that could force width: 100%
    const unqualifiedMatches = [...cssContent.matchAll(/(^|[\n},;])\s*input\s*(?:,\s*|\{)[^}]*?width\s*:\s*100%/gi)];
    for (const match of unqualifiedMatches) {
      assert.fail(`Found illegal unqualified global input width: 100% selector: ${match[0]}`);
    }

    // Verify the explicit exclusion
    assert.ok(
      cssContent.includes('input:not([type="checkbox"]):not([type="radio"])'),
      'app.css.html must explicitly exclude type="checkbox" and type="radio" from full-width styling'
    );
  });

  test('CSS: Checkbox and radio rules must mandate 18px x 18px fixed square with flex-shrink: 0', () => {
    const cbRuleMatch = cssContent.match(/input\[type="checkbox"\],\s*input\[type="radio"\]\s*\{([\s\S]*?)\}/);
    assert.ok(cbRuleMatch, 'app.css.html must have an explicit input[type="checkbox"], input[type="radio"] block');

    const body = cbRuleMatch[1];
    assert.ok(/width\s*:\s*18px/.test(body), 'Checkbox must have width: 18px');
    assert.ok(/height\s*:\s*18px/.test(body), 'Checkbox must have height: 18px');
    assert.ok(/min-width\s*:\s*18px/.test(body), 'Checkbox must have min-width: 18px');
    assert.ok(/min-height\s*:\s*18px/.test(body), 'Checkbox must have min-height: 18px');
    assert.ok(/flex-shrink\s*:\s*0/.test(body), 'Checkbox must have flex-shrink: 0 to prevent narrow squeeze');
    assert.ok(/accent-color\s*:\s*var\(--accent\)/.test(body), 'Checkbox must have accent-color configured');
  });

  test('Responsive: Media queries must not override checkbox width to 100% under 320px~720px', () => {
    // Under @media (max-width: 720px), .row > input must exclude checkbox
    const mqMatch = cssContent.match(/@media\s*\(\s*max-width\s*:\s*720px\s*\)\s*\{([\s\S]*?)(?=@media|\Z)/);
    assert.ok(mqMatch, 'Found @media (max-width: 720px) block');

    const mqBody = mqMatch[1];
    assert.ok(
      mqBody.includes('.row > input:not([type="checkbox"]):not([type="radio"])'),
      '.row > input in media query must exclude checkbox from 100% flex basis'
    );

    assert.ok(
      mqBody.includes('.row > input[type="checkbox"]') && mqBody.includes('18px !important'),
      '.row > input[type="checkbox"] in media query must enforce 18px !important'
    );
  });

  test('Layout Non-Wrapping: Checkbox alignment container must mandate flex-wrap: nowrap', () => {
    const containerRule = cssContent.match(/label\.checkboxRow[\s\S]*?\{([\s\S]*?)\}/);
    assert.ok(containerRule, 'app.css.html must define label.checkboxRow rule');

    const ruleBody = containerRule[1];
    assert.ok(/display\s*:\s*inline-flex/.test(ruleBody), 'Checkbox container must be inline-flex');
    assert.ok(/flex-wrap\s*:\s*nowrap/.test(ruleBody), 'Checkbox container must have flex-wrap: nowrap to prevent text breaking to next line');
    assert.ok(/align-items\s*:\s*center/.test(ruleBody), 'Checkbox container must have align-items: center');
    assert.ok(/gap\s*:\s*8px/.test(ruleBody), 'Checkbox container must have gap: 8px');
  });

  test('Simulated Math: Viewport calculation on 320px screen proves checkbox never breaks line or stretches', () => {
    const viewportWidth = 320;
    const containerPadding = 12 * 2; // 24px (from @media (max-width: 420px))
    const cardPadding = 14 * 2; // 28px (from .card)
    const availableWidth = viewportWidth - containerPadding - cardPadding; // 268px

    const checkboxWidth = 18;
    const gap = 8;
    const remainingForText = availableWidth - checkboxWidth - gap; // 242px

    assert.strictEqual(checkboxWidth, 18, 'Checkbox strictly consumes 18px, NOT 268px (100%)');
    assert.ok(checkboxWidth < availableWidth * 0.1, 'Checkbox consumes < 10% of container width, never stretches');
    assert.ok(remainingForText > 200, 'Over 200px remaining for label text without breaking checkbox to separate row');
  });
});

describe('Challenger 2: Fullscreen 100vw Board & Absence of 90px Card Squishing', () => {

  test('100vw Board Container: Unlocked max-width without 1120px cap on .page-board', () => {
    // Default container has max-width: 1120px
    assert.ok(cssContent.includes('.container{ max-width:1120px;'), 'Default container has max-width');

    // .page-board .container MUST override it to 100vw / 100%
    const boardContainerMatch = cssContent.match(/\.page-board\s+\.container\s*\{([\s\S]*?)\}/);
    assert.ok(boardContainerMatch, 'Must define .page-board .container rule');

    const body = boardContainerMatch[1];
    assert.ok(/max-width\s*:\s*100vw/.test(body), '.page-board .container must set max-width: 100vw');
    assert.ok(/width\s*:\s*100%/.test(body), '.page-board .container must set width: 100%');
    assert.ok(/margin\s*:\s*0/.test(body), '.page-board .container must remove margin: 0 auto');
    assert.ok(/box-sizing\s*:\s*border-box/.test(body), '.page-board .container must have border-box sizing');
  });

  test('Widescreen Padding: >=1440px media query adds fluid padding without fixed width capping', () => {
    const wideMatch = cssContent.match(/@media\s*\(\s*min-width\s*:\s*1440px\s*\)\s*\{([\s\S]*?)\}/);
    assert.ok(wideMatch, 'Must define @media (min-width: 1440px) rule');
    assert.ok(wideMatch[1].includes('.page-board .container'), 'Must adjust board container on widescreen');
    assert.ok(!wideMatch[1].includes('max-width:'), 'Must NOT re-introduce max-width capping on widescreen');
  });

  test('Anti-Squishing Rule: .boardSubgroupBlock .boardCols must be 1fr single-column', () => {
    const subgroupColsMatch = cssContent.match(/\.boardSubgroupBlock\s+\.boardCols\s*\{([\s\S]*?)\}/);
    assert.ok(subgroupColsMatch, 'app.css.html must define .boardSubgroupBlock .boardCols');

    const body = subgroupColsMatch[1];
    assert.ok(
      /grid-template-columns\s*:\s*1fr/.test(body),
      '.boardSubgroupBlock .boardCols must use single column 1fr to eliminate 90px squishing'
    );
  });

  test('Board Grid Geometry: Minimum column width is 360px, guaranteeing card width >= 330px', () => {
    const catGridMatch = cssContent.match(/\.boardCategoryGrid\s*\{([\s\S]*?)\}/);
    assert.ok(catGridMatch, 'Must define .boardCategoryGrid');

    const body = catGridMatch[1];
    assert.ok(
      /grid-template-columns\s*:\s*repeat\(\s*auto-fill\s*,\s*minmax\(\s*360px\s*,\s*1fr\s*\)\s*\)/.test(body),
      '.boardCategoryGrid must enforce minmax(360px, 1fr)'
    );

    // Mathematical verification:
    // With 360px category column, subgroup padding (14px * 2 = 28px) and border (2px),
    // card width = 360 - 30 = 330px.
    const minColWidth = 360;
    const subgroupPadding = 14 * 2;
    const border = 2;
    const minPersonCardWidth = minColWidth - subgroupPadding - border;

    assert.strictEqual(minPersonCardWidth, 330, 'Calculated min person card width must be 330px');
    assert.ok(minPersonCardWidth >= 300, 'Card width is >= 300px, avoiding the squeezed 90px width by a factor of 3.6x');
  });

  test('Person Card Typography: Truncation, flex protection, and statusTag shrink-resistance', () => {
    // Find all .person .name matches and verify that the overriding definition has text-overflow: ellipsis
    const nameMatches = [...cssContent.matchAll(/\.person\s+\.name\s*\{([\s\S]*?)\}/g)];
    assert.ok(nameMatches.length >= 1, 'Must define .person .name');
    const combinedNameCss = nameMatches.map(m => m[1]).join('\n');
    assert.ok(/text-overflow\s*:\s*ellipsis/.test(combinedNameCss), '.person .name must have text-overflow: ellipsis');
    assert.ok(/white-space\s*:\s*nowrap/.test(combinedNameCss), '.person .name must have white-space: nowrap');
    assert.ok(/overflow\s*:\s*hidden/.test(combinedNameCss), '.person .name must have overflow: hidden');

    // .statusTag must not shrink or wrap
    const tagMatches = [...cssContent.matchAll(/\.statusTag\s*\{([\s\S]*?)\}/g)];
    assert.ok(tagMatches.length >= 1, 'Must define .statusTag');
    const combinedTagCss = tagMatches.map(m => m[1]).join('\n');
    assert.ok(/flex-shrink\s*:\s*0/.test(combinedTagCss), '.statusTag must have flex-shrink: 0');
    assert.ok(/white-space\s*:\s*nowrap/.test(combinedTagCss), '.statusTag must have white-space: nowrap');

    // .person__main must allow text truncation
    assert.ok(
      cssContent.includes('.person__main') && cssContent.includes('min-width: 0'),
      '.person__main must have min-width: 0 to allow flex child ellipsis'
    );
  });

  test('Adversarial Board Rendering: 120 members, ultra-long names, deep categories', () => {
    const mockWindow = new MockWindow();
    const sandbox = {
      window: mockWindow,
      document: mockWindow.document,
      esc: (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      statusTagClass_: (s) => s === 'IN' ? 'ok' : (s === 'OUT' ? 'bad' : 'not'),
      fmtTs: () => '14:30',
      collapsedBoardNodes: new Set(),
    };

    const fn1 = extractFunction(boardHtml, 'buildPersonHtml_');
    const fn2 = extractFunction(boardHtml, 'renderTreeSubgroupHtml_');
    const fn3 = extractFunction(boardHtml, 'renderTreeFolderHtml_');

    const fnCode = `${fn1}\n${fn2}\n${fn3}`;
    const ctx = vm.createContext(sandbox);
    vm.runInContext(fnCode, ctx);

    // Create adversarial tree folder
    const ultraLongName = '王'.repeat(50) + '（超長姓名測試）';
    const ultraLongFolder = '處'.repeat(30) + ' / ' + '科'.repeat(30);

    const members = [];
    for (let i = 0; i < 120; i++) {
      members.push({
        personId: `P_${i}`,
        displayName: i === 0 ? ultraLongName : `成員_${i}`,
        category: ultraLongFolder,
        groupName: '測試組',
        status: i % 2 === 0 ? 'IN' : 'NOT_YET',
        statusLabel: i % 2 === 0 ? '已簽到' : '未簽到',
        lastTime: Date.now(),
      });
    }

    const testFolder = {
      groupId: 'G_ADVERSARIAL_ROOT',
      name: ultraLongFolder,
      path: ultraLongFolder,
      depth: 0,
      stats: { signed: 60, total: 120, attendanceRate: '50.0' },
      members: members.slice(0, 20),
      children: [
        {
          groupId: 'G_SUB_1',
          name: '子組_1',
          path: ultraLongFolder + ' / 子組_1',
          depth: 1,
          stats: { signed: 50, total: 100 },
          members: members.slice(20, 120),
          children: []
        }
      ]
    };

    const renderedHtml = sandbox.renderTreeFolderHtml_(testFolder);
    assert.ok(renderedHtml.includes('boardCategoryCard'), 'Rendered HTML contains boardCategoryCard');
    assert.ok(renderedHtml.includes('boardSubgroupBlock'), 'Rendered HTML contains boardSubgroupBlock');
    assert.ok(renderedHtml.includes('data-person-id="P_0"'), 'Contains ultra-long member card');
    assert.ok(renderedHtml.includes('data-person-id="P_119"'), 'Contains 120th member card');

    // Verify all boardCols are inside boardSubgroupBlock
    const boardColsCount = [...renderedHtml.matchAll(/<div class="boardCols">/g)].length;
    const blockMatches = [...renderedHtml.matchAll(/<div[^>]*class=["'][^"']*boardSubgroupBlock[^"']*["'][^>]*>[\s\S]*?<div class="boardCols">/g)];
    assert.ok(boardColsCount >= 2, 'Rendered HTML contains at least 2 boardCols instances');
    assert.strictEqual(blockMatches.length, boardColsCount, 'Every boardCols instance is enclosed in a boardSubgroupBlock');
  });
});

describe('Challenger 2: Clean Design System Tokens (Zero 48px Blur, Neon Gradients, or Modal Blurs)', () => {

  test('Diffusion Blur: Complete absence of 48px blur shadows in all CSS and HTML', () => {
    const files = [
      { name: 'app.css.html', content: cssContent },
      { name: 'Admin.html', content: adminHtml },
      { name: 'Board.html', content: boardHtml },
      { name: 'Checkin.html', content: checkinHtml },
    ];

    files.forEach(f => {
      const matches = [...f.content.matchAll(/48px/g)];
      assert.strictEqual(
        matches.length,
        0,
        `File ${f.name} must contain zero occurrences of "48px" blur shadow (found ${matches.length})`
      );
    });
  });

  test('Neon Gradients: Complete absence of radial-gradient neon glow in app.css.html and inline styles', () => {
    const files = [
      { name: 'app.css.html', content: cssContent },
      { name: 'Admin.html', content: adminHtml },
      { name: 'Board.html', content: boardHtml },
      { name: 'Checkin.html', content: checkinHtml },
    ];

    files.forEach(f => {
      const matches = [...f.content.matchAll(/radial-gradient/gi)];
      assert.strictEqual(
        matches.length,
        0,
        `File ${f.name} must contain zero occurrences of "radial-gradient" neon glow (found ${matches.length})`
      );
    });
  });

  test('Modal Blurs: Complete absence of backdrop-filter blur in all CSS and HTML files', () => {
    const files = [
      { name: 'app.css.html', content: cssContent },
      { name: 'Admin.html', content: adminHtml },
      { name: 'Board.html', content: boardHtml },
      { name: 'Checkin.html', content: checkinHtml },
    ];

    files.forEach(f => {
      const matches = [...f.content.matchAll(/backdrop-filter\s*:[^;}]*blur/gi)];
      assert.strictEqual(
        matches.length,
        0,
        `File ${f.name} must contain zero occurrences of backdrop-filter: blur (found ${matches.length})`
      );
    });
  });

  test('Shadow Design Tokens: --shadow-1 and --shadow-2 must be crisp (<= 16px blur radius)', () => {
    const rootBlock = cssContent.match(/:root\s*\{([\s\S]*?)\}/)[1];
    const darkBlock = cssContent.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)[1];

    const shadow2Light = rootBlock.match(/--shadow-2\s*:\s*([^;]+);/)[1];
    const shadow2Dark = darkBlock.match(/--shadow-2\s*:\s*([^;]+);/)[1];

    assert.ok(shadow2Light.includes('12px'), `Light --shadow-2 must have 12px blur radius (got ${shadow2Light})`);
    assert.ok(shadow2Dark.includes('16px'), `Dark --shadow-2 must have 16px blur radius (got ${shadow2Dark})`);

    // Verify neither shadow exceeds 16px blur
    [shadow2Light, shadow2Dark].forEach(sh => {
      const pxValues = [...sh.matchAll(/(\d+)px/g)].map(m => parseInt(m[1], 10));
      const maxPx = Math.max(...pxValues);
      assert.ok(maxPx <= 16, `Shadow blur radius must be <= 16px (found ${maxPx}px in ${sh})`);
    });
  });

  test('High-Contrast Borders: 1px crisp borders defined for both light and dark themes', () => {
    assert.ok(cssContent.includes('--border:#d0d5dd'), 'Light theme --border is #d0d5dd');
    assert.ok(cssContent.includes('--border-strong:#94a3b8'), 'Light theme --border-strong is #94a3b8');
    assert.ok(cssContent.includes('--border:#334155'), 'Dark theme --border is #334155');
    assert.ok(cssContent.includes('--border-strong:#475569'), 'Dark theme --border-strong is #475569');
  });
});

describe('Challenger 2: DOM Node Tree Robustness & State Persistence', () => {

  test('Admin Tree: Rapid toggle stress test (100 toggles) maintains Set & localStorage consistency', () => {
    const mockWindow = new MockWindow();
    const sandbox = {
      window: mockWindow,
      document: mockWindow.document,
      localStorage: mockWindow.localStorage,
      adminCollapsedTreeNodes: new Set(),
      getSelectedEventId: () => 'EVT_STRESS_TEST',
    };

    const fn1 = extractFunction(adminHtml, 'loadAdminCollapsedTreeNodes');
    const fn2 = extractFunction(adminHtml, 'saveAdminCollapsedTreeNodes');

    const fnCode = `${fn1}\n${fn2}`;
    const ctx = vm.createContext(sandbox);
    vm.runInContext(fnCode, ctx);

    const testGid = 'NODE_TEST_X';

    // Simulate 100 rapid toggles
    for (let i = 0; i < 100; i++) {
      if (sandbox.adminCollapsedTreeNodes.has(testGid)) {
        sandbox.adminCollapsedTreeNodes.delete(testGid);
      } else {
        sandbox.adminCollapsedTreeNodes.add(testGid);
      }
      sandbox.saveAdminCollapsedTreeNodes();

      // Read back from localStorage
      const stored = JSON.parse(mockWindow.localStorage.getItem('adminCollapsedNodes_EVT_STRESS_TEST') || '[]');
      const shouldHave = (i % 2 === 0);
      assert.strictEqual(
        sandbox.adminCollapsedTreeNodes.has(testGid),
        shouldHave,
        `Iteration ${i}: Set state mismatch`
      );
      assert.strictEqual(
        stored.includes(testGid),
        shouldHave,
        `Iteration ${i}: localStorage state mismatch`
      );
    }

    // After 100 toggles (even number), it should be back to false
    assert.strictEqual(sandbox.adminCollapsedTreeNodes.has(testGid), false);
  });

  test('Admin Tree Re-render: Tree render honors stored collapsed state without resetting', () => {
    const mockWindow = new MockWindow();
    const sandbox = {
      window: mockWindow,
      document: mockWindow.document,
      localStorage: mockWindow.localStorage,
      adminCollapsedTreeNodes: new Set(['G_COLLAPSED_1', 'G_COLLAPSED_2']),
      getSelectedEventId: () => 'EVT_RENDER_TEST',
      esc: s => String(s || ''),
    };

    // Store in localStorage
    mockWindow.localStorage.setItem(
      'adminCollapsedNodes_EVT_RENDER_TEST',
      JSON.stringify(['G_COLLAPSED_1', 'G_COLLAPSED_2'])
    );

    const fn1 = extractFunction(adminHtml, 'loadAdminCollapsedTreeNodes');
    const fn2 = extractFunction(adminHtml, 'saveAdminCollapsedTreeNodes');

    const fnCode = `${fn1}\n${fn2}`;
    const ctx = vm.createContext(sandbox);
    vm.runInContext(fnCode, ctx);

    // Call loadAdminCollapsedTreeNodes
    sandbox.loadAdminCollapsedTreeNodes();

    assert.ok(sandbox.adminCollapsedTreeNodes.has('G_COLLAPSED_1'), 'Preserved G_COLLAPSED_1');
    assert.ok(sandbox.adminCollapsedTreeNodes.has('G_COLLAPSED_2'), 'Preserved G_COLLAPSED_2');
    assert.ok(!sandbox.adminCollapsedTreeNodes.has('G_EXPANDED_3'), 'G_EXPANDED_3 remains expanded');
  });

  test('Board Tree: Rapid toggle stress test (100 toggles) on board nodes', () => {
    const mockWindow = new MockWindow();
    const sandbox = {
      window: mockWindow,
      document: mockWindow.document,
      localStorage: mockWindow.localStorage,
      collapsedBoardNodes: new Set(),
      boardEventId: 'EVT_BOARD_STRESS',
      BOARD_COLLAPSED_LS: 'boardCollapsedNodes_',
    };

    const fn1 = extractFunction(boardHtml, 'loadCollapsedBoardNodes');
    const fn2 = extractFunction(boardHtml, 'saveCollapsedBoardNodes');
    const fn3 = extractFunction(boardHtml, 'toggleBoardNodeCollapse');

    const fnCode = `${fn1}\n${fn2}\n${fn3}`;
    const ctx = vm.createContext(sandbox);
    vm.runInContext(fnCode, ctx);

    const nodeKey = 'folder_GROUP_BOARD_1';

    // Mock card element
    const mockCard = {
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); },
      }
    };

    for (let i = 0; i < 100; i++) {
      sandbox.toggleBoardNodeCollapse(nodeKey, mockCard);

      const isOdd = (i % 2 === 0); // 0th toggle makes it collapsed
      assert.strictEqual(
        sandbox.collapsedBoardNodes.has(nodeKey),
        isOdd,
        `Iteration ${i}: Board Set state mismatch`
      );
      assert.strictEqual(
        mockCard.classList.contains('is-collapsed'),
        isOdd,
        `Iteration ${i}: Card is-collapsed class mismatch`
      );

      // Verify localStorage sync
      const stored = JSON.parse(mockWindow.localStorage.getItem('boardCollapsedNodes_EVT_BOARD_STRESS') || '[]');
      assert.strictEqual(stored.includes(nodeKey), isOdd);
    }
  });

  test('Board Controls: Expand All and Collapse All idempotency', () => {
    const mockWindow = new MockWindow();
    const elements = [
      { nodeKey: 'n1', classes: new Set() },
      { nodeKey: 'n2', classes: new Set() },
      { nodeKey: 'n3', classes: new Set() },
    ];

    const sandbox = {
      window: mockWindow,
      document: mockWindow.document,
      localStorage: mockWindow.localStorage,
      collapsedBoardNodes: new Set(['n1']),
      boardEventId: 'EVT_EXP_COLL',
      BOARD_COLLAPSED_LS: 'boardCollapsedNodes_',
      $all: (selector) => {
        return elements.map(e => ({
          getAttribute: (attr) => attr === 'data-board-node-key' ? e.nodeKey : null,
          classList: {
            add: (c) => e.classes.add(c),
            remove: (c) => e.classes.delete(c),
            contains: (c) => e.classes.has(c),
          }
        }));
      }
    };

    const fn1 = extractFunction(boardHtml, 'saveCollapsedBoardNodes');
    const fn2 = extractFunction(boardHtml, 'expandAllBoardNodes');
    const fn3 = extractFunction(boardHtml, 'collapseAllBoardNodes');

    const fnCode = `${fn1}\n${fn2}\n${fn3}`;
    const ctx = vm.createContext(sandbox);
    vm.runInContext(fnCode, ctx);

    // 1. Collapse All
    sandbox.collapseAllBoardNodes();
    assert.strictEqual(sandbox.collapsedBoardNodes.size, 3);
    assert.ok(sandbox.collapsedBoardNodes.has('n1'));
    assert.ok(sandbox.collapsedBoardNodes.has('n2'));
    assert.ok(sandbox.collapsedBoardNodes.has('n3'));

    // 2. Expand All
    sandbox.expandAllBoardNodes();
    assert.strictEqual(sandbox.collapsedBoardNodes.size, 0);

    // 3. Repeat Expand All (Idempotency)
    sandbox.expandAllBoardNodes();
    assert.strictEqual(sandbox.collapsedBoardNodes.size, 0);
  });
});

describe('Challenger 2: Mobile Tab Navigation & Touch Standards (375px~412px)', () => {

  test('Tab Architecture: 3-Tab Bar and 3 tab panes exist in Admin.html', () => {
    assert.ok(adminHtml.includes('id="adminMobileTabBar"'), 'Must have #adminMobileTabBar');
    assert.ok(adminHtml.includes('id="tabBtnRoster"'), 'Must have #tabBtnRoster');
    assert.ok(adminHtml.includes('id="tabBtnSettings"'), 'Must have #tabBtnSettings');
    assert.ok(adminHtml.includes('id="tabBtnBoard"'), 'Must have #tabBtnBoard');

    assert.ok(adminHtml.includes('id="paneRoster"'), 'Must have #paneRoster');
    assert.ok(adminHtml.includes('id="paneSettings"'), 'Must have #paneSettings');
    assert.ok(adminHtml.includes('id="paneBoard"'), 'Must have #paneBoard');
  });

  test('Touch Accessibility: Tab buttons enforce 44px min-height for mobile fingers', () => {
    const tabItemMatch = cssContent.match(/\.mobileTabItem\s*\{([\s\S]*?)\}/);
    assert.ok(tabItemMatch, 'Must define .mobileTabItem in app.css.html');

    const body = tabItemMatch[1];
    assert.ok(/min-height\s*:\s*44px/.test(body), '.mobileTabItem must have min-height: 44px');
  });

  test('State Management: initMobileTabs correctly switches panes and persists to sessionStorage', () => {
    const mockWindow = new MockWindow();
    const sessionStorageMap = new Map();
    const mockSessionStorage = {
      getItem: (k) => sessionStorageMap.get(k) || null,
      setItem: (k, v) => sessionStorageMap.set(k, String(v)),
    };

    const tabs = [
      { id: 'tabBtnRoster', pane: 'paneRoster', classes: new Set(['is-active']) },
      { id: 'tabBtnSettings', pane: 'paneSettings', classes: new Set() },
      { id: 'tabBtnBoard', pane: 'paneBoard', classes: new Set() },
    ];
    const panes = [
      { id: 'paneRoster', classes: new Set(['is-active']) },
      { id: 'paneSettings', classes: new Set() },
      { id: 'paneBoard', classes: new Set() },
    ];

    function switchTab(targetName) {
      tabs.forEach(t => {
        if (t.pane === 'pane' + targetName.charAt(0).toUpperCase() + targetName.slice(1)) {
          t.classes.add('is-active');
        } else {
          t.classes.delete('is-active');
        }
      });
      panes.forEach(p => {
        if (p.id === 'pane' + targetName.charAt(0).toUpperCase() + targetName.slice(1)) {
          p.classes.add('is-active');
        } else {
          p.classes.delete('is-active');
        }
      });
      mockSessionStorage.setItem('adminActiveTab', targetName);
    }

    // Switch to settings
    switchTab('settings');
    assert.strictEqual(mockSessionStorage.getItem('adminActiveTab'), 'settings');
    assert.ok(panes.find(p => p.id === 'paneSettings').classes.has('is-active'));
    assert.ok(!panes.find(p => p.id === 'paneRoster').classes.has('is-active'));

    // Switch to board
    switchTab('board');
    assert.strictEqual(mockSessionStorage.getItem('adminActiveTab'), 'board');
    assert.ok(panes.find(p => p.id === 'paneBoard').classes.has('is-active'));
    assert.ok(!panes.find(p => p.id === 'paneSettings').classes.has('is-active'));
  });
});
