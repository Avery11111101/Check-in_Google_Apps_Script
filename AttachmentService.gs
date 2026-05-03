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

function adminUploadDailyAttachment(payload) {
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

function adminListDailyAttachments(eventId) {
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

function adminDeleteDailyAttachment(payload) {
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

