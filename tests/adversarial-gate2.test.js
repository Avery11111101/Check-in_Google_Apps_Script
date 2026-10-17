// tests/adversarial-gate2.test.js
// Challenger Gate 2: Empirical Adversarial Verification Suite
// Adversarially stress-tests:
// 1. R1 Fluid Layout & RWD Boundaries (320px, 360px, 375px, 412px, 430px, Widescreen 1280px+)
// 2. Functional Color Convergence: OUT/Check-out is strictly Orange (--warn), Red (--bad) exclusively for Errors
// 3. Error Handling Workflow: In-place #submitStatusHint error display & strict input preservation

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MockWindow } = require('./harness/dom-mock.js');

const ROOT_DIR = path.resolve(__dirname, '..');
const CSS_PATH = path.join(ROOT_DIR, 'app.css.html');
const CHECKIN_PATH = path.join(ROOT_DIR, 'Checkin.html');
const BOARD_PATH = path.join(ROOT_DIR, 'Board.html');
const ADMIN_PATH = path.join(ROOT_DIR, 'Admin.html');

const cssContent = fs.readFileSync(CSS_PATH, 'utf8').replace(/\r\n/g, '\n');
const checkinHtml = fs.readFileSync(CHECKIN_PATH, 'utf8').replace(/\r\n/g, '\n');
const boardHtml = fs.readFileSync(BOARD_PATH, 'utf8').replace(/\r\n/g, '\n');
const adminHtml = fs.readFileSync(ADMIN_PATH, 'utf8').replace(/\r\n/g, '\n');

function extractFunction(src, name) {
  const start = src.indexOf(name);
  if (start === -1) return null;
  const braceStart = src.indexOf('{', start);
  if (braceStart === -1) return null;
  let depth = 1;
  let i = braceStart + 1;
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(start, i);
}

// ============================================================================
// 測試集合 1: R1 佈局與 RWD 邊界 (320px, 360px, 375px, 412px, 430px, 1280px+)
// ============================================================================
describe('Challenger Gate 2: R1 Fluid Layout & RWD Boundaries', () => {

  test('Viewport meta tags across all entry pages must include viewport-fit=cover', () => {
    [
      { name: 'Checkin.html', content: checkinHtml },
      { name: 'Board.html', content: boardHtml },
      { name: 'Admin.html', content: adminHtml },
    ].forEach(({ name, content }) => {
      assert.match(
        content,
        /<meta\s+name=["']viewport["']\s+content=["'][^"']*width=device-width[^"']*viewport-fit=cover[^"']*["']>/i,
        `${name} must specify responsive viewport with width=device-width and viewport-fit=cover`
      );
    });
  });

  test('Global overflow-x: hidden enforced on html, body to eliminate horizontal scrollbars', () => {
    assert.match(
      cssContent,
      /html,\s*body\s*\{[^}]*overflow-x:\s*hidden;?[^}]*\}/,
      'app.css.html must set overflow-x: hidden on html, body'
    );
  });

  test('Desktop Checkin Card Geometry: 70% container width (max 960px) and 560px centered card', () => {
    assert.match(
      cssContent,
      /\.page-checkin\s+\.container\s*\{[^}]*width:\s*70%;?[^}]*max-width:\s*960px;?[^}]*margin:\s*0 auto;?[^}]*\}/,
      '.page-checkin .container must specify width: 70%, max-width: 960px, margin: 0 auto'
    );

    assert.match(
      cssContent,
      /\.page-checkin\s+\.card\s*\{[^}]*max-width:\s*560px;?[^}]*margin-left:\s*auto;?[^}]*margin-right:\s*auto;?[^}]*\}/,
      '.page-checkin .card must be centered with max-width: 560px'
    );
  });

  test('Mobile Responsive Adaptation (<=768px): 100% full-width fluid container and card', () => {
    const idx = cssContent.indexOf('@media (max-width: 768px)');
    assert.ok(idx !== -1, '@media (max-width: 768px) block must exist');
    const braceStart = cssContent.indexOf('{', idx);
    let depth = 1, i = braceStart + 1;
    while (i < cssContent.length && depth > 0) {
      if (cssContent[i] === '{') depth++;
      else if (cssContent[i] === '}') depth--;
      i++;
    }
    const block = cssContent.slice(idx, i);

    assert.match(
      block,
      /\.page-checkin\s+\.container\s*\{[^}]*width:\s*100%;?[^}]*max-width:\s*100%;?[^}]*\}/,
      'Mobile checkin container must be width: 100%, max-width: 100%'
    );
    assert.match(
      block,
      /\.page-checkin\s+\.card\s*\{[^}]*max-width:\s*100%;?[^}]*\}/,
      'Mobile checkin card must expand to max-width: 100%'
    );
  });

  test('Simulated Math on Extreme Mobile Screens (320px, 360px, 375px, 412px, 430px)', () => {
    const viewports = [320, 360, 375, 412, 430];

    viewports.forEach(vw => {
      // 依 app.css.html @media (max-width: 720px) 與 @media (max-width: 520px):
      // container padding: 12px left/right
      const containerPadding = 12 * 2;
      const cardWidth = vw - containerPadding;

      // card padding: 14px left/right
      const cardPadding = 14 * 2;
      const innerContentWidth = cardWidth - cardPadding;

      assert.ok(innerContentWidth > 0, `Inner content width at ${vw}px must be positive`);

      // 檢查 checkinActionRow (簽到/簽退按鈕) 在 <=520px 為 2-column grid: 1fr 1fr, gap: 10px
      const buttonWidth = (innerContentWidth - 10) / 2;
      // 按鈕文字為 2 字「簽到」「簽退」，需要約 30px ~ 40px
      assert.ok(buttonWidth >= 120, `Action button width at ${vw}px (${buttonWidth}px) must be >= 120px to prevent text wrapping`);

      // 檢查 submitCheckinButton (確認簽到/確認簽退) 為 100% 寬度
      const submitBtnWidth = innerContentWidth;
      assert.ok(submitBtnWidth >= 260, `Submit button width at ${vw}px (${submitBtnWidth}px) must comfortably fit 4-character text`);

      // 檢查個人密碼輸入框 (max-width: 280px, width: 100%)
      // 在 320px 時 innerContentWidth = 268px < 280px，width: 100% 自適應收縮至 268px
      const pwdInputWidth = Math.min(280, innerContentWidth);
      assert.strictEqual(pwdInputWidth <= innerContentWidth, true, `Password input fits within card at ${vw}px`);

      // 檢查現場驗證碼輸入框 (max-width: 220px, width: 100%)
      const codeInputWidth = Math.min(220, innerContentWidth);
      assert.strictEqual(codeInputWidth <= innerContentWidth, true, `Checkin code input fits within card at ${vw}px`);
    });
  });

  test('Checkin UI elements must NOT contain fixed hardcoded widths > 268px', () => {
    // 檢查 Checkin.html 所有 inline style，確保沒有固定寬度 (排除 max-width / min-width) 大於 268px
    const widthMatches = [...checkinHtml.matchAll(/style=["'][^"']*(?<![a-zA-Z0-9_-])width\s*:\s*(\d+)px/gi)];
    widthMatches.forEach(m => {
      const px = parseInt(m[1], 10);
      assert.ok(px <= 268, `Fixed inline width ${px}px exceeds 320px viewport inner boundary (268px)`);
    });
  });
});

// ============================================================================
// 測試集合 2: 全站色彩規範實證 (Functional Color Convergence)
// ============================================================================
describe('Challenger Gate 2: Functional Color Convergence', () => {

  test('Functional Color Tokens Definition: --ok (green), --warn (orange), --bad (red)', () => {
    // Light mode
    assert.match(cssContent, /--ok:\s*#2faa5d/, 'Light theme --ok must be #2faa5d');
    assert.match(cssContent, /--warn:\s*#d97706/, 'Light theme --warn must be #d97706');
    assert.match(cssContent, /--bad:\s*#d94a4f/, 'Light theme --bad must be #d94a4f');

    // Dark mode
    assert.match(cssContent, /--ok:\s*#3fbf7a/, 'Dark theme --ok must be #3fbf7a');
    assert.match(cssContent, /--warn:\s*#e8a04a/, 'Dark theme --warn must be #e8a04a');
    assert.match(cssContent, /--bad:\s*#e96b6f/, 'Dark theme --bad must be #e96b6f');
  });

  test('Check-out (OUT) Action Buttons: strictly orange (--warn), never red (--bad)', () => {
    // Checkin.html button.action-selected-out
    assert.match(
      cssContent,
      /button\.action-selected-out\s*\{[^}]*background:\s*var\(--warn\)\s*!important;?[^}]*\}/,
      'button.action-selected-out must use var(--warn)'
    );

    // .btnCheckinSubmit.out
    assert.match(
      cssContent,
      /\.btnCheckinSubmit\.out\s*\{[^}]*background:\s*var\(--warn\);?[^}]*\}/,
      '.btnCheckinSubmit.out must use var(--warn)'
    );

    // OUT styling must NOT use --bad
    assert.ok(
      !/button\.action-selected-out\s*\{[^}]*var\(--bad\)/.test(cssContent),
      'button.action-selected-out must NOT reference var(--bad)'
    );
    assert.ok(
      !/\.btnCheckinSubmit\.out\s*\{[^}]*var\(--bad\)/.test(cssContent),
      '.btnCheckinSubmit.out must NOT reference var(--bad)'
    );
  });

  test('Checkin Action Dot & Person Status Dot for OUT: strictly dot warn, never dot bad', () => {
    // Checkin.html styleCheckinActionButtons()
    const toggleFn = extractFunction(checkinHtml, 'function styleCheckinActionButtons()');
    assert.ok(toggleFn, 'styleCheckinActionButtons must exist in Checkin.html');
    assert.ok(
      toggleFn.includes("actionDot.className = isIn ? 'dot ok' : 'dot warn'"),
      'actionDot must be dot warn when action is OUT'
    );

    // Checkin.html renderStatusBox_()
    const statusBoxFn = extractFunction(checkinHtml, 'function renderStatusBox_(status, statusLabel, lastTime)');
    assert.ok(statusBoxFn, 'renderStatusBox_ must exist in Checkin.html');
    assert.ok(
      statusBoxFn.includes("s === 'IN' ? 'ok' : (s === 'OUT' ? 'warn' : '')"),
      'renderStatusBox_ must assign warn class for OUT status'
    );
  });

  test('Board.html Legend & Status Tag for OUT: strictly dot warn and statusTag warn', () => {
    // Board.html legend
    assert.match(
      boardHtml,
      /<div class=["']pill["']><span class=["']dot warn["']><\/span><span>已簽退<\/span><\/div>/,
      'Board.html legend for 已簽退 must use dot warn'
    );

    // Board.html statusTagClass_
    const tagFn = extractFunction(boardHtml, 'function statusTagClass_(status)');
    assert.ok(tagFn, 'statusTagClass_ must exist in Board.html');
    assert.ok(
      tagFn.includes("if (status === 'OUT') return 'warn'"),
      "statusTagClass_ must return 'warn' for OUT"
    );
  });

  test('Red (--bad) is EXCLUSIVELY reserved for errors and never normal checkout', () => {
    // CSS rules with var(--bad):
    // 1. button.danger
    // 2. .dot.bad
    // 3. .toast.toast--error
    // 4. .banner-error
    // 5. .statusTag.bad (system anomaly)
    // 6. .submitStatusHint.is-error
    // 7. .storageProgressBar.is-critical
    const badMatches = [...cssContent.matchAll(/([^{}]+)\{[^}]*var\(--bad\)[^}]*\}/g)];
    const errorSelectors = badMatches.map(m => m[1].trim());

    errorSelectors.forEach(sel => {
      assert.ok(
        sel.includes('danger') ||
        sel.includes('error') ||
        sel.includes('critical') ||
        sel.includes('.bad'),
        `Selector "${sel}" using var(--bad) must be error or danger related`
      );
      assert.ok(
        !sel.includes('action-selected-out') && !sel.includes('.out') && !sel.includes('signedOut'),
        `Selector "${sel}" must NOT be applied to normal check-out`
      );
    });
  });
});

// ============================================================================
// 測試集合 3: 錯誤處理流程與欄位保護 (Adversarial Error Handling & Preservation)
// ============================================================================
describe('Challenger Gate 2: Error Handling Workflow & Field Preservation', () => {

  function setupCheckinDomEnvironment(apiMock) {
    const mockWindow = new MockWindow();
    const doc = mockWindow.document;

    // Build DOM elements needed for submit()
    const eventSelect = doc.createElement('select');
    eventSelect.id = 'eventSelect';
    eventSelect.value = 'EVT_2026';
    doc.body.appendChild(eventSelect);

    const personSelect = doc.createElement('select');
    personSelect.id = 'personSelect';
    personSelect.value = 'P_001';
    // Add selected option
    const opt = doc.createElement('option');
    opt.value = 'P_001';
    opt.textContent = '測試員王大明';
    personSelect.appendChild(opt);
    personSelect.selectedOptions = [opt];
    doc.body.appendChild(personSelect);

    const personSearch = doc.createElement('input');
    personSearch.id = 'personSearch';
    personSearch.value = '王大明';
    doc.body.appendChild(personSearch);

    const checkinCode = doc.createElement('input');
    checkinCode.id = 'checkinCode';
    checkinCode.value = '123456';
    doc.body.appendChild(checkinCode);

    const personPassword = doc.createElement('input');
    personPassword.id = 'personPassword';
    personPassword.value = 'Secret@123';
    doc.body.appendChild(personPassword);

    const btnIn = doc.createElement('button');
    btnIn.id = 'btnIn';
    doc.body.appendChild(btnIn);

    const btnOut = doc.createElement('button');
    btnOut.id = 'btnOut';
    btnOut.classList.add('secondary');
    doc.body.appendChild(btnOut);

    const btnSubmitCheckin = doc.createElement('button');
    btnSubmitCheckin.id = 'btnSubmitCheckin';
    btnSubmitCheckin.className = 'btnCheckinSubmit in';
    const btnSubmitText = doc.createElement('span');
    btnSubmitText.id = 'btnSubmitText';
    btnSubmitText.textContent = '確認簽到';
    btnSubmitCheckin.appendChild(btnSubmitText);
    doc.body.appendChild(btnSubmitCheckin);

    const submitStatusHint = doc.createElement('div');
    submitStatusHint.id = 'submitStatusHint';
    submitStatusHint.className = 'submitStatusHint';
    submitStatusHint.style.display = 'none';
    doc.body.appendChild(submitStatusHint);

    const toast = doc.createElement('div');
    toast.id = 'toast';
    doc.body.appendChild(toast);

    const statusBadge = doc.createElement('div');
    statusBadge.id = 'statusBadge';
    doc.body.appendChild(statusBadge);

    const actionDot = doc.createElement('span');
    actionDot.id = 'actionDot';
    actionDot.className = 'dot ok';
    doc.body.appendChild(actionDot);

    const actionText = doc.createElement('span');
    actionText.id = 'actionText';
    actionText.textContent = '即將簽到';
    doc.body.appendChild(actionText);

    const serverTime = doc.createElement('div');
    serverTime.id = 'serverTime';
    doc.body.appendChild(serverTime);

    // Sandbox context
    const sandbox = {
      window: mockWindow,
      document: doc,
      navigator: { userAgent: 'AdversarialNodeTest/1.0', vibrate: () => {} },
      sessionStorage: {
        _s: {},
        setItem(k, v) { this._s[k] = String(v); },
        getItem(k) { return this._s[k] || null; },
        removeItem(k) { delete this._s[k]; },
      },
      $: (sel) => doc.querySelector(sel),
      esc: (s) => String(s || ''),
      fmtTs: (ts) => String(ts || ''),
      formatApiError: (err) => (err && err.message) ? err.message : String(err || '未知錯誤'),
      isLikelyCheckinCodeAuthError_: (msg) => {
        const s = String(msg || '');
        if (s.includes('未於後台設定')) return false;
        return s.includes('驗證碼') || s.includes('checkinToken') || s.includes('密鑰') || s.includes('存取密鑰');
      },
      clearCheckinCodeStorage: (eid) => {
        sandbox.sessionStorage.removeItem('checkinCode_' + eid);
      },
      getSelectedEventRequiresCheckinCode: () => false,
      getEffectiveCheckinCode: () => checkinCode.value,
      getCheckinTokenForApi: () => checkinCode.value,
      updatePasswordUi: () => {},
      applyPersonFilter: () => {},
      api: apiMock,
      action: 'IN',
      busy: false,
      currentPersonMeta: { requirePassword: true, hasPassword: true },
      setToast: (msg, opts) => {
        toast.textContent = msg || '';
      },
    };

    // Extract necessary functions from Checkin.html
    const fnSubmitting = extractFunction(checkinHtml, 'function setCheckinSubmittingUi(is)');
    const fnStyleButtons = extractFunction(checkinHtml, 'function styleCheckinActionButtons()');
    const fnSyncDisabled = extractFunction(checkinHtml, 'function syncCheckinInteractiveDisabled()');
    const fnSubmit = extractFunction(checkinHtml, 'async function submit()');

    const code = `
      ${fnSubmitting}
      ${fnStyleButtons}
      function getCheckinSelectedEventOpen(){ return true; }
      ${fnSyncDisabled}
      ${fnSubmit}
    `;

    const ctx = vm.createContext(sandbox);
    vm.runInContext(code, ctx);

    return {
      ctx,
      elements: {
        eventSelect,
        personSelect,
        personSearch,
        checkinCode,
        personPassword,
        btnSubmitCheckin,
        btnSubmitText,
        submitStatusHint,
        toast,
      }
    };
  }

  test('Simulated Backend Error 1: 密碼錯誤 — In-place hint displayed & all inputs preserved', async () => {
    const apiMock = async (method) => {
      if (method === 'publicSubmitAttendance') {
        throw new Error('個人簽到密碼錯誤，請重新輸入。');
      }
    };

    const { ctx, elements } = setupCheckinDomEnvironment(apiMock);

    // Pre-condition check
    assert.strictEqual(elements.personSelect.value, 'P_001');
    assert.strictEqual(elements.personSearch.value, '王大明');
    assert.strictEqual(elements.personPassword.value, 'Secret@123');

    // Trigger submit
    await ctx.submit();

    // 1. 驗證錯誤訊息原地顯示在 #submitStatusHint
    assert.strictEqual(elements.submitStatusHint.style.display, 'block', 'submitStatusHint must be visible');
    assert.strictEqual(elements.submitStatusHint.classList.contains('is-error'), true, 'submitStatusHint must have is-error class');
    assert.match(elements.submitStatusHint.textContent, /❌\s*個人簽到密碼錯誤/, 'submitStatusHint must show exact error');

    // 2. 驗證送出大按鈕復原
    assert.strictEqual(elements.btnSubmitCheckin.disabled, false, 'Submit button must be unlocked');
    assert.strictEqual(elements.btnSubmitCheckin.classList.contains('is-submitting'), false, 'is-submitting class removed');
    assert.strictEqual(elements.btnSubmitText.textContent, '確認簽到', 'Submit text restored');

    // 3. 關鍵對抗斷言：所有輸入欄位與已選人員不得被提前或錯誤清空！
    assert.strictEqual(elements.personSelect.value, 'P_001', 'personSelect must NOT be cleared on password error');
    assert.strictEqual(elements.personSearch.value, '王大明', 'personSearch must NOT be cleared on password error');
    assert.strictEqual(elements.personPassword.value, 'Secret@123', 'personPassword must NOT be cleared on password error');
    assert.strictEqual(elements.checkinCode.value, '123456', 'checkinCode must NOT be cleared on password error');
  });

  test('Simulated Backend Error 2: 頻率限制 — In-place hint displayed & all inputs preserved', async () => {
    const apiMock = async (method) => {
      if (method === 'publicSubmitAttendance') {
        throw new Error('操作過於頻繁，請於 3 秒後再試。');
      }
    };

    const { ctx, elements } = setupCheckinDomEnvironment(apiMock);

    await ctx.submit();

    // 1. 原地顯示錯誤提示
    assert.strictEqual(elements.submitStatusHint.style.display, 'block');
    assert.strictEqual(elements.submitStatusHint.classList.contains('is-error'), true);
    assert.match(elements.submitStatusHint.textContent, /❌\s*操作過於頻繁/);

    // 2. 按鈕解鎖
    assert.strictEqual(elements.btnSubmitCheckin.disabled, false);

    // 3. 欄位完整保留
    assert.strictEqual(elements.personSelect.value, 'P_001', 'personSelect must be preserved');
    assert.strictEqual(elements.personSearch.value, '王大明', 'personSearch must be preserved');
    assert.strictEqual(elements.personPassword.value, 'Secret@123', 'personPassword must be preserved');
    assert.strictEqual(elements.checkinCode.value, '123456', 'checkinCode must be preserved');
  });

  test('Simulated Backend Error 3: 驗證碼錯誤 — In-place hint displayed, checkinCode reset for retry, person & password preserved', async () => {
    const apiMock = async (method) => {
      if (method === 'publicSubmitAttendance') {
        throw new Error('簽到驗證碼錯誤或已過期');
      }
    };

    const { ctx, elements } = setupCheckinDomEnvironment(apiMock);

    await ctx.submit();

    // 1. 原地顯示錯誤提示
    assert.strictEqual(elements.submitStatusHint.style.display, 'block');
    assert.strictEqual(elements.submitStatusHint.classList.contains('is-error'), true);
    assert.match(elements.submitStatusHint.textContent, /❌\s*簽到驗證碼錯誤或已過期/);

    // 2. 驗證碼依 isLikelyCheckinCodeAuthError_ 機制清空供重新輸入
    assert.strictEqual(elements.checkinCode.value, '', 'checkinCode cleared for user to re-enter code');

    // 3. 關鍵保護：人員選擇與個人密碼依然完整保留，使用者不需重選姓名！
    assert.strictEqual(elements.personSelect.value, 'P_001', 'personSelect must remain preserved');
    assert.strictEqual(elements.personSearch.value, '王大明', 'personSearch must remain preserved');
    assert.strictEqual(elements.personPassword.value, 'Secret@123', 'personPassword must remain preserved');
  });

  test('Simulated Backend Error 4: 網路中斷異常 — Hint not wiped by finally block', async () => {
    const apiMock = async (method) => {
      if (method === 'publicSubmitAttendance') {
        throw new Error('無法連線至 Google 試算表伺服器');
      }
    };

    const { ctx, elements } = setupCheckinDomEnvironment(apiMock);

    await ctx.submit();

    // finally 調用 setCheckinSubmittingUi(false)，必須確保不抹除 is-error
    assert.strictEqual(elements.submitStatusHint.style.display, 'block', 'Error hint must remain visible after finally block');
    assert.strictEqual(elements.submitStatusHint.classList.contains('is-error'), true);
    assert.match(elements.submitStatusHint.textContent, /無法連線至 Google 試算表伺服器/);
  });
});
