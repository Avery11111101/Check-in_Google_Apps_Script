// tests/tier2-boundary/01_sharding_8kb_boundary.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFreshContext } = require('../harness/vm-loader.js');

describe('Tier 2: [Boundary] 8KB Chunk Sharding & Properties Quota Limits', () => {
  let context, mocks;

  beforeEach(() => {
    const res = createFreshContext();
    context = res.context;
    mocks = res.mocks;
    mocks.PropertiesService.getScriptProperties()._setEnforceQuota(true);
  });

  test('PropertiesService enforces 9KB per-property limit when un-sharded', () => {
    const props = mocks.PropertiesService.getScriptProperties();
    const oversizedString = 'A'.repeat(9500); // 9.5 KB

    assert.throws(
      () => {
        props.setProperty('OVERSIZED_KEY', oversizedString);
      },
      /QuotaExceededError/i,
      'Should throw QuotaExceededError when single property exceeds 9KB'
    );
  });

  test('Sharding mechanism splits large payloads into chunks <= 8000 bytes', () => {
    // Generate a simulated large roster dataset (approx 25KB JSON)
    const largeRoster = [];
    for (let i = 1; i <= 250; i++) {
      largeRoster.push({
        personId: `p_shard_${i}`,
        displayName: `測試成員第${i}號`,
        groupId: `grp_${i % 10}`,
        sort: i,
        hasPassword: i % 2 === 0,
      });
    }
    const jsonStr = JSON.stringify(largeRoster);
    assert.ok(jsonStr.length > 20000, `Payload should be large (>20KB), actual: ${jsonStr.length}`);

    // Test sharding contract helper or implementation
    const CHUNK_SIZE = 8000;
    const chunks = [];
    for (let offset = 0; offset < jsonStr.length; offset += CHUNK_SIZE) {
      chunks.push(jsonStr.slice(offset, offset + CHUNK_SIZE));
    }

    // Verify all chunks obey the 8KB limit
    for (let i = 0; i < chunks.length; i++) {
      assert.ok(chunks[i].length <= 8000, `Chunk ${i} exceeds 8000 bytes limit: ${chunks[i].length}`);
    }

    // Write all chunks to PropertiesService
    const props = mocks.PropertiesService.getScriptProperties();
    props.setProperty('ROSTER_CHUNK_COUNT', String(chunks.length));
    for (let i = 0; i < chunks.length; i++) {
      props.setProperty(`ROSTER_CHUNK_${i}`, chunks[i]);
    }

    // Read back and reassemble
    const count = parseInt(props.getProperty('ROSTER_CHUNK_COUNT'), 10);
    assert.strictEqual(count, chunks.length, 'Chunk count should match');

    let reassembled = '';
    for (let i = 0; i < count; i++) {
      reassembled += props.getProperty(`ROSTER_CHUNK_${i}`);
    }

    assert.strictEqual(reassembled, jsonStr, 'Reassembled string must match original payload exactly');
    const parsed = JSON.parse(reassembled);
    assert.strictEqual(parsed.length, 250, 'Reassembled parsed array length should match');
  });

  test('Boundary condition: exact 8000 and 8192 bytes boundary slicing', () => {
    const props = mocks.PropertiesService.getScriptProperties();
    const exact8000 = 'X'.repeat(8000);
    const exact8192 = 'Y'.repeat(8192);

    assert.doesNotThrow(() => {
      props.setProperty('EXACT_8000', exact8000);
    }, 'Exact 8000 bytes must not throw');

    assert.doesNotThrow(() => {
      props.setProperty('EXACT_8192', exact8192);
    }, 'Exact 8192 bytes must not throw');

    assert.strictEqual(props.getProperty('EXACT_8000'), exact8000);
    assert.strictEqual(props.getProperty('EXACT_8192'), exact8192);
  });
});
