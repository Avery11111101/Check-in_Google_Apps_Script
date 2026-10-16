# Google Apps Script 簽到系統 - 零外部相依自動化測試基礎設施 (TEST_INFRA.md)

> **版本**：v1.0.0  
> **建立日期**：2026-10-16  
> **所屬里程碑**：M0 - E2E Testing Track  
> **適用架構**：Node.js v24 原生標準庫（零外部 npm 相依）  

---

## 1. 架構概述 (Architecture Overview)

本專案為 Google Apps Script（V8 執行環境）之簽到系統重構專案。因本機環境處於離線安全沙盒模式（無法自外部 npm 倉庫拉取 Jest、Mocha、JSDOM 等套件），測試基礎設施採用 **100% 零外部相依（Zero-Dependency）** 理念打造，完全依賴 Node.js 24 內建模組：

- `node:test`：原生測試執行器，支援巢狀 `describe`、`test`、生命週期鉤子及微任務排程。
- `node:assert/strict`：原生嚴格斷言引擎。
- `node:vm`：沙盒化 JavaScript 虛擬機，重現 Google Apps Script 多檔案共享全域命名空間的執行模型。
- `node:crypto`：精確對齊 GAS `Utilities.computeDigest`（SHA-256）與 `Utilities.getUuid`。
- `node:fs` 與 `node:path`：動態加載 `.gs` 與 `.html` 檔案。

---

## 2. 測試台架核心模組 (Harness Components)

所有台架程式碼皆收納於 `tests/harness/` 目錄下：

### 2.1 `tests/harness/gas-mock.js`

完整模擬 Google Apps Script 核心服務物件，並內建配額與統計監控：

1. **`PropertiesServiceMock`**：
   - 支援 `getScriptProperties()`, `getUserProperties()`, `getDocumentProperties()`。
   - **配額嚴格檢查**：
     - 單一屬性值上限 9,000 bytes（9KB），未分片寫入過大字串時立即拋出 `QuotaExceededError`，精確守護 R2 8KB 自動分片機制。
     - 總容量 500KB 限制監控，支援 `_getTotalBytes()` 檢測。
2. **`SpreadsheetAppMock`**：
   - 支援記憶體二維陣列（2D Grid）之 `Spreadsheet`, `Sheet`, `Range` 結構。
   - 支援 1-indexed 座標轉換、`getDataRange()`, `getRange()`, `getValues()`, `setValues()`, `appendRow()`, `deleteRow()`, `setFrozenRows()`。
   - **RPC 調用計數器 (`rpcStats`)**：
     - 精確追蹤 `getValues`, `setValues`, `appendRow` 次數。
     - 關鍵驗收：在 Fast Store 日常名冊 CRUD 時，斷言 `rpcStats.setValues === 0` 與 `rpcStats.appendRow === 0`（0 Sheet RPC 規範）。
3. **`DriveAppMock`**：
   - 樹狀虛擬檔案系統，支援 `Folder` 與 `File` 操作（`createFolder`, `createFile`, `getFileById`, `moveTo`）。
   - 與 `SpreadsheetApp` 雙向聯動，自動註冊建立之試算表檔案。
   - 支援 350KB 快取溢位檔案（`cache_overflow.json`）寫入與讀取。
4. **`UtilitiesMock`**：
   - `computeDigest`：回傳 GAS 規範之 Signed Byte Array（-128 至 127）。
   - `getUuid`：生成標準 UUIDv4。
   - `formatDate`：依專案時區格式化日期字串。
   - `base64Encode` / `base64Decode`：以 Buffer 雙向轉換。
5. **`LockServiceMock` & `CacheServiceMock`**：
   - `LockServiceMock`：模擬持鎖、等待鎖與釋放鎖機制。
   - `CacheServiceMock`：支援 TTL 時間戳過期清理。
6. **`SessionMock` & `HtmlServiceMock`**：
   - `SessionMock`：固定回傳台北時區與管理員 Email。
   - `HtmlServiceMock`：支援 `createTemplateFromFile` 與 `evaluate()` 語法展開。

### 2.2 `tests/harness/vm-loader.js`

- 自動探索專案根目錄下所有 `.gs` 檔案。
- 依相依性順序依序加載：`Utils.gs` → `Sheets.gs` → `DriveNaming.gs` → `Auth.gs` → `PublicAccess.gs` → `RosterService.gs` → `AttendanceService.gs` → `BoardService.gs` → `AdminService.gs` → `AttachmentService.gs` → `Seed.gs` → `Code.gs`。
- 在 `node:vm` 注入 `createGasMocks()` 與標準 JS 全域物件。
- 自動將頂層詞法宣告（`SHEETS`, `APP`）與 `eval(expr)` 綁定至 Context 物件，使測試腳本可直接調用後端所有 API。

### 2.3 `tests/harness/dom-mock.js`

- 極簡 0 相依 DOM 樹模擬器（`MockDocument`, `MockWindow`, `MockElement`）。
- 支援 `id`, `className`, `classList`, `style`, `innerHTML`, `value`, `checked`, `disabled`, `addEventListener`, `dispatchEvent`。
- **`google.script.run` 動態 Proxy**：
  - 透過 JavaScript Proxy 攔截前後端 RPC 呼叫。
  - 支援 `.withSuccessHandler(cb).withFailureHandler(cb)[apiName](...args)` 鏈式調用，並透過微任務非同步回傳執行結果。

---

## 3. Clasp 部署隔離規範 (.claspignore)

專案根目錄 `.clasp.json` 設定 `rootDir: ""` 且 `skipSubdirectories: false`。為避免本地測試套件、文件與工具被 clasp 推送至 Google Apps Script 雲端環境，專案根目錄配置 `.claspignore`：

```gitignore
tests/**
**/*.test.js
package.json
package-lock.json
.agents/**
.git/**
.gitignore
*.md
LICENSE
```

---

## 4. 測試套件分層結構 (4-Tier Suite)

```
tests/
├── harness/
│   ├── gas-mock.js                    # GAS 核心服務 Mock
│   ├── vm-loader.js                   # node:vm 上下文加載器
│   └── dom-mock.js                    # 輕量 DOM 模擬器與 RPC Proxy
├── tier1-features/                    # Tier 1: 功能覆蓋與靜態完整性 (22 tests)
│   ├── 01_syntax_and_loader.test.js
│   ├── 02_claspignore_isolation.test.js
│   ├── 03_r1_tree_structure.test.js
│   ├── 04_r2_fast_store_crud.test.js
│   ├── 05_r3_attachment_deactivation.test.js
│   ├── 06_r5_checkbox_styles.test.js
│   └── 07_r6_classic_tokens.test.js
├── tier2-boundary/                    # Tier 2: 邊界與極端狀況 (10 tests)
│   ├── 01_sharding_8kb_boundary.test.js
│   ├── 02_drive_overflow_trigger.test.js
│   ├── 03_deep_tree_hierarchy.test.js
│   └── 04_empty_and_special_chars.test.js
├── tier3-cross/                       # Tier 3: 跨功能互動 (8 tests)
│   ├── 01_zero_sheet_rpc_crud.test.js
│   ├── 02_admin_sync_to_sheets.test.js
│   ├── 03_member_tree_assignment.test.js
│   └── 04_checkin_with_password_and_code.test.js
├── tier4-application/                 # Tier 4: 真實應用情境 (9 tests)
│   ├── 01_roster_100plus_simulation.test.js
│   ├── 02_folder_rename_and_cascade.test.js
│   ├── 03_storage_health_monitor.test.js
│   └── 04_board_fullscreen_feed.test.js
└── run-all.js                         # 主測試執行器 (階層化中文報表)
```

---

## 5. 測試執行指令 (Command Reference)

所有指令皆在專案根目錄執行，無需任何 `npm install`：

| 指令 | 說明 | 預期執行時間 |
|---|---|---|
| `npm test` 或 `node --test "tests/**/*.test.js"` | 原生執行全部 49 個測試 | < 350 ms |
| `npm run test:tier1` | 僅執行 Tier 1 功能與靜態檢查 (22 tests) | < 150 ms |
| `npm run test:tier2` | 僅執行 Tier 2 邊界與極端狀況測試 (10 tests) | < 150 ms |
| `npm run test:tier3` | 僅執行 Tier 3 跨功能互動測試 (8 tests) | < 150 ms |
| `npm run test:tier4` | 僅執行 Tier 4 真實情境與高負載測試 (9 tests) | < 150 ms |
| `npm run test:all` 或 `node tests/run-all.js` | 格式化彩色主執行器，輸出分層報表與彙總 | < 800 ms |

---

## 6. 效能與品質基準 (Quality & Performance Benchmark)

- **總測試數**：49 / 49 通過（100% Pass Rate）
- **總執行耗時**：~320 ms（原生測試）/ ~780 ms（主執行器分層執行）
- **外部依賴數**：0（零套件安裝風險）
- **記憶體開銷**：< 60 MB
