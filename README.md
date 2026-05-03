# 電子簽到系統

這是一套使用 **Google Apps Script Web App + Google Sheet + Google Drive** 的電子簽到系統，支援：

- 掃 QR Code 進入簽到頁，使用「**從右往左滑動**」確認簽到/簽退
- 管理員後台建立活動、產出簽到/看板連結
- 即時看板（輪詢）顯示：未簽到 / 已簽到 / 已簽退（依分類分組聚合）
- 每日附件圖片：管理員上傳圖片到 Drive，並綁定活動+日期，可刪除

## 目前進度

- 已建立 GAS 專案骨架（`doGet` 路由、HTML 頁、初始化 Sheet/Drive）
- 已建立預設 Sheet schema（初始化時自動建立工作表與標題列）
- 管理頁已支援「共同管理員」：可新增/移除管理員 email 白名單
- 已完成：簽到/簽退 API、狀態快取、即時看板 API（前端輪詢）
- 已完成：管理頁分組/名單 CRUD、每日附件圖片上傳/刪除

## 開發與部署（clasp）

1. 安裝並登入 clasp

```bash
npm i -g @google/clasp
clasp login
```

1. 建立 Apps Script 專案並推上去

```bash
clasp create --title "電子簽到系統" --type webapp
clasp push
```

1. 在 Apps Script 介面部署為 Web App
  - 執行身分：**使用者存取應用程式**
  - 存取權：看需求（測試可先用「任何知道連結的人」）
2. 第一次授權與管理員
  - 第一次開啟管理頁時會要求授權（Sheet/Drive/Email）
  - 管理員白名單存於 `ADMIN_EMAILS`；管理頁可新增共同管理員 email
  - 進入管理頁時伺服端會以**目前登入的 Google 帳號**比對白名單（**不分大小寫**）；非管理員會看到說明頁而非後台

## 入口

- 簽到頁：`?page=checkin&eventId=...`
- 管理頁：`?page=admin`
- 看板頁：`?page=board&eventId=...`

## 使用流程（最短路徑）

1. 開啟管理頁 `?page=admin`
2. 建立活動 → 取得 `eventId` 與簽到連結
3. 建立分組、建立名單（或先用 Apps Script 編輯器執行 `adminSeedDemoData()` 建示範資料）
4. 點「開放簽到」
5. 簽到 QR：管理頁會顯示小圖；投影時可開看板頁頂部**大 QR** 讓大家掃
6. 開啟看板 `?page=board`（可選 `eventId=`）投影；頁內亦可**下拉切換活動**並自動更新網址列

## Google Drive 目錄與檔名

- **根資料夾**（存在指令碼屬性 `DRIVE_FOLDER_ID`）：首次初始化時建立，名稱為 `電子簽到_系統_yyyyMMdd_HHmmss`（時區為專案時區，例如 `Asia/Taipei`）。若專案早已部署且已有舊的根資料夾 ID，**不會**自動改名，仍沿用原資料夾；若要在雲端硬碟中看得一致，可自行重新命名該資料夾顯示名稱（不影響 ID）。
- **活動資料夾**：建立活動時在根資料夾下建立，名稱為 `電子簽到_{活動名稱}_{yyyyMMdd_HHmmss_SSS}`（活動名稱會去掉不適合檔名的字元並截長）。附件與設定檔皆建立在此資料夾內；程式仍以試算表內儲存的 `driveFolderId` 讀寫，不依檔名搜尋整個雲端硬碟。
- **設定試算表**：與活動一併建立，檔名為 `電子簽到_{活動名稱}_{同上時間戳}_設定`，內含「分組」「名單」「說明」工作表，供備份或協作格式；匯入後台名單可後續擴充。

## 新增/變更內容

- **開發**：`.gitignore` 略過 `/debug-*.log`（本機除錯日誌不納入版控）。
- **v0.1.0**：建立專案骨架、頁面路由、Sheet/Drive 初始化、基本管理頁（建立活動/開關簽到/產出連結）、簽到頁滑動送出 UI、看板輪詢 UI；新增示範資料 `adminSeedDemoData()` 方便快速測試。
- **修正**：補上伺服端 `esc()`，避免 HTML 模板渲染時出現 `ReferenceError: esc is not defined`。
- **新增**：管理頁共同管理員功能（新增/移除 `ADMIN_EMAILS` 白名單）。
- **UX**：背景改為更乾淨的低干擾漸層，降低視覺雜訊、提高操作對比。
- **新增**：建立活動時自動建立對應 Drive 資料夾，並在管理頁顯示資料夾連結。
- **完成**：簽到/簽退 API（寫入 `Logs`、更新 `StatusCache`、防重複/防連點、檢查活動是否開放）。
- **完成**：看板 state API（依分類/分組聚合名單 + 狀態顏色/時間，前端輪詢）。
- **完成**：管理頁分組/名單 CRUD、每日附件圖片上傳/刪除（Drive + `DailyAttachments`）。
- **UX**：三頁一致導覽（管理/簽到/看板），視覺改為更乾淨的深色系、元件與間距一致；看板加入統計列（應到/實到/未簽/出席率）。
- **Drive**：根資料夾改為 `電子簽到_系統_…` 命名；活動資料夾改為 `電子簽到_{名稱}_{時間戳}`，並於同資料夾建立 `…_設定` 試算表範本；管理頁可複製建立當下的設定表連結。
- **修正**：頂部導覽與管理頁 QR／簽到／看板連結一律導向 `**https://script.google.com/macros/s/…/exec?page=…`**（正式 Web App 網址）。`…googleusercontent.com/userCodeAppPanel?page=…` 僅為 iframe 內載入點，**不能**當成瀏覽器主網址使用，否則會空白。
- **實作**：`getWebAppUrl_()` 使用 `ScriptApp.getService().getUrl()` 並寫入 `**WEB_APP_URL`** 快取。前端在 **HtmlService iframe**（`googleusercontent.com/userCodeAppPanel`）內時，`window.location` 不是 `script.google.com/.../exec`，且 `**document.referrer` 可能被 Referrer-Policy 清空**，相對連結 `?page=admin` 會錯留在 userCodeAppPanel。載入後會 `**google.script.run.getWebAppExecUrlForClient()`** 向伺服端取正確 `/exec` 並改寫導覽列；`resolveWebAppBase` 順序為：**伺服端釘選 `__GAS_EXEC_BASE`** → **referrer** → **location** → **bootstrap**。若仍失敗可手動設定 `WEB_APP_URL`。
- **修正**：管理頁載入活動清單失敗時，錯誤曾被後續「管理頁就緒」Toast 蓋掉，且文案寫「請看上方」但訊息實際在下方。改為**選單下方固定錯誤區**顯示完整原因、僅在全部初始化成功時顯示「管理頁就緒」；並新增 `formatApiError` 統一顯示 `google.script.run` 錯誤。
- **權限**：`doGet` 開啟管理頁前若未通過管理員驗證，改回傳可讀的 HTML 說明（非匿名錯誤頁）；`requireAdmin_` 改為**不分大小寫**比對 email。
- **修正**：`adminListEvents` 改回傳 `{ ok, events }`（並將試算表日期欄轉成字串），避免 `google.script.run` 序列化陣列在客戶端變成 `null` 而觸發 `Cannot read properties of null (reading 'map')`；管理頁 `loadEvents` 另做防呆。
- **UX**：未登入 Google 即開啟管理頁時，錯誤頁提供 **「由此登入 Google 帳號」** 按鈕（`target="_top"`，`continue` 導回管理頁）；若尚無快取的 Web App 網址則僅導向 Google 登入頁。
- **復原**：若指令碼屬性中的 **`DRIVE_FOLDER_ID`（根資料夾）** 或 **`SPREADSHEET_ID`（主試算表）** 已在雲端硬碟被刪除或無權限，`ensureInitialized_`／`getDb_` 會**清除失效 ID 並自動新建**根資料夾與主試算表、重新初始化工作表（`ADMIN_EMAILS` 等仍留在指令碼屬性；活動／名單等**表內資料**會是新的空庫）。
- **QR Code**：管理頁依目前活動即時顯示簽到連結之 QR（內嵌 [qrcodejs](https://github.com/davidshimjs/qrcodejs)）；看板頂部顯示**大尺寸**簽到 QR，並可從下拉選單**切換活動**（變更時以 `history.replaceState` 同步網址 `eventId`）。公開函式 **`publicListBoardEvents`** 供看板載入活動清單（僅 `eventId`、`name`、`isOpen`、`createdAt`，不含 Drive 網址）；與 `publicGetBoardState` 相同，**持有 Web App 連結者**即可呼叫，若需隱藏未開放活動可再改伺服端篩選。
- **簽到首頁（Checkin）**：活動改為**下拉選單**（同樣呼叫 `publicListBoardEvents`）；若網址或 QR 已帶 `eventId` 則自動選定並鎖定選單。姓名欄新增**關鍵字搜尋**篩選，仍以下拉選單選取正式名單。
- **看板配額**：看板頁曾用 `setInterval` 呼叫非同步 `tick()`，導致多個 `publicGetBoardState` **重疊執行**，易觸發 Google 試算表／同時執行配額相關錯誤。已改為**單飛** `setTimeout` 鏈（上一輪完成後才排下一輪）、分頁在背景時拉長間隔、載入時先取 `exec` 網址再載活動；看板實際輪詢間隔為 **`max(5, POLL_SECONDS)` 秒**（仍可由指令碼屬性 `POLL_SECONDS` 調大）。
- **簽到回傳**：`publicSubmitAttendance` 的 `serverTime` 改為**字串**（`cellToPlain_`），避免 `google.script.run` 序列化含 `Date` 的物件在客戶端變成 `null`，進而觸發 `Cannot read properties of null (reading 'serverTime')`；簽到頁並對回傳做防呆。
- **簽到 UI**：移除「字體／字型」輸入欄；送出時仍傳 `font: ''`，`Logs` 工作表之 `font` 欄位保留（寫入空字串）。名單試算表範本之 `font` 欄說明未改，供進階用途。
- **UX**：管理頁顯示目前活動**是否開放簽到**（狀態列 +「開放／關閉」按鈕強調色）；簽到頁顯示**本活動管理狀態**，且按下「簽到／簽退」後按鈕以綠／橘強調選取動作。
- **看板**：`publicGetBoardState` 的 `now` 改為**字串**（`cellToPlain_`），狀態快取列之 `lastTime` 亦改為字串，避免 `google.script.run` 回傳含 `Date` 時客戶端整包為 `null` 而觸發 `Cannot read properties of null (reading 'now')`；前端 `render`／`tick` 並做防呆。
- **簽到狀態**：`getStatus_`／`publicGetPersonStatus` 的 `lastTime` 改為字串（`cellToPlain_`），回傳欄位亦強制字串化，避免客戶端 `Cannot read properties of null (reading 'status')`；簽到頁 `refreshStatus` 並做防呆。
- **維護**：已移除簽到／看板頁面中導向本機 ingest 的除錯用 `fetch`（agent log），正式環境不再嘗試連線 `127.0.0.1`。

