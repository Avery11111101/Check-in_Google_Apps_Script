// tests/tier1-features/09_grace_period_and_drive_archive.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFreshContext } = require('../harness/vm-loader.js');

describe('Tier 1: [Grace Period & Drive Archive] 10s Token Grace, Font Uniformity & Board Promo Removal', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const cssPath = path.join(projectRoot, 'app.css.html');
  const adminHtmlPath = path.join(projectRoot, 'Admin.html');

  test('app.css.html ensures font-size, weight and color uniformity for board change notices', () => {
    assert.ok(fs.existsSync(cssPath), 'app.css.html must exist');
    const css = fs.readFileSync(cssPath, 'utf8');

    // .boardChangeNotice__line must have 1.1rem and weight 600
    assert.match(css, /\.boardChangeNotice__line\s*\{[^}]*font-size:\s*1\.1rem/);
    assert.match(css, /\.boardChangeNotice__line\s*\{[^}]*font-weight:\s*600/);

    // .boardChangeNotice__line + .boardChangeNotice__line must NOT degrade font-size or color
    const adjacentRule = css.match(/\.boardChangeNotice__line\s*\+\s*\.boardChangeNotice__line\s*\{([^}]*)\}/);
    assert.ok(adjacentRule, 'Adjacent line rule must exist');
    const body = adjacentRule[1];
    assert.ok(!body.includes('font-size'), 'Adjacent line rule must not shrink font-size');
    assert.ok(!body.includes('var(--muted)'), 'Adjacent line rule must not mute color');
  });

  test('Admin.html removes legacy standalone board promo card at bottom right', () => {
    assert.ok(fs.existsSync(adminHtmlPath), 'Admin.html must exist');
    const html = fs.readFileSync(adminHtmlPath, 'utf8');

    // Must NOT contain the card heading and promo description
    assert.ok(!html.includes('<h2>大螢幕即時簽到看板</h2>'), 'Must remove promo card heading');
    assert.ok(!html.includes('支援 100vw 全螢幕多欄流體排版、階層分組折疊展開與秒級自動更新。'), 'Must remove promo text');
  });

  test('Checkin code rotation provides 10-second grace period for previous token', () => {
    const res = createFreshContext();
    const sandbox = res.context;
    sandbox.ensureInitialized_();
    const eventId = 'evt_grace_test';

    // 模擬已設定輪替週期 30 秒，並產生初始驗證碼
    sandbox.upsertConfig_('EVENT_CHECKIN_TOKEN_' + eventId, '111111');
    sandbox.upsertConfig_('EVENT_CHECKIN_TOKEN_ROTATE_SECONDS_' + eventId, '30');
    sandbox.upsertConfig_('EVENT_CHECKIN_TOKEN_ROTATED_AT_' + eventId, String(Date.now() - 35000));

    // 觸發輪替更新
    sandbox.ensureCheckinTokenRotated_(eventId);

    const currentToken = sandbox.getEventCheckinToken_(eventId);
    const prevToken = sandbox.getEventCheckinTokenPrev_(eventId);

    assert.equal(prevToken, '111111', 'Previous token must be preserved');
    assert.notEqual(currentToken, '111111', 'New token must be generated');

    // 在 10 秒緩衝期內 (此時剛輪替)，新碼與舊碼都應通過驗證
    assert.doesNotThrow(() => {
      sandbox.assertCheckinTokenMatches_(eventId, currentToken);
    }, 'Current token must pass verification');

    assert.doesNotThrow(() => {
      sandbox.assertCheckinTokenMatches_(eventId, prevToken);
    }, 'Previous token must pass verification within 10s grace period');

    // 模擬已超過 10 秒 (15 秒前輪替)
    sandbox.upsertConfig_('EVENT_CHECKIN_TOKEN_ROTATED_AT_' + eventId, String(Date.now() - 15000));

    // 新碼依然有效
    assert.doesNotThrow(() => {
      sandbox.assertCheckinTokenMatches_(eventId, currentToken);
    }, 'Current token must still pass after grace period');

    // 舊碼在 10 秒後必須拋錯拒絕
    assert.throws(() => {
      sandbox.assertCheckinTokenMatches_(eventId, prevToken);
    }, /缺少或錯誤的現場簽到驗證碼/, 'Previous token must be rejected after 10s grace period');
  });

  test('adminRegenerateEventCheckinToken retains previous token and starts 10s grace period', () => {
    const res = createFreshContext();
    const sandbox = res.context;
    sandbox.ensureInitialized_();
    res.mocks.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', 'admin@example.com');
    const eventId = 'evt_manual_reset_test';

    sandbox.upsertConfig_('EVENT_CHECKIN_TOKEN_' + eventId, '222222');
    const r = sandbox.adminRegenerateEventCheckinToken({ eventId });

    assert.ok(r.ok);
    assert.equal(sandbox.getEventCheckinTokenPrev_(eventId), '222222');
    assert.equal(sandbox.getEventCheckinToken_(eventId), r.checkinToken);

    // 剛手動重設時，舊碼 222222 應能通過驗證
    assert.doesNotThrow(() => {
      sandbox.assertCheckinTokenMatches_(eventId, '222222');
    });

    // 超過 10 秒後拒絕舊碼
    sandbox.upsertConfig_('EVENT_CHECKIN_TOKEN_ROTATED_AT_' + eventId, String(Date.now() - 12000));
    assert.throws(() => {
      sandbox.assertCheckinTokenMatches_(eventId, '222222');
    });
  });

  test('adminSyncToSheets generates import-ready roster format in Drive spreadsheet', () => {
    const res = createFreshContext();
    const sandbox = res.context;
    sandbox.ensureInitialized_();
    res.mocks.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', 'admin@example.com');
    const eventId = 'evt_sync_import_test';

    // 建立活動
    const ss = sandbox.getDb_();
    const shEvents = ss.getSheetByName(sandbox.SHEETS.EVENTS);
    shEvents.appendRow([eventId, '測試封存活動', '', '', false, 'fld_test', 'https://drive.google.com/test', new Date(), false, false]);

    // 寫入 Fast Store 名冊與分組
    const storeData = {
      groups: [
        { groupId: 'grp_1', name: '研發組', path: '行政處/資訊科/研發組', depth: 2, sort: 1, parentId: 'grp_0' }
      ],
      roster: [
        { personId: 'p_1', groupId: 'grp_1', displayName: '王大明', sort: 1, enabled: true }
      ]
    };
    sandbox.fastStoreSave(eventId, storeData, true);

    const syncRes = sandbox.adminSyncToSheets({ eventId });
    assert.ok(syncRes.ok);
    assert.equal(syncRes.count, 1);
    assert.equal(syncRes.groupsCount, 1);
  });
});
