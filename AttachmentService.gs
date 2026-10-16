/**
 * ============================================================================
 * [ATTACHMENT SYSTEM DEACTIVATED / 附件系統已停用]
 * 依專案規範 R3，為節省系統配額與載入開銷，本系統所有附件上傳與讀取功能全面停用。
 * 以下提供安全樁 (Safe Stubs)，確保任何現存前端呼叫不會產生未定義例外或執行期中斷。
 * ============================================================================
 */

/**
 * 安全樁：取得每日附件清單（一律回傳空陣列，防止前端 Promise.all 或 .map 報錯）
 * @param {string} eventId
 * @param {string} [date]
 * @returns {Array} 空陣列
 */
function adminListDailyAttachments(eventId, date) {
  return [];
}

/**
 * 安全樁：上傳每日附件（安全停用回傳，不執行 Drive 上傳與 Sheets 寫入）
 * @param {Object} payload
 * @returns {{success: boolean, ok: boolean, disabled: boolean, message: string}}
 */
function adminUploadDailyAttachment(payload) {
  return {
    success: false,
    ok: false,
    disabled: true,
    message: '附件功能已停用',
  };
}

/**
 * 安全樁：刪除每日附件（安全樁回傳）
 * @param {Object} payload
 * @returns {{ok: boolean, disabled: boolean}}
 */
function adminDeleteDailyAttachment(payload) {
  return {
    ok: true,
    disabled: true,
  };
}

/*
----------------------------------------------------------------------------
[以下為原 AttachmentService.gs 完整邏輯備份 - 已完整註解，避免配額與開銷]
----------------------------------------------------------------------------
var ATTACH_UPLOAD_MAX_BYTES_ = 4 * 1024 * 1024;
var ATTACH_ALLOWED_MIME_ = {
  'image/jpeg': true,
  'image/png': true,
  'image/gif': true,
  'image/webp': true,
};

function assertAttachmentUploadAllowed_(mimeType, base64String) {
  const mime = String(mimeType || '').trim().toLowerCase();
  if (!ATTACH_ALLOWED_MIME_[mime]) {
    throw new Error('不支援的檔案類型（僅允許 JPEG、PNG、GIF、WebP）。實際：' + (mime || '（空）'));
  }
  const b64 = String(base64String || '').trim();
  const approxBytes = Math.floor((b64.length * 3) / 4);
  if (approxBytes > ATTACH_UPLOAD_MAX_BYTES_) {
    throw new Error('檔案過大：解碼後約 ' + approxBytes + ' bytes，上限為 ' + ATTACH_UPLOAD_MAX_BYTES_ + ' bytes（約 4 MB）。請壓縮圖片後再試。');
  }
}

function adminUploadDailyAttachmentOriginal_(payload) {
  requireAdmin_();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const eventId = String(payload.eventId || '').trim();
    const date = String(payload.date || '').trim(); // yyyy-mm-dd
    const title = String(payload.title || '').trim();
    const fileName = String(payload.fileName || 'image');
    const mimeType = String(payload.mimeType || 'image/png');
    const base64 = String(payload.base64 || '').trim();
    if (!eventId) throw new Error('缺少 eventId。');
    if (!date) throw new Error('缺少 date。');
    if (!base64) throw new Error('缺少檔案內容。');

    assertAttachmentUploadAllowed_(mimeType, base64);

    const { driveFolderId } = getEventDriveFolder_(eventId);
    const folder = DriveApp.getFolderById(driveFolderId);
    let bytes;
    try {
      bytes = Utilities.base64Decode(base64);
    } catch (e) {
      throw new Error('檔案內容無法解碼（base64 格式錯誤）。');
    }
    if (bytes.length > ATTACH_UPLOAD_MAX_BYTES_) {
      throw new Error('檔案過大：解碼後為 ' + bytes.length + ' bytes，上限為 ' + ATTACH_UPLOAD_MAX_BYTES_ + ' bytes（約 4 MB）。');
    }
    const blob = Utilities.newBlob(bytes, mimeType, fileName);
    const file = folder.createFile(blob);
    const driveFileId = file.getId();
    const driveUrl = file.getUrl();

    const ss = getDb_();
    const sh = ss.getSheetByName(SHEETS.ATTACH);
    sh.appendRow([eventId, date, title, driveFileId, driveUrl, '', new Date()]);
    return { ok: true, driveFileId, driveUrl };
  } finally {
    lock.releaseLock();
  }
}

function adminListDailyAttachmentsOriginal_(eventId) {
  requireAdmin_();
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.ATTACH);
  const rows = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]) !== String(eventId)) continue;
    out.push({
      eventId: String(r[0]),
      date: String(r[1] || ''),
      title: String(r[2] || ''),
      driveFileId: String(r[3] || ''),
      driveUrl: String(r[4] || ''),
      memo: String(r[5] || ''),
      createdAt: cellToPlain_(r[6]),
    });
  }
  return out.sort((a, b) => (a.date || '').localeCompare(b.date || '') || String(b.createdAt).localeCompare(String(a.createdAt)));
}

function adminDeleteDailyAttachmentOriginal_(payload) {
  requireAdmin_();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const eventId = String(payload.eventId || '').trim();
    const date = String(payload.date || '').trim();
    const driveFileId = String(payload.driveFileId || '').trim();
    if (!eventId) throw new Error('缺少 eventId。');
    if (!driveFileId) throw new Error('缺少 driveFileId。');

    try {
      DriveApp.getFileById(driveFileId).setTrashed(true);
    } catch (e) {
      // ignore if already deleted
    }

    const ss = getDb_();
    const sh = ss.getSheetByName(SHEETS.ATTACH);
    const rows = sh.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i];
      if (String(r[0]) === eventId && String(r[3]) === driveFileId && (!date || String(r[1]) === date)) {
        sh.deleteRow(i + 1);
      }
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function getEventDriveFolder_(eventId) {
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.EVENTS);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]) !== String(eventId)) continue;
    const driveFolderId = String(r[5] || '');
    const driveFolderUrl = String(r[6] || '');
    if (!driveFolderId) throw new Error('此活動尚未建立 Drive 資料夾（可能是舊活動）。');
    return { driveFolderId, driveFolderUrl };
  }
  throw new Error('找不到活動。');
}
----------------------------------------------------------------------------
*/
