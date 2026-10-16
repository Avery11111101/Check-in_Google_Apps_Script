// tests/tier1-features/02_claspignore_isolation.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Tier 1: Clasp Deployment Isolation', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const claspIgnorePath = path.join(projectRoot, '.claspignore');
  const claspJsonPath = path.join(projectRoot, '.clasp.json');

  test('.claspignore must exist at project root', () => {
    assert.ok(fs.existsSync(claspIgnorePath), '.claspignore file must exist at project root');
  });

  test('.claspignore must exclude tests, package.json, .agents, and markdown files', () => {
    const content = fs.readFileSync(claspIgnorePath, 'utf8');
    const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

    const requiredPatterns = [
      'tests/**',
      'package.json',
      '.agents/**',
      '*.md',
    ];

    for (const pat of requiredPatterns) {
      const matched = lines.some(line => line === pat || line.includes(pat.replace(/\*/g, '')));
      assert.ok(matched, `.claspignore must include pattern: ${pat}`);
    }
  });

  test('.clasp.json must exist with valid scriptId', () => {
    assert.ok(fs.existsSync(claspJsonPath), '.clasp.json file must exist');
    const json = JSON.parse(fs.readFileSync(claspJsonPath, 'utf8'));
    assert.ok(json.scriptId, '.clasp.json must contain scriptId');
  });
});
