// tests/tier1-features/11_drive_archive_import.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFreshContext } = require('../harness/vm-loader.js');

describe('Tier 1: [Drive Archive Import] Archive Scanning, Timestamp Tolerance & Hash Restoration', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const adminHtmlPath = path.join(projectRoot, 'Admin.html');
  const adminServicePath = path.join(projectRoot, 'AdminService.gs');
  const archiveServicePath = path.join(projectRoot, 'ArchiveImportService.gs');
  const appJsPath = path.join(projectRoot, 'app.js.html');

  test('Admin.html contains dedicated import button and modal wizard elements', () => {
    assert.ok(fs.existsSync(adminHtmlPath), 'Admin.html must exist');
    const html = fs.readFileSync(adminHtmlPath, 'utf8');

    // 檢查獨立按鈕
    assert.ok(html.includes('id="btnOpenImportArchiveModal"'), 'Must contain btnOpenImportArchiveModal');
    assert.ok(html.includes('從雲端硬碟匯入封存'), 'Must contain import button label');

    // 檢查彈窗結構
    assert.ok(html.includes('id="importArchiveModal"'), 'Must contain importArchiveModal');
    assert.ok(html.includes('id="importArchiveSelect"'), 'Must contain importArchiveSelect dropdown');
    assert.ok(html.includes('id="btnRefreshArchives"'), 'Must contain btnRefreshArchives');
    assert.ok(html.includes('id="importArchiveEventName"'), 'Must contain importArchiveEventName input');
    assert.ok(html.includes('id="importArchiveOverwriteAlert"'), 'Must contain overwrite alert badge');
    assert.ok(html.includes('id="btnSubmitImportArchive"'), 'Must contain btnSubmitImportArchive');

    // 檢查前端 JS 事件綁定
    assert.ok(html.includes("api('adminListDriveArchives')"), 'Must call adminListDriveArchives');
    assert.ok(html.includes("api('adminImportDriveArchive'"), 'Must call adminImportDriveArchive');
  });

  test('app.js.html has relaxed API timeout (45s) for Drive batch scanning', () => {
    assert.ok(fs.existsSync(appJsPath), 'app.js.html must exist');
    const appJs = fs.readFileSync(appJsPath, 'utf8');

    assert.ok(appJs.includes('45000'), 'Must set timeout to 45000ms');
    assert.ok(appJs.includes('超過 45 秒未回應'), 'Must state 45s in error message');
  });

  test('Archive file metadata parsing handles various timestamp suffixes correctly', () => {
    const res = createFreshContext();
    const sandbox = res.context;

    // 測試各種時間戳後綴與命名模式
    const testCases = [
      {
        folder: '電子簽到_年度大會_20261018_120000_123',
        file: '電子簽到_年度大會_20261018_120000_123_設定',
        expectedName: '年度大會',
      },
      {
        folder: '電子簽到_春酒盛宴_20261018',
        file: '電子簽到_春酒盛宴_20261018_設定',
        expectedName: '春酒盛宴',
      },
      {
        folder: '電子簽到_志工幹訓',
        file: '電子簽到_志工幹訓_設定',
        expectedName: '志工幹訓',
      },
      {
        folder: '電子簽到_新產品發表會_20261018_093000',
        file: '電子簽到_新產品發表會_20261018_093000_封存',
        expectedName: '新產品發表會',
      },
    ];

    testCases.forEach(tc => {
      const mockFile = {
        getId: () => 'mock_fid_' + tc.expectedName,
        getLastUpdated: () => new Date(),
        getUrl: () => 'https://drive.google.com/open?id=mock',
      };
      const meta = sandbox.parseArchiveFileMetadata_(tc.folder, tc.file, mockFile, new Map());
      assert.ok(meta, `Metadata should be extracted for ${tc.file}`);
      assert.equal(meta.eventName, tc.expectedName, `Parsed eventName should match ${tc.expectedName}`);
    });
  });

  test('AdminService.gs syncEventToDriveSpreadsheet_ stores real passwordHash and creates versioned files', () => {
    assert.ok(fs.existsSync(adminServicePath), 'AdminService.gs must exist');
    const code = fs.readFileSync(adminServicePath, 'utf8');

    // 檢查已包含 passwordHash 欄位
    assert.ok(code.includes("m.passwordHash || ''"), 'Must write real passwordHash instead of masking');
    assert.ok(code.includes("'passwordHash'"), 'Headers must include passwordHash');

    // 檢查每次同步均建立帶時間戳的歷史版本試算表
    assert.ok(code.includes('每次封存皆建立帶有最新時間戳的歷史版本試算表'), 'Must create new timestamped version on re-archive');
  });

  test('extractArchiveDataFromSpreadsheet_ recovers passwordHash and group hierarchy', () => {
    const res = createFreshContext();
    const sandbox = res.context;
    sandbox.ensureInitialized_();

    // 模擬已含有分組、名單與密碼 Hash 的試算表
    const mockGroupsData = [
      ['groupId', '分類路徑', '名稱', '層級深度', '排序', '父節點Id'],
      ['grp_1', '企劃處', '企劃處', 0, 1, ''],
      ['grp_2', '企劃處/活動組', '活動組', 1, 2, 'grp_1'],
    ];

    const mockRosterData = [
      ['personId', '所屬分類路徑', '姓名', '排序', '啟用狀態', 'groupId', 'passwordHash'],
      ['per_1', '企劃處/活動組', '王小明', 1, true, 'grp_2', 'hash_sha256_mock_12345'],
      ['per_2', '企劃處', '李大華', 2, true, 'grp_1', 'hash_sha256_mock_67890'],
    ];

    const mockSheets = {
      '分組': {
        getDataRange: () => ({ getValues: () => mockGroupsData }),
        getLastRow: () => mockGroupsData.length,
      },
      '名單': {
        getDataRange: () => ({ getValues: () => mockRosterData }),
        getLastRow: () => mockRosterData.length,
      },
      '說明': null,
      '活動匯入名冊': null,
    };

    const mockSs = {
      getSheetByName: (name) => mockSheets[name] || null,
      getName: () => '電子簽到_測試大會_20261018_設定',
    };

    const extracted = sandbox.extractArchiveDataFromSpreadsheet_(mockSs, 'evt_test_123');
    assert.ok(extracted, 'Should extract data');
    assert.equal(extracted.groups.length, 2, 'Should extract 2 groups');
    assert.equal(extracted.roster.length, 2, 'Should extract 2 members');

    const p1 = extracted.roster.find(m => m.displayName === '王小明');
    assert.ok(p1, 'Member 1 found');
    assert.equal(p1.passwordHash, 'hash_sha256_mock_12345', 'Real passwordHash must be accurately recovered');
    assert.equal(p1.hasPassword, true, 'hasPassword must be true');

    const p2 = extracted.roster.find(m => m.displayName === '李大華');
    assert.ok(p2, 'Member 2 found');
    assert.equal(p2.passwordHash, 'hash_sha256_mock_67890', 'Real passwordHash must be accurately recovered');
  });
});
