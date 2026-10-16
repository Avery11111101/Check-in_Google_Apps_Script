// tests/run-all.js
// Master test runner for all 4 test tiers using Node.js built-in modules

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TIERS = [
  {
    name: 'Tier 1: 功能覆蓋與靜態完整性 (Feature Coverage & Static Integrity)',
    dir: 'tests/tier1-features',
    desc: '語法完整性、.claspignore 隔離、R1 樹狀模型、R2 快取 CRUD、R3 附件安全 Stub、R5 Checkbox 樣式、R6 經典設計 Token',
  },
  {
    name: 'Tier 2: 邊界與極端狀況 (Boundary & Corner Cases)',
    dir: 'tests/tier2-boundary',
    desc: '8KB 分片邊界、350KB Drive 溢位門檻、4層深度樹 (處>科>組>小隊)、特殊字元與 UTF-8 防偽',
  },
  {
    name: 'Tier 3: 跨功能互動 (Cross-Feature Interactions)',
    dir: 'tests/tier3-cross',
    desc: '0 Sheet RPC Fast Store 驗證、adminSyncToSheets 批次同步、跨節點人員調動、密碼與 6 位驗證碼簽到流程',
  },
  {
    name: 'Tier 4: 真實應用情境 (Real-World Application Scenarios)',
    dir: 'tests/tier4-application',
    desc: '百人名冊高負載模擬、資料夾更名級聯路徑、儲存容量健康度監控、全螢幕看板響應式饋送',
  },
];

function run() {
  console.log('\n================================================================================');
  console.log('  Google Apps Script 簽到系統重構 - 零外部相依 E2E 自動化測試套件');
  console.log('  執行環境: Node.js ' + process.version + ' | 原生測試執行器 (node:test)');
  console.log('================================================================================\n');

  const rootDir = path.resolve(__dirname, '..');
  let totalPassed = 0;
  let totalFailed = 0;
  let totalTests = 0;
  const startTime = Date.now();

  for (const tier of TIERS) {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`▶ 執行 ${tier.name}`);
    console.log(`  說明: ${tier.desc}`);
    console.log(`--------------------------------------------------------------------------------`);

    const tierPath = path.join(rootDir, tier.dir);
    if (!fs.existsSync(tierPath)) {
      console.log(`  ⚠️ 目錄不存在: ${tier.dir}`);
      continue;
    }

    const testFiles = fs.readdirSync(tierPath)
      .filter(f => f.endsWith('.test.js'))
      .map(f => path.join(tier.dir, f));

    if (testFiles.length === 0) {
      console.log(`  ⚠️ 查無測試檔案: ${tier.dir}`);
      continue;
    }

    const globPattern = path.join(tier.dir, '**/*.test.js');
    const child = spawnSync(
      process.execPath,
      ['--test', globPattern],
      { cwd: rootDir, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] }
    );

    const stdout = child.stdout || '';
    const stderr = child.stderr || '';

    // Print test output indented
    if (stdout) {
      console.log(stdout.trimEnd());
    }
    if (stderr) {
      console.error(stderr.trimEnd());
    }

    // Parse pass/fail count from output (e.g. "ℹ pass 22", "ℹ fail 0")
    const passMatch = stdout.match(/ℹ pass (\d+)/);
    const failMatch = stdout.match(/ℹ fail (\d+)/);
    const tierPass = passMatch ? parseInt(passMatch[1], 10) : 0;
    const tierFail = failMatch ? parseInt(failMatch[1], 10) : 0;

    totalPassed += tierPass;
    totalFailed += tierFail;
    totalTests += (tierPass + tierFail);

    if (child.status === 0 && tierFail === 0) {
      console.log(`  ✅ ${tier.name} 通過 (${tierPass} 個測試成功)`);
    } else {
      console.log(`  ❌ ${tier.name} 存在失敗項目 (${tierFail} 個測試失敗)`);
    }
  }

  const durationMs = Date.now() - startTime;

  console.log('\n================================================================================');
  console.log('  測試執行彙總報告 (Test Execution Summary)');
  console.log('================================================================================');
  console.log(`  總測試項目 (Total Tests):    ${totalTests}`);
  console.log(`  通過項目 (Passed):          ${totalPassed}  ${totalPassed === totalTests ? '✅ 100%' : ''}`);
  console.log(`  失敗項目 (Failed):          ${totalFailed}  ${totalFailed > 0 ? '❌' : '✅ 0'}`);
  console.log(`  總耗時 (Duration):          ${durationMs} ms`);
  console.log('================================================================================\n');

  if (totalFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run();
