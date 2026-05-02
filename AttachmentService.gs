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

    const { driveFolderId } = getEventDriveFolder_(eventId);
    const folder = DriveApp.getFolderById(driveFolderId);
    const bytes = Utilities.base64Decode(base64);
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
      createdAt: r[6] || '',
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

