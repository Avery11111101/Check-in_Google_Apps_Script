// tests/tier1-features/07_r6_classic_tokens.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Tier 1: [R6] Classic Clean Styling Tokens & Mobile Adaptation', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const cssPath = path.join(projectRoot, 'app.css.html');

  test('app.css.html contains classic clean design tokens', () => {
    assert.ok(fs.existsSync(cssPath), 'app.css.html must exist');
    const css = fs.readFileSync(cssPath, 'utf8');

    // Verify --shadow-2 has been reduced from 48px heavy deep shadow
    assert.ok(
      !css.includes('--shadow-2: 0 16px 48px') && !css.includes('--shadow-2: 0 20px 48px'),
      '--shadow-2 must not contain heavy 48px blur spread'
    );

    // Verify --shadow-2 is refined (4px-16px)
    assert.match(css, /--shadow-2:\s*0\s+4px\s+(?:12px|16px)/, '--shadow-2 should use refined 4px-16px shadow');

    // Verify crisp 1px borders are used on surface cards
    assert.match(css, /border:\s*1px\s+solid\s+var\(--border\)/, 'Cards must use 1px solid var(--border)');
  });

  test('Background gradients must not contain overwhelming neon glows', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    // Verify removed giant 720px/680px radial glows in appBg
    const hasGiantRadial = css.includes('radial-gradient(720px') || css.includes('radial-gradient(680px');
    assert.strictEqual(hasGiantRadial, false, '.appBg should not contain overpowering radial-gradient glows');
  });

  test('Mobile responsive styles define classic tab navigation or compact viewports', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    // Verify media query for mobile devices exists
    assert.ok(
      css.includes('@media (max-width: 640px)') ||
      css.includes('@media (max-width: 720px)') ||
      css.includes('@media (max-width: 480px)'),
      'Must contain responsive media queries for mobile viewports'
    );
  });
});
