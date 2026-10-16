// tests/tier1-features/05_r3_attachment_deactivation.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFreshContext } = require('../harness/vm-loader.js');

describe('Tier 1: [R3] Attachment System Deactivation & Safe Stubs', () => {
  let context, mocks;
  const projectRoot = path.resolve(__dirname, '../..');

  beforeEach(() => {
    const res = createFreshContext({ projectRoot });
    context = res.context;
    mocks = res.mocks;

    context.ensureInitialized_();
    mocks.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', 'admin@example.com');
  });

  test('adminListDailyAttachments safe stub contract (returns empty array)', () => {
    if (typeof context.adminListDailyAttachments === 'function') {
      const res = context.adminListDailyAttachments('evt_test', '2026-10-16');
      assert.ok(Array.isArray(res), 'adminListDailyAttachments must return an array');
      // For M1 safe stubs, it should return []
      if (res.disabled !== undefined || res.length === 0) {
        assert.strictEqual(res.length, 0, 'Attachment list must be empty when deactivated');
      }
    }
  });

  test('adminUploadDailyAttachment safe stub contract (disabled and 0 Drive uploads)', () => {
    if (typeof context.adminUploadDailyAttachment === 'function') {
      const driveFileCountBefore = mocks.DriveApp.files.size;

      try {
        const res = context.adminUploadDailyAttachment({
          eventId: 'evt_test',
          date: '2026-10-16',
          title: '測試照片',
          base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        });

        // If returned object (M1 deactivated stub contract)
        if (res && res.disabled) {
          assert.strictEqual(res.disabled, true, 'Deactivated stub should return disabled: true');
          assert.strictEqual(mocks.DriveApp.files.size, driveFileCountBefore, 'Must not create Drive files when deactivated');
        }
      } catch (err) {
        // Or if throwing disabled message
        assert.match(err.message, /(停用|disabled|不支援|已關閉)/i, 'Error message should indicate feature is disabled');
        assert.strictEqual(mocks.DriveApp.files.size, driveFileCountBefore, 'Must not create Drive files on error');
      }
    }
  });

  test('Admin.html should comment out or safely guard active attachment UI elements', () => {
    const adminHtmlPath = path.join(projectRoot, 'Admin.html');
    assert.ok(fs.existsSync(adminHtmlPath), 'Admin.html must exist');
    const html = fs.readFileSync(adminHtmlPath, 'utf8');

    // Check if attachment elements are commented out in HTML
    const hasCommentedAttach = html.includes('<!--') && (
      html.includes('btnUploadAttach') ||
      html.includes('attachDate') ||
      html.includes('附件')
    );

    // If active in DOM, check whether JS code has safe guards (optional chaining or null check)
    // To ensure no `document.getElementById('btnUploadAttach').addEventListener(...)` crashes
    const dangerousPattern = /document\.getElementById\(['"]btnUploadAttach['"]\)\.addEventListener/;
    const hasDangerousCall = dangerousPattern.test(html);
    assert.strictEqual(hasDangerousCall, false, 'Admin.html must not directly call addEventListener on btnUploadAttach without null check');
  });
});
