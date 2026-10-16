// tests/tier1-features/08_mobile_status_view.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Tier 1: [Mobile & Status] Viewport Meta Tag & Single Card Status Badge', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const codeGsPath = path.join(projectRoot, 'Code.gs');
  const checkinHtmlPath = path.join(projectRoot, 'Checkin.html');
  const cssPath = path.join(projectRoot, 'app.css.html');

  test('Code.gs doGet responses must set viewport meta tag for mobile scaling', () => {
    assert.ok(fs.existsSync(codeGsPath), 'Code.gs must exist');
    const code = fs.readFileSync(codeGsPath, 'utf8');

    // Count occurrences of addMetaTag('viewport', 'width=device-width, initial-scale=1')
    const matches = code.match(/\.addMetaTag\(\s*['"]viewport['"]\s*,\s*['"]width=device-width,\s*initial-scale=1['"]\s*\)/g);
    assert.ok(matches, 'Must contain addMetaTag for viewport');
    assert.ok(matches.length >= 4, `Expected at least 4 addMetaTag calls in doGet paths, found ${matches.length}`);
  });

  test('Checkin.html contains inline status badge in name label and removed separate statusBox card', () => {
    assert.ok(fs.existsSync(checkinHtmlPath), 'Checkin.html must exist');
    const html = fs.readFileSync(checkinHtmlPath, 'utf8');

    // Must have statusBadge, statusDot, statusLabelText
    assert.ok(html.includes('id="statusBadge"'), 'Must have statusBadge element');
    assert.ok(html.includes('id="statusDot"'), 'Must have statusDot element');
    assert.ok(html.includes('id="statusLabelText"'), 'Must have statusLabelText element');

    // Must NOT have standalone status card or statusBox div
    assert.ok(!html.includes('id="statusBox"'), 'Must remove legacy separate statusBox element');
    assert.ok(!html.includes('<h2>目前狀態</h2>'), 'Must remove legacy separate "目前狀態" heading');
  });

  test('app.css.html contains 70% container width for checkin page and mobile adaptation', () => {
    assert.ok(fs.existsSync(cssPath), 'app.css.html must exist');
    const css = fs.readFileSync(cssPath, 'utf8');

    // Must have .page-checkin .container width: 70%
    assert.match(css, /\.page-checkin\s+\.container\s*\{[^}]*width:\s*70%/, 'Checkin container must be 70% width');
    assert.match(css, /\.page-checkin\s+\.container\s*\{[^}]*max-width:\s*960px/, 'Checkin container max-width must be 960px');

    // Must have mobile media query
    assert.match(css, /@media\s*\([^)]*max-width:\s*768px\)[^}]*\{[^}]*\.page-checkin\s+\.container\s*\{[^}]*width:\s*100%/, 'Must set 100% width on mobile');

    // Must have overflow-x: hidden on html, body
    assert.match(css, /overflow-x:\s*hidden/, 'html, body must enforce overflow-x: hidden');
  });
});
