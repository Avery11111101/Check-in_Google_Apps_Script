# 電子簽到系統（Google Apps Script）

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

2. 建立 Apps Script 專案並推上去

```bash
clasp create --title "電子簽到系統" --type webapp
clasp push
```

3. 在 Apps Script 介面部署為 Web App
   - 執行身分：**使用者存取應用程式**
   - 存取權：看需求（測試可先用「任何知道連結的人」）

4. 第一次授權與管理員
   - 第一次開啟管理頁時會要求授權（Sheet/Drive/Email）
   - 管理員白名單存於 `ADMIN_EMAILS`；管理頁可新增共同管理員 email

## 入口

- 簽到頁：`?page=checkin&eventId=...`
- 管理頁：`?page=admin`
- 看板頁：`?page=board&eventId=...`

## 使用流程（最短路徑）

1. 開啟管理頁 `?page=admin`
2. 建立活動 → 取得 `eventId` 與簽到連結
3. 建立分組、建立名單（或先用 Apps Script 編輯器執行 `adminSeedDemoData()` 建示範資料）
4. 點「開放簽到」
5. 把簽到連結轉成 QR Code，讓大家掃
6. 開啟看板 `?page=board&eventId=...` 投影展示狀態變化

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
- **修正**：頂部導覽與管理頁 QR／簽到／看板連結一律導向 **`https://script.google.com/macros/s/…/exec?page=…`**（正式 Web App 網址）。`…googleusercontent.com/userCodeAppPanel?page=…` 僅為 iframe 內載入點，**不能**當成瀏覽器主網址使用，否則會空白。
- **實作**：`getWebAppUrl_()` 使用 `ScriptApp.getService().getUrl()` 並寫入 **`WEB_APP_URL`** 快取。前端在 **HtmlService iframe**（`googleusercontent.com/userCodeAppPanel`）內時，`window.location` 不是 `script.google.com/.../exec`，且 **`document.referrer` 可能被 Referrer-Policy 清空**，相對連結 `?page=admin` 會錯留在 userCodeAppPanel。載入後會 **`google.script.run.getWebAppExecUrlForClient()`** 向伺服端取正確 `/exec` 並改寫導覽列；`resolveWebAppBase` 順序為：**伺服端釘選 `__GAS_EXEC_BASE`** → **referrer** → **location** → **bootstrap**。若仍失敗可手動設定 `WEB_APP_URL`。


