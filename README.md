# 電子簽到系統

這是一套使用 **Google Apps Script Web App + Google Sheet + Google Drive** 的電子簽到系統，支援：

- 掃 QR Code 進入簽到頁，使用「**從右往左滑動**」確認簽到/簽退
- 管理員後台建立活動、產出簽到/看板連結
- 即時看板（輪詢）顯示：未簽到 / 已簽到 / 已簽退（依分類分組聚合）
- 每日附件圖片：管理員上傳圖片到 Drive，並綁定活動+日期，可刪除

## 目前進度

- 已建立 GAS 專案骨架（`doGet` 路由、HTML 頁、初始化 Sheet/Drive）
- 已建立預設 Sheet schema（初始化時自動建立工作表與標題列）
- Web App 預設 **`USER_DEPLOYING` + `ANYONE_ANONYMOUS`**：簽到／看板訪客**不必登入 Google**；管理頁以指令碼屬性 **`ADMIN_EMAILS`**（逗號分隔多筆）驗證目前登入之 Google 帳號（以「我」執行時通常僅擁有者帳號可穩定通過）
- 已完成：簽到/簽退 API、狀態快取、即時看板 API（前端輪詢）
- **v0.2.1**：看板於已設簽到密鑰時可改以**管理頁 6 位驗證碼**換取工作階段（網址不必帶 `checkinToken`）；`publicGetBoardState` 回傳 `checkinUrl` 供角落 QR 隨密鑰即時更新；名單變更時全螢幕短轉場；看板輪詢固定 **5 秒**
- **v0.2.2**：管理頁可設定 **`checkinToken` 自動變更週期**（不自動／預設間隔／自訂 ≥30 秒），伺服端於公開 API 呼叫時懶惰輪替並短暫接受上一組密鑰；**看板轉場動畫**可於管理頁設**全域預設**，看板頁再以瀏覽器本地覆寫
- **v0.2.3**：簽到頁 API 優先使用網址列密鑰；自動輪替時伺服端另保留**多組**近期密鑰（`EVENT_CHECKIN_TOKEN_LEGACY_*`）供驗證；看板／簽到公開 API 之密鑰比對一併支援歷史組
- **v0.2.4**：`doGet` 開啟簽到頁時，若網址 token 仍有效則 **bootstrap 改注入目前密鑰**（`resolveCheckinTokenForBootstrap_`）；簽到頁呼叫 API 時**優先使用 BOOT**，避免稍舊 QR 或 HtmlService iframe 內網址列不完整導致誤用舊參數
- **v0.2.5**：`doGet` 以 `e.queryString`／`e.parameters` 補讀 `eventId`／`checkinToken`（避免少數載入路徑下 `e.parameter` 未帶齊）；簽到頁另以 **`document.referrer`** 還原外層 `…/exec?...` 查詢字串，與 `BOOT` 一併決定鎖定活動與 API 用密鑰，修正「掃碼／開連結仍缺 checkinToken」之假陽性
- **v0.2.6**：簽到頁改以官方 **`google.script.url.getLocation`** 讀取外層網址列參數（HtmlService IFRAME 內 `referrer` 常同為 `googleusercontent…` 而**不含** `checkinToken`）；活動／名單載入延至該回呼後再執行
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

1. 在 Apps Script 介面部署為 Web App（與 [`appsscript.json`](appsscript.json) 對照）
  - **預設（匿名簽到）**：執行身分 **我**（`USER_DEPLOYING`）+ 存取 **任何人，甚至是匿名使用者**（`ANYONE_ANONYMOUS`）→ **訪客不必登入 Google** 即可開啟簽到／看板並呼叫公開 API；試算表寫入仍以**專案擁有者**已授權之身分執行。管理頁須以 **`ADMIN_EMAILS`** 所允許之 Google 帳號登入；此模式下通常**僅擁有者**可被伺服端辨識為登入者。
  - 若要以**多名** Google 帳號操作後台，可將 `ADMIN_EMAILS` 設為逗號分隔之多個 email，並視需要改為 **使用者存取應用程式**（`USER_ACCESSING`）且分享主試算表／根資料夾給各帳號；與「訪客完全不登入簽到」較難並存於**同一** Web App，實務可採**兩個部署**。
  - 存取權：內部活動可改為僅限機構成員等，並搭配**簽到密鑰**縮小 API 暴露面。
2. 第一次授權與管理員
  - 第一次由**擁有者**開啟管理頁時會要求授權（Sheet/Drive/Email）；初始化會寫入 **`ADMIN_EMAILS`**（優先目前登入者，否則為專案擁有者 email）
  - 進入管理頁時伺服端以 **Google 帳號 email** 比對 `ADMIN_EMAILS`（**不分大小寫**）；進階需求請在 Apps Script「專案設定」→「指令碼屬性」手動編輯 `ADMIN_EMAILS`

## 入口

- 簽到頁：`?page=checkin&eventId=...`（選用：`&checkinToken=...` 或 `&token=...`，與管理員產生之密鑰一致）
- 管理頁：`?page=admin`
- 看板頁：`?page=board&eventId=...`（**建議**勿在網址帶 `checkinToken`；若活動已設密鑰，請於管理頁「產生看板驗證碼」後在現場看板輸入 6 位碼授權。**相容**：仍可手動在網址加上 `checkinToken`／`token=` 作為舊版一次性設定）

## 安全與部署備註

- Web App 在 [`appsscript.json`](appsscript.json) 預設為 **`executeAs: USER_DEPLOYING`**（以擁有者身分執行）與 **`access: ANYONE_ANONYMOUS`**（**未登入 Google 者**亦可開啟簽到／看板並呼叫公開 API）。若不需匿名、或僅限機構成員，請在部署設定中調整存取權，並搭配下方「簽到密鑰」縮小 API 暴露面。
- **簽到密鑰**：管理員可為活動產生密鑰（寫入 `Attendance_Config` 鍵 `EVENT_CHECKIN_TOKEN_{eventId}`）。可選用 **自動變更週期**（`EVENT_CHECKIN_TOKEN_ROTATE_SECONDS_{eventId}` 等），輪替時會暫存上一組於 `EVENT_CHECKIN_TOKEN_PREV_*`，並將近期曾使用之密鑰列入 `EVENT_CHECKIN_TOKEN_LEGACY_*`（JSON 陣列、筆數有上限），以利掃碼稍舊 QR 仍可驗證。設定後，`publicListRoster`、`publicSubmitAttendance`、`publicGetPersonStatus` 須帶正確 `checkinToken`（或仍接受之上一組／歷史組）；**`publicGetBoardState`** 另接受由 **`publicExchangeBoardPairCode`** 換得之**看板工作階段**（`bs_…`，存於瀏覽器 `sessionStorage`，伺服端以 `CacheService` 續期，最長單次 TTL 21600 秒），或沿用網址／參數帶入之 `checkinToken`。未設定密鑰時行為與舊版相同。
- **簽到頁（v0.2.3–0.2.6）**：`doGet` 可將仍有效之網址 token **升級為目前密鑰**寫入 bootstrap；客戶端呼叫公開 API 時 **`checkinToken` 優先使用 `BOOT.checkinToken`**，其次 **`google.script.url.getLocation`**（外層 `exec` 查詢字串），再以 location＋referrer 為後援。
- **簽到活動清單**：簽到頁與看板相同呼叫 `publicListBoardEvents()` 列出**全部活動**（含尚未開放簽到者），方便先選場；未開放時介面會顯示狀態並鎖定簽到／滑動送出，與 `publicSubmitAttendance` 伺服端檢查一致。

## 使用流程（最短路徑）

1. **擁有者**開啟管理頁 `?page=admin`（預設「以擁有者身分執行」時，後台以建立專案之 Google 帳號操作最穩定）
2. 建立活動 → 取得 `eventId` 與簽到連結
3. 建立分組、建立名單（或先用 Apps Script 編輯器執行 `adminSeedDemoData()` 建示範資料）
4. 點「開放簽到」
5. 簽到 QR：管理頁會顯示小圖；投影時開看板頁，**右下角固定 QR** 供掃描簽到（已設密鑰時須先於管理頁「產生看板驗證碼」並在現場輸入 6 位碼）
6. 開啟看板 `?page=board`（可選 `eventId=`）投影；頁內亦可**下拉切換活動**並自動更新網址列（會同步移除網址列之 `checkinToken`，改以工作階段或重新驗證）

## Google Drive 目錄與檔名

- **根資料夾**（存在指令碼屬性 `DRIVE_FOLDER_ID`）：首次初始化時建立，名稱為 `電子簽到_系統_yyyyMMdd_HHmmss`（時區為專案時區，例如 `Asia/Taipei`）。若專案早已部署且已有舊的根資料夾 ID，**不會**自動改名，仍沿用原資料夾；若要在雲端硬碟中看得一致，可自行重新命名該資料夾顯示名稱（不影響 ID）。
- **主資料試算表**（`SPREADSHEET_ID`，檔名如 `簽到系統資料_yyyyMMdd_HHmmss`）：初始化或每次 `ensureInitialized_` 時會檢查是否已在上述根資料夾內；若否則自動 `moveTo` 移入，與活動子資料夾同層，避免試算表留在「我的雲端硬碟」根目錄與系統資料夾分離。
- **活動資料夾**：建立活動時在根資料夾下建立，名稱為 `電子簽到_{活動名稱}_{yyyyMMdd_HHmmss_SSS}`（活動名稱會去掉不適合檔名的字元並截長）。附件與設定檔皆建立在此資料夾內；程式仍以試算表內儲存的 `driveFolderId` 讀寫，不依檔名搜尋整個雲端硬碟。
- **設定試算表**：與活動一併建立，檔名為 `電子簽到_{活動名稱}_{同上時間戳}_設定`，內含「分組」「名單」「說明」工作表，供備份或協作格式；匯入後台名單可後續擴充。

## 新增/變更內容

- **UX（簽到頁）**：行動裝置加入 `viewport`／`theme-color`、`body.page-checkin` 與 `@media (max-width:520px)` 樣式：安全區內距、頂欄直向堆疊、簽到／簽退等寬觸控列（最小高度 44px）、開放狀態與滑動列換行／略放大軌道與滑塊以利手指操作。
- **UX／修正**：看板統計列改為正確區分「未簽／已簽退」，出席率改以**目前在場（已簽到）人數**計算，並顯示簽退人數；無選活動時不再每次輪詢重複跳出提示。
- **UX／修正**：簽到頁滑動軌道在版面尚未完成或視窗縮放時，避免滑塊座標異常；以 `ResizeObserver` 與視窗 `resize` 將滑塊復位。
- **UX**：活動已選取但管理員尚未「開放簽到」時，停用簽到／簽退按鈕與滑動確認區，並於軌道提示「活動尚未開放簽到」，減少誤操作後才看到錯誤訊息。
- **開發**：`.gitignore` 略過 `/debug-*.log`（本機除錯日誌不納入版控）。
- **v0.1.0**：建立專案骨架、頁面路由、Sheet/Drive 初始化、基本管理頁（建立活動/開關簽到/產出連結）、簽到頁滑動送出 UI、看板輪詢 UI；新增示範資料 `adminSeedDemoData()` 方便快速測試。
- **v0.2.0**：見下方 **架構**／**安全**／**效能**／**附件** 四條（簽到密鑰、活動清單篩選、看板快取、上傳限制、`Utils.gs`）。
- **修正**：補上伺服端 `esc()`，避免 HTML 模板渲染時出現 `ReferenceError: esc is not defined`。
- **曾有**：管理頁曾提供共同管理員 UI（已移除）；`ADMIN_EMAILS` 改為僅能於指令碼屬性手動維護。
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
- **QR Code**：管理頁依目前活動即時顯示簽到連結之 QR（內嵌 [qrcodejs](https://github.com/davidshimjs/qrcodejs)）；看板以**固定角落**小圖顯示簽到 QR（輪詢回傳之 `checkinUrl` 變更時自動重繪），並可從下拉選單**切換活動**（變更時以 `history.replaceState` 同步網址 `eventId`）。**`publicListBoardEvents`**：看板與簽到頁載入時皆**不篩選 isOpen**（下拉可見全部活動）。管理頁產生之看板連結**不**附 `checkinToken`；簽到連結與管理頁 QR 仍附 `checkinToken`（若有設定）。
- **UX**：管理頁簽到 QR 下方顯示**距離目前 QR 內連結失效**（密鑰輪替）之倒數，歸零時自動重繪 QR。看板角落簽到 QR 下方同樣顯示**約幾秒後連結失效**（由 `publicGetBoardState` 併入之 `checkinQrInvalidInSeconds` 等推算，與伺服端輪替錨點一致；未啟用輪替時改為說明文案）。
- **簽到首頁（Checkin）**：活動為**下拉選單**（`publicListBoardEvents()`）；若網址或 QR 已帶 `eventId` 則自動選定並鎖定選單。姓名欄新增**關鍵字搜尋**篩選，仍以下拉選單選取正式名單。
- **看板配額**：看板頁曾用 `setInterval` 呼叫非同步 `tick()`，導致多個 `publicGetBoardState` **重疊執行**，易觸發 Google 試算表／同時執行配額相關錯誤。已改為**單飛** `setTimeout` 鏈（上一輪完成後才排下一輪）、分頁在背景時拉長間隔、載入時先取 `exec` 網址再載活動；看板輪詢間隔**固定 5 秒**（與 `POLL_SECONDS` 分離）。
- **簽到回傳**：`publicSubmitAttendance` 的 `serverTime` 改為**字串**（`cellToPlain_`），避免 `google.script.run` 序列化含 `Date` 的物件在客戶端變成 `null`，進而觸發 `Cannot read properties of null (reading 'serverTime')`；簽到頁並對回傳做防呆。
- **簽到 UI**：移除「字體／字型」輸入欄；送出時仍傳 `font: ''`，`Logs` 工作表之 `font` 欄位保留（寫入空字串）。名單試算表範本之 `font` 欄說明未改，供進階用途。
- **UX**：管理頁顯示目前活動**是否開放簽到**（狀態列 +「開放／關閉」按鈕強調色）；簽到頁顯示**本活動管理狀態**，且按下「簽到／簽退」後按鈕以綠／橘強調選取動作。
- **看板**：`publicGetBoardState` 的 `now` 改為**字串**（`cellToPlain_`），狀態快取列之 `lastTime` 亦改為字串，避免 `google.script.run` 回傳含 `Date` 時客戶端整包為 `null` 而觸發 `Cannot read properties of null (reading 'now')`；前端 `render`／`tick` 並做防呆。
- **簽到狀態**：`getStatus_`／`publicGetPersonStatus` 的 `lastTime` 改為字串（`cellToPlain_`），回傳欄位亦強制字串化，避免客戶端 `Cannot read properties of null (reading 'status')`；簽到頁 `refreshStatus` 並做防呆。
- **維護**：已移除簽到／看板／管理頁「大量新增」流程中導向本機 ingest 的除錯用 `fetch` 與 `adminCreateRosterBulk` 內之 `Logger` 除錯輸出，正式環境不再嘗試連線 `127.0.0.1`。
- **部署／權限**：[`appsscript.json`](appsscript.json) 預設 **`USER_DEPLOYING`** + **`ANYONE_ANONYMOUS`**（見上文「開發與部署」）；管理員 email 僅能於 **`ADMIN_EMAILS`** 指令碼屬性維護。
- **UX／說明**：「無法開啟管理頁」黃色提示改為簡化說明；移除管理錯誤頁之本機 ingest 除錯腳本。
- **移除**：管理頁「共同管理員」卡片與 `adminListAdmins`、`adminAddAdminEmail`、`adminRemoveAdminEmail`、`adminAddCurrentUser`；`requireAdmin_` 錯誤訊息與初始化 `ADMIN_EMAILS` 邏輯調整（見 [`Auth.gs`](Auth.gs)、[`Code.gs`](Code.gs)）。
- **維護**：確認程式碼中已無本機 ingest 除錯呼叫；刪除工作區 `.cursor` 內遺留之 `debug-*.log` 除錯日誌檔。
- **Drive**：主資料試算表會收進 `DRIVE_FOLDER_ID` 根資料夾（`ensureSpreadsheetInDriveFolder_`）；既有部署在下次觸發初始化時若檔案仍在根目錄，會自動搬入同一資料夾。
- **架構（v0.2.0）**：新增 [`Utils.gs`](Utils.gs) 集中 `cellToPlain_`；[`PublicAccess.gs`](PublicAccess.gs) 為簽到密鑰驗證與看板狀態快取鍵。
- **安全（v0.2.0）**：管理頁可「產生／重設密鑰」「清除密鑰」；`adminGetEventSecurity`／`adminRegenerateEventCheckinToken`／`adminClearEventCheckinToken`；設有密鑰時 `publicListRoster`／`publicSubmitAttendance`／`publicGetPersonStatus` 須帶正確 `checkinToken`。
- **安全（v0.2.1）**：[`AdminService.gs`](AdminService.gs) 之 `adminCreateBoardPairCode`；[`PublicAccess.gs`](PublicAccess.gs) 之 `createBoardPairCodeForEvent_`／`publicExchangeBoardPairCode`／看板工作階段快取；`publicGetBoardState` 以 `assertPublicEventTokenOrBoardSession_` 驗證。
- **效能（v0.2.0）**：`publicGetBoardState` 使用 `CacheService` 文件快取（`BOARD_STATE_CACHE_TTL_SECONDS`，預設 2 秒；`0` 關閉）；簽到成功寫入後會使該活動快取失效。
- **附件（v0.2.0）**：`adminUploadDailyAttachment` 限制 MIME（JPEG／PNG／GIF／WebP）與解碼後約 4 MB，錯誤以明確訊息回傳；附件清單之 `createdAt` 改為字串。
- **UX**：管理頁簽到連結／Drive 資料夾／設定試算表欄位旁新增**複製**按鈕（[`app.js.html`](app.js.html) 共用 `copyTextToClipboard`）；簽到頁名單與狀態 API 錯誤改為 `formatApiError`、Toast 支援錯誤樣式與成功訊息自動清除、送出中鎖定簽到／簽退與滑塊並標示 `aria-busy`，滑塊可 **Enter／空白鍵**送出；看板頂部顯示**活動名稱**、輪詢時顯示「更新中…」、失敗時於 Toast 與橫幅顯示統一錯誤文案。
- **名單／分組**：管理頁支援**大量新增**名單（多行文字、與單筆新增共用分組下拉），後端 `adminCreateRosterBulk` 以批次寫入試算表，**單次上限 500 筆**；`sort` 由 0 遞增以便同批排序。**修正**：`getRange` 須依 Apps Script 語意傳入**列數／欄數**（第三、四參數），不可誤用「結束列」；先前在 `startRow>1` 時會出現「資料列數與範圍列數不符」。新增分組時**分類、分組名稱可擇一填寫或皆留空**，寫入前會正規化為「未分類」「未分組」（[`Utils.gs`](Utils.gs) `normalizeGroupCategoryAndName_`）；看板與 `adminListGroups` 對空白舊資料亦以相同規則顯示，介面上為「未分類｜未分組」。
- **v0.2.2（簽到密鑰輪替）**：[`PublicAccess.gs`](PublicAccess.gs) 之 `ensureCheckinTokenRotated_`（`LockService`）、`getEventCheckinRotateSeconds_`；[`RosterService.gs`](RosterService.gs) 之 `adminSetEventCheckinTokenRotate`、`adminGetEventSecurity` 擴充（`rotateSeconds`、`rotatedAt`、`prevExists`）；輪替後 **`buildPublicCheckinUrl_`** 於組網址前觸發輪替並採用最新 **current**。管理頁 QR／複製連結為當下快照；**看板角落 QR** 仍隨輪詢更新。
- **v0.2.2（看板轉場）**：指令碼屬性 **`BOARD_TRANSITION_DEFAULT`**（預設開）透過 `adminGetBoardTransitionDefault`／`adminSetBoardTransitionDefault` 維護；看板 bootstrap 帶 `boardTransitionDefault`，頁面 **`localStorage.boardTransitionEnabled`**（`'1'`/`'0'`）可覆寫單機偏好。

