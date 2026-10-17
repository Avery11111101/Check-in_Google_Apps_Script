// tests/tier1-features/10_checkin_toggle_and_submission.test.js
// Tier 1: [R1-R4] Checkin Toggle Closed-Loop, Honest Submission Workflow & Design Contracts

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MockWindow } = require('../harness/dom-mock.js');

/**
 * 輔助函數：透過大括號層次計數精確擷取完整函數定義
 */
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

describe('Tier 1: [R1-R4] Checkin Toggle Closed-Loop & Honest Submission Workflow', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const checkinHtmlPath = path.join(projectRoot, 'Checkin.html');
  const cssPath = path.join(projectRoot, 'app.css.html');

  let checkinHtml, cssContent;

  beforeEach(() => {
    checkinHtml = fs.readFileSync(checkinHtmlPath, 'utf8').replace(/\r\n/g, '\n');
    cssContent = fs.readFileSync(cssPath, 'utf8').replace(/\r\n/g, '\n');
  });

  // --------------------------------------------------------------------------
  // 測試 1: app.css.html 色彩衝突消除與按鈕樣式合約
  // --------------------------------------------------------------------------
  test('R1 & R2: app.css.html eliminates color collisions on action buttons and defines honest styles', () => {
    // 檢查 button.action-selected-in 不與 button.primary 綁定 accent 色
    assert.ok(
      !cssContent.includes('button.primary,\n  button.action-selected-in') &&
      !cssContent.includes('button.primary, button.action-selected-in') &&
      !cssContent.includes('button.primary,button.action-selected-in'),
      'button.action-selected-in must not be grouped with button.primary (accent color)'
    );

    // 檢查 action-selected-in 為 var(--ok)（機能綠）
    assert.match(
      cssContent,
      /button\.action-selected-in\s*\{[^}]*background:\s*var\(--ok\)/,
      'button.action-selected-in must have background: var(--ok)'
    );

    // 檢查 action-selected-out 為 var(--warn)（機能橘）
    assert.match(
      cssContent,
      /button\.action-selected-out\s*\{[^}]*background:\s*var\(--warn\)/,
      'button.action-selected-out must have background: var(--warn)'
    );

    // 檢查未選中狀態按鈕樣式 (button.action-unselected)
    assert.match(
      cssContent,
      /button\.action-unselected\s*\{/,
      'button.action-unselected rule must exist for unselected state styling'
    );

    // 檢查 btnCheckinSubmit:disabled 與 is-submitting 為中性灰禁用態
    assert.match(
      cssContent,
      /\.btnCheckinSubmit:disabled[\s\S]*?background:\s*var\(--not\)/,
      '.btnCheckinSubmit:disabled must specify neutral gray background var(--not)'
    );

    // 檢查原地狀態反饋容器樣式與狀態類別
    assert.match(cssContent, /\.submitStatusHint\s*\{/, '.submitStatusHint base rule must exist');
    assert.match(cssContent, /\.submitStatusHint\.is-sending\s*\{/, '.submitStatusHint.is-sending rule must exist');
    assert.match(cssContent, /\.submitStatusHint\.is-success\s*\{/, '.submitStatusHint.is-success rule must exist');
    assert.match(cssContent, /\.submitStatusHint\.is-error\s*\{/, '.submitStatusHint.is-error rule must exist');
  });

  // --------------------------------------------------------------------------
  // 測試 2: Checkin.html 簽到/簽退按鈕切換狀態機對稱與 secondary 閉環保護 (10+ 次來回切換)
  // --------------------------------------------------------------------------
  test('R2: Checkin action buttons maintain closed-loop symmetry and secondary retention across 10+ rapid cycles', () => {
    const mockWindow = new MockWindow();
    const doc = mockWindow.document;

    // 建立 DOM 模擬節點
    const btnIn = doc.createElement('button');
    btnIn.id = 'btnIn';
    const btnOut = doc.createElement('button');
    btnOut.id = 'btnOut';
    btnOut.classList.add('secondary'); // 初始依 Checkin.html 帶有 secondary

    const subBtn = doc.createElement('button');
    subBtn.id = 'btnSubmitCheckin';
    const subText = doc.createElement('span');
    subText.id = 'btnSubmitText';
    subBtn.appendChild(subText);

    const actionText = doc.createElement('span');
    actionText.id = 'actionText';
    const actionDot = doc.createElement('span');
    actionDot.id = 'actionDot';

    doc.body.appendChild(btnIn);
    doc.body.appendChild(btnOut);
    doc.body.appendChild(subBtn);
    doc.body.appendChild(actionText);
    doc.body.appendChild(actionDot);

    // 擷取 Checkin.html 中 styleCheckinActionButtons 函數
    const fnCode = extractFunction(checkinHtml, 'function styleCheckinActionButtons()');
    assert.ok(fnCode, 'styleCheckinActionButtons must exist in Checkin.html');

    const sandbox = {
      window: mockWindow,
      document: doc,
      $: (sel) => doc.querySelector(sel),
      action: 'IN',
      busy: false,
    };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(fnCode, ctx);

    // 連續反覆切換 12 輪（共 24 次狀態轉移：IN -> OUT -> IN ...）
    for (let round = 1; round <= 12; round++) {
      // 1. 切換至 IN
      ctx.action = 'IN';
      ctx.styleCheckinActionButtons();

      assert.strictEqual(btnIn.classList.contains('action-selected-in'), true, `[Round ${round}] IN: btnIn has action-selected-in`);
      assert.strictEqual(btnIn.classList.contains('secondary'), false, `[Round ${round}] IN: btnIn must NOT have secondary`);
      assert.strictEqual(btnIn.classList.contains('action-unselected'), false, `[Round ${round}] IN: btnIn must NOT have action-unselected`);

      assert.strictEqual(btnOut.classList.contains('secondary'), true, `[Round ${round}] IN: btnOut MUST retain secondary`);
      assert.strictEqual(btnOut.classList.contains('action-unselected'), true, `[Round ${round}] IN: btnOut must have action-unselected`);
      assert.strictEqual(btnOut.classList.contains('action-selected-out'), false, `[Round ${round}] IN: btnOut must NOT have action-selected-out`);

      assert.strictEqual(subBtn.classList.contains('in'), true, `[Round ${round}] IN: subBtn has in class`);
      assert.strictEqual(subBtn.classList.contains('out'), false, `[Round ${round}] IN: subBtn does not have out class`);
      assert.strictEqual(subText.textContent, '確認簽到', `[Round ${round}] IN: subText is 確認簽到`);
      assert.strictEqual(actionText.textContent, '即將簽到', `[Round ${round}] IN: actionText is 即將簽到`);
      assert.strictEqual(actionDot.className, 'dot ok', `[Round ${round}] IN: actionDot is dot ok`);

      // 2. 切換至 OUT
      ctx.action = 'OUT';
      ctx.styleCheckinActionButtons();

      assert.strictEqual(btnOut.classList.contains('action-selected-out'), true, `[Round ${round}] OUT: btnOut has action-selected-out`);
      assert.strictEqual(btnOut.classList.contains('secondary'), false, `[Round ${round}] OUT: btnOut must NOT have secondary`);
      assert.strictEqual(btnOut.classList.contains('action-unselected'), false, `[Round ${round}] OUT: btnOut must NOT have action-unselected`);

      assert.strictEqual(btnIn.classList.contains('secondary'), true, `[Round ${round}] OUT: btnIn MUST acquire secondary`);
      assert.strictEqual(btnIn.classList.contains('action-unselected'), true, `[Round ${round}] OUT: btnIn must have action-unselected`);
      assert.strictEqual(btnIn.classList.contains('action-selected-in'), false, `[Round ${round}] OUT: btnIn must NOT have action-selected-in`);

      assert.strictEqual(subBtn.classList.contains('out'), true, `[Round ${round}] OUT: subBtn has out class`);
      assert.strictEqual(subBtn.classList.contains('in'), false, `[Round ${round}] OUT: subBtn does not have in class`);
      assert.strictEqual(subText.textContent, '確認簽退', `[Round ${round}] OUT: subText is 確認簽退`);
      assert.strictEqual(actionText.textContent, '即將簽退', `[Round ${round}] OUT: actionText is 即將簽退`);
      assert.strictEqual(actionDot.className, 'dot warn', `[Round ${round}] OUT: actionDot is dot warn`);
    }

    // 驗證最終切回 IN，確認無任何 class 重複堆疊或丟失
    ctx.action = 'IN';
    ctx.styleCheckinActionButtons();
    assert.strictEqual(btnOut.classList.contains('secondary'), true, 'Final IN: btnOut preserves secondary class');
    assert.strictEqual(btnIn.classList.contains('secondary'), false, 'Final IN: btnIn does not have secondary');
  });

  // --------------------------------------------------------------------------
  // 測試 3: setCheckinSubmittingUi 送出時僅鎖定送出大按鈕，其餘欄位絕不上鎖
  // --------------------------------------------------------------------------
  test('R3: setCheckinSubmittingUi locks ONLY the submit button and keeps all other input fields active', () => {
    const mockWindow = new MockWindow();
    const doc = mockWindow.document;

    const btnIn = doc.createElement('button');
    btnIn.id = 'btnIn';
    const btnOut = doc.createElement('button');
    btnOut.id = 'btnOut';
    const subBtn = doc.createElement('button');
    subBtn.id = 'btnSubmitCheckin';
    const hintEl = doc.createElement('div');
    hintEl.id = 'submitStatusHint';

    const personSearch = doc.createElement('input');
    personSearch.id = 'personSearch';
    const personSelect = doc.createElement('select');
    personSelect.id = 'personSelect';
    const checkinCode = doc.createElement('input');
    checkinCode.id = 'checkinCode';
    const personPassword = doc.createElement('input');
    personPassword.id = 'personPassword';

    doc.body.appendChild(btnIn);
    doc.body.appendChild(btnOut);
    doc.body.appendChild(subBtn);
    doc.body.appendChild(hintEl);
    doc.body.appendChild(personSearch);
    doc.body.appendChild(personSelect);
    doc.body.appendChild(checkinCode);
    doc.body.appendChild(personPassword);

    const fnCode = extractFunction(checkinHtml, 'function setCheckinSubmittingUi(is)');
    assert.ok(fnCode, 'setCheckinSubmittingUi must exist in Checkin.html');

    const sandbox = {
      window: mockWindow,
      document: doc,
      $: (sel) => doc.querySelector(sel),
      action: 'IN',
    };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(fnCode, ctx);

    // 1. 觸發送出中狀態 (is = true)
    ctx.setCheckinSubmittingUi(true);

    // 斷言：送出按鈕必須被鎖定為 disabled 且套用 is-submitting 類別
    assert.strictEqual(subBtn.disabled, true, 'Submit button must be disabled during submission');
    assert.strictEqual(subBtn.classList.contains('is-submitting'), true, 'Submit button must have is-submitting class');

    // 斷言：原地提示容器必須顯示且包含傳送中字樣
    assert.strictEqual(hintEl.style.display, 'block', 'submitStatusHint must be visible during submission');
    assert.strictEqual(hintEl.classList.contains('is-sending'), true, 'submitStatusHint must have is-sending class');
    assert.match(hintEl.textContent, /正在傳送|請稍候/, 'submitStatusHint text must inform user of sending in progress');

    // 斷言：其餘輸入欄位與動作切換鈕絕不上鎖（無多餘 disabled）
    assert.strictEqual(btnIn.disabled, false, 'btnIn must NOT be disabled during submission');
    assert.strictEqual(btnOut.disabled, false, 'btnOut must NOT be disabled during submission');
    assert.strictEqual(personSearch.disabled, false, 'personSearch must NOT be disabled during submission');
    assert.strictEqual(personSelect.disabled, false, 'personSelect must NOT be disabled during submission');
    assert.strictEqual(checkinCode.disabled, false, 'checkinCode must NOT be disabled during submission');
    assert.strictEqual(personPassword.disabled, false, 'personPassword must NOT be disabled during submission');

    // 2. 恢復完成狀態 (is = false)
    ctx.setCheckinSubmittingUi(false);
    assert.strictEqual(subBtn.disabled, false, 'Submit button must be unlocked when submission ends');
    assert.strictEqual(subBtn.classList.contains('is-submitting'), false, 'is-submitting class removed');
    assert.strictEqual(hintEl.style.display, 'none', 'submitStatusHint hidden after completion');
  });

  // --------------------------------------------------------------------------
  // 測試 4: Checkin.html 原地即時反饋容器、1.5 秒自動復位與搜尋框連續聚焦
  // --------------------------------------------------------------------------
  test('R3: Successful submission performs in-place feedback, clears name select, and focuses search for continuous check-in', () => {
    // 1. 靜態分析 Checkin.html DOM 結構合約
    assert.ok(
      checkinHtml.includes('id="submitStatusHint"') && checkinHtml.includes('class="submitStatusHint"'),
      'Checkin.html must have #submitStatusHint element in DOM'
    );
    assert.ok(
      checkinHtml.includes('role="status"') && checkinHtml.includes('aria-live="polite"'),
      '#submitStatusHint must have accessible ARIA live attributes'
    );
    assert.ok(
      checkinHtml.includes('showInPlaceSuccessFeedback('),
      'Checkin.html must call showInPlaceSuccessFeedback'
    );
    assert.ok(
      checkinHtml.includes('searchInput.focus()') || checkinHtml.includes('$(\'#personSearch\').focus()'),
      'Checkin.html must focus search input upon successful reset'
    );

    // 2. 動態驗證 showInPlaceSuccessFeedback 邏輯
    const mockWindow = new MockWindow();
    const doc = mockWindow.document;

    const hintEl = doc.createElement('div');
    hintEl.id = 'submitStatusHint';
    doc.body.appendChild(hintEl);

    const fnCode = extractFunction(checkinHtml, 'function showInPlaceSuccessFeedback(personName, submittedAction)');
    assert.ok(fnCode, 'showInPlaceSuccessFeedback function must exist in Checkin.html');

    let capturedTimeoutCb = null;
    let capturedTimeoutDelay = null;
    const fakeSetTimeout = (cb, delay) => {
      capturedTimeoutCb = cb;
      capturedTimeoutDelay = delay;
      return 999;
    };
    const fakeClearTimeout = () => {};

    const sandbox = {
      window: mockWindow,
      document: doc,
      $: (sel) => doc.querySelector(sel),
      esc: (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      setTimeout: fakeSetTimeout,
      clearTimeout: fakeClearTimeout,
      __feedbackTimer: null,
    };
    const ctx = vm.createContext(sandbox);
    vm.runInContext('var __feedbackTimer = null;\n' + fnCode, ctx);

    // 執行簽到成功反饋 (IN)
    ctx.showInPlaceSuccessFeedback('陳大華', 'IN');
    assert.strictEqual(hintEl.style.display, 'block', 'Hint visible on success');
    assert.strictEqual(hintEl.classList.contains('is-success'), true, 'Hint has is-success class');
    assert.match(hintEl.innerHTML, /陳大華/, 'Hint includes attendee name');
    assert.match(hintEl.innerHTML, /簽到成功/, 'Hint specifies check-in success');
    assert.strictEqual(capturedTimeoutDelay, 1500, 'Success feedback timeout must be exactly 1500ms (1.5 seconds)');

    // 執行定時器回呼，驗證自動隱藏復位
    assert.ok(typeof capturedTimeoutCb === 'function', 'Timeout callback scheduled');
    capturedTimeoutCb();
    assert.strictEqual(hintEl.style.display, 'none', 'Hint hidden after 1.5 seconds');

    // 執行簽退成功反饋 (OUT)
    ctx.showInPlaceSuccessFeedback('李小龍', 'OUT');
    assert.match(hintEl.innerHTML, /李小龍/, 'Hint includes attendee name');
    assert.match(hintEl.innerHTML, /簽退成功/, 'Hint specifies check-out success');
    assert.strictEqual(hintEl.classList.contains('is-success'), true, 'Hint has is-success class');
  });

  // --------------------------------------------------------------------------
  // 測試 5: 消除阻斷式全螢幕彈窗，保障極速下一位連續操作體驗
  // --------------------------------------------------------------------------
  test('R3: Eliminates 850ms blocking modal popup in favor of seamless in-place flow', () => {
    // 檢查 showSuccessModal 被重導向至 showInPlaceSuccessFeedback
    const modalFn = extractFunction(checkinHtml, 'function showSuccessModal(displayName, submittedAction, serverTime)');
    assert.ok(modalFn, 'showSuccessModal must exist for backward compatibility');
    assert.ok(
      modalFn.includes('showInPlaceSuccessFeedback'),
      'showSuccessModal must delegate to in-place feedback rather than opening blocking modal'
    );

    // 檢查 submit() 成功路徑中直接調用原地反饋與即時清空聚焦
    const submitFn = extractFunction(checkinHtml, 'async function submit()');
    assert.ok(submitFn, 'submit function must exist in Checkin.html');

    assert.ok(
      submitFn.includes('showInPlaceSuccessFeedback'),
      'submit() success path must call showInPlaceSuccessFeedback'
    );
    assert.ok(
      submitFn.includes('searchInput.focus()'),
      'submit() success path must invoke searchInput.focus() for seamless continuous checkin'
    );
  });

  // --------------------------------------------------------------------------
  // 測試 6: 送出失敗時原地呈現錯誤訊息，且不提前清空已輸入的人員與密碼
  // --------------------------------------------------------------------------
  test('R3: Submission error displays in-place error hint and preserves form inputs for retry', () => {
    const submitFn = extractFunction(checkinHtml, 'async function submit()');
    assert.ok(submitFn, 'submit function must exist in Checkin.html');

    // 檢查 catch 區塊中原地更新 hintEl 為 is-error
    assert.match(
      submitFn,
      /hintEl\.className\s*=\s*['"]submitStatusHint is-error['"]/,
      'Catch block must set submitStatusHint to is-error class'
    );
    assert.match(
      submitFn,
      /hintEl\.textContent\s*=\s*['"]❌\s*['"]\s*\+\s*em/,
      'Catch block must display error symbol and message in hintEl'
    );

    // 檢查在 catch 區塊中未執行清空 personSelect 或 searchInput 的操作
    const catchIndex = submitFn.indexOf('}catch(e){');
    assert.ok(catchIndex !== -1, 'Catch block must exist in submit function');
    const finallyIndex = submitFn.indexOf('}finally{', catchIndex);
    assert.ok(finallyIndex !== -1, 'Finally block must exist in submit function');
    const catchBlock = submitFn.slice(catchIndex, finallyIndex);
    assert.ok(
      !catchBlock.includes("personSelEl.value = ''") &&
      !catchBlock.includes("searchInput.value = ''"),
      'Catch block must NOT erase user inputs upon failure, allowing immediate retry'
    );
  });
});
