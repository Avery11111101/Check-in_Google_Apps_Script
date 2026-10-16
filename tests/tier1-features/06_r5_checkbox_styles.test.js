// tests/tier1-features/06_r5_checkbox_styles.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Tier 1: [R5] Checkbox Styling & Form Layout Verification', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const cssPath = path.join(projectRoot, 'app.css.html');

  test('app.css.html must exist and be readable', () => {
    assert.ok(fs.existsSync(cssPath), 'app.css.html must exist');
  });

  test('Global input rule must not apply 100% width indiscriminately to checkboxes', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    // Check for negative selector on global text input rule
    const hasProperExclusion = (
      css.includes('input:not([type="checkbox"])') ||
      css.includes('input:not([type=\'checkbox\'])')
    );
    assert.ok(hasProperExclusion, 'Global input styling must exclude type="checkbox" using :not([type="checkbox"])');
  });

  test('Explicit input[type="checkbox"] rule must enforce 18px dimensions and flex integrity', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    // Assert explicit 18px dimensions rule exists
    assert.match(css, /input\[type=["']?checkbox["']?\].*?width:\s*18px/s, 'Checkbox must have width: 18px');
    assert.match(css, /input\[type=["']?checkbox["']?\].*?height:\s*18px/s, 'Checkbox must have height: 18px');

    // Assert flex-shrink or flex: 0 0 auto prevents stretch in flex containers
    const hasFlexProtection = (
      css.includes('flex-shrink: 0') ||
      css.includes('flex-shrink:0') ||
      css.includes('flex: 0 0 auto') ||
      css.includes('flex:0 0 auto')
    );
    assert.ok(hasFlexProtection, 'Checkbox must have flex protection (flex-shrink: 0 or flex: 0 0 auto)');
  });

  test('Responsive media query rules (.row > input) must not stretch checkboxes to 100%', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    // Search for .row > input rules in responsive queries
    if (css.includes('.row > input')) {
      const rowInputExclusion = (
        css.includes('.row > input:not([type="checkbox"])') ||
        css.includes('.row > input:not([type=\'checkbox\'])') ||
        css.includes('.row > input[type="checkbox"]')
      );
      assert.ok(rowInputExclusion, '.row > input responsive rules must explicitly safeguard checkbox from 100% stretch');
    }
  });
});
