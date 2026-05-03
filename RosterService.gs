function adminListEvents() {
  requireAdmin_();
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.EVENTS);
  const rows = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    out.push({
      eventId: String(r[0]),
      name: String(r[1] || ''),
      startAt: cellToPlain_(r[2]),
      endAt: cellToPlain_(r[3]),
      isOpen: String(r[4] || '') === 'TRUE' || r[4] === true,
      driveFolderId: String(r[5] || ''),
      driveFolderUrl: String(r[6] || ''),
      createdAt: cellToPlain_(r[7]),
    });
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  /** 包成物件：google.script.run 序列化「純陣列」在部分情境下客戶端會變成 null，導致 .map 失敗。 */
  return { ok: true, events: out };
}

function adminCreateEvent(payload) {
  requireAdmin_();
  const env = ensureInitialized_();
  const name = (payload && payload.name) ? String(payload.name).trim() : '';
  if (!name) throw new Error('活動名稱不可為空。');

  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.EVENTS);
  const eventId = newId_('evt');

  const root = DriveApp.getFolderById(env.driveFolderId);
  const stamp = driveTimeStampForNaming_();
  const safe = sanitizeDriveSegment_(name, 80);
  const folderName = '電子簽到_' + safe + '_' + stamp;
  const folder = root.createFolder(folderName);
  const driveFolderId = folder.getId();
  const driveFolderUrl = folder.getUrl();

  const settingsTitle = '電子簽到_' + safe + '_' + stamp + '_設定';
  const driveSettingsUrl = createEventSettingsSpreadsheet_(folder, settingsTitle, eventId, name);

  sh.appendRow([eventId, name, '', '', false, driveFolderId, driveFolderUrl, new Date()]);
  return { ok: true, eventId, name, driveFolderId, driveFolderUrl, driveSettingsUrl };
}

function adminSetEventOpen(payload) {
  requireAdmin_();
  const eventId = String(payload.eventId || '');
  const isOpen = !!payload.isOpen;
  if (!eventId) throw new Error('缺少 eventId。');

  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.EVENTS);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === eventId) {
      sh.getRange(i + 1, 5).setValue(isOpen);
      return { ok: true };
    }
  }
  throw new Error('找不到活動。');
}

/** 管理員讀取簽到密鑰（用於產生含 checkinToken 的連結／QR）。 */
function adminGetEventSecurity(eventId) {
  requireAdmin_();
  const id = String(eventId || '').trim();
  if (!id) throw new Error('缺少 eventId。');
  const rotateSeconds = getEventCheckinRotateSeconds_(id);
  const atRaw = String(getConfig_(eventCheckinTokenRotatedAtKey_(id), '') || '').trim();
  const rotatedAtMs = Number(atRaw);
  const prev = getEventCheckinTokenPrev_(id);
  return {
    ok: true,
    checkinToken: getEventCheckinToken_(id),
    rotateSeconds: rotateSeconds,
    rotatedAt:
      isFinite(rotatedAtMs) && rotatedAtMs > 0 ? String(Math.floor(rotatedAtMs)) : '',
    prevExists: !!prev,
  };
}

/**
 * 設定簽到密鑰自動變更週期（秒）：0＝不自動變更；否則須為 ≥30 之整數。
 */
function adminSetEventCheckinTokenRotate(payload) {
  requireAdmin_();
  const eventId = String((payload && payload.eventId) || '').trim();
  if (!eventId) throw new Error('缺少 eventId。');
  const secRaw = payload && payload.seconds != null ? payload.seconds : payload && payload.rotateSeconds;
  const n = Math.floor(Number(secRaw));
  if (!isFinite(n)) throw new Error('週期須為數字。');
  if (n !== 0 && n < 30) throw new Error('自動變更週期須為 0（關閉）或至少 30 秒。');
  if (n === 0) {
    deleteConfig_(eventCheckinTokenRotateSecondsKey_(eventId));
    deleteConfig_(eventCheckinTokenPrevKey_(eventId));
    deleteConfig_(eventCheckinTokenRotatedAtKey_(eventId));
    deleteConfig_(eventCheckinTokenLegacyKey_(eventId));
  } else {
    upsertConfig_(eventCheckinTokenRotateSecondsKey_(eventId), String(n));
    const atRaw = String(getConfig_(eventCheckinTokenRotatedAtKey_(eventId), '') || '').trim();
    const rotatedAtMs = Number(atRaw);
    if (!isFinite(rotatedAtMs) || rotatedAtMs <= 0) {
      upsertConfig_(eventCheckinTokenRotatedAtKey_(eventId), String(Date.now()));
    }
  }
  invalidateBoardStateCache_(eventId);
  return { ok: true, rotateSeconds: n };
}

/** 產生新的隨機簽到密鑰並覆寫舊值；回傳後請立即更新對外連結。 */
function adminRegenerateEventCheckinToken(payload) {
  requireAdmin_();
  const eventId = String((payload && payload.eventId) || '').trim();
  if (!eventId) throw new Error('缺少 eventId。');
  const token = 'ck_' + Utilities.getUuid().replace(/-/g, '');
  upsertConfig_(eventCheckinTokenKey_(eventId), token);
  deleteConfig_(eventCheckinTokenPrevKey_(eventId));
  deleteConfig_(eventCheckinTokenLegacyKey_(eventId));
  upsertConfig_(eventCheckinTokenRotatedAtKey_(eventId), String(Date.now()));
  invalidateBoardStateCache_(eventId);
  return { ok: true, checkinToken: token };
}

/** 清除簽到密鑰後，公開 API 不再要求 checkinToken（舊連結仍可用）。 */
function adminClearEventCheckinToken(payload) {
  requireAdmin_();
  const eventId = String((payload && payload.eventId) || '').trim();
  if (!eventId) throw new Error('缺少 eventId。');
  deleteConfig_(eventCheckinTokenKey_(eventId));
  clearEventCheckinTokenRotationAux_(eventId);
  invalidateBoardStateCache_(eventId);
  return { ok: true };
}

function publicListRoster(eventId, token) {
  const id = String(eventId || '').trim();
  assertPublicEventToken_(id, token);
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.ROSTER);
  const rows = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[1]) !== String(id)) continue;
    if (String(r[5]) === 'FALSE' || r[5] === false) continue;
    out.push({ personId: String(r[0]), displayName: String(r[3] || '') });
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hant'));
}

