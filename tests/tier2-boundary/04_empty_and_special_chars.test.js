// tests/tier2-boundary/04_empty_and_special_chars.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFreshContext } = require('../harness/vm-loader.js');

describe('Tier 2: [Boundary] Special Characters, UTF-8 & Empty Edge Cases', () => {
  let context, mocks;

  beforeEach(() => {
    const res = createFreshContext();
    context = res.context;
    mocks = res.mocks;

    context.ensureInitialized_();
    mocks.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', 'admin@example.com');
  });

  test('Special characters, emojis and quotes in group and member names', () => {
    const eventId = 'evt_special_chars';
    const specialGroupName = '🔥 行銷組 / "VIP" & <特別> \'單位\' \\ 🚀';
    const specialPersonName = '張 "小" 龍 <script>alert(1)</script> & 👩‍💻';

    const groupRes = context.adminCreateGroup({
      eventId,
      name: specialGroupName,
      category: specialGroupName,
      groupName: specialGroupName,
      sort: 1,
    });
    assert.ok(groupRes && groupRes.ok, 'Special character group creation should succeed');

    const personRes = context.adminCreateRoster({
      eventId,
      groupId: groupRes.groupId,
      displayName: specialPersonName,
      sort: 1,
      password: 'p@$$w0rd!#%^&*()_+~`|}{[]:;?><,./-',
    });
    assert.ok(personRes && personRes.ok, 'Special character member creation should succeed');

    const roster = context.adminListRoster(eventId);
    const person = roster.find(r => r.personId === personRes.personId);
    assert.ok(person, 'Person with special characters must be retrievable');
    assert.strictEqual(person.displayName || person.name, specialPersonName, 'Name with special characters must retain exact value without corruption');
  });

  test('Whitespace trimming and empty string normalization', () => {
    const eventId = 'evt_whitespace_norm';

    const groupRes = context.adminCreateGroup({
      eventId,
      name: '   空白夾雜組   ',
      category: '   空白分類   ',
      groupName: '   空白分組   ',
    });
    assert.ok(groupRes && groupRes.ok);

    const list = context.adminListGroups(eventId);
    const grp = list.find(g => g.groupId === groupRes.groupId);
    assert.ok(grp);
    if (grp.category) {
      assert.strictEqual(grp.category, '空白分類', 'Category should be trimmed');
    }
  });

  test('hashPassword_ with UTF-8 passwords and salts', () => {
    const pwd1 = '密碼1234!@#$';
    const pwd2 = '密碼1234!@#$';
    const pwd3 = '不同的密碼5678';

    const hash1 = context.hashPassword_(pwd1);
    const hash2 = context.hashPassword_(pwd2);
    const hash3 = context.hashPassword_(pwd3);

    assert.ok(hash1 && hash1.length === 64, 'SHA-256 hash length should be 64 hex characters');
    assert.strictEqual(hash1, hash2, 'Identical passwords must produce identical hashes');
    assert.notStrictEqual(hash1, hash3, 'Different passwords must produce different hashes');

    // Empty password returns empty string
    assert.strictEqual(context.hashPassword_(''), '', 'Empty password should return empty hash');
  });
});
