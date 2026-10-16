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
      requirePassword: String(r[8] || '') === 'TRUE' || r[8] === true,
      allowChangePassword: String(r[9] || '') === 'TRUE' || r[9] === true,
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

  const sourceEventId = (payload && payload.sourceEventId) ? String(payload.sourceEventId).trim() : '';
  let requirePassword = !!(payload && payload.requirePassword);
  let allowChangePassword = !!(payload && payload.allowChangePassword);

  const ss = getDb_();
  const shEvents = ss.getSheetByName(SHEETS.EVENTS);
  const eventId = newId_('evt');

  // 若有來源活動，可繼承其密碼設定（若當前未特別指定）
  if (sourceEventId && (payload.requirePassword === undefined || payload.requirePassword === null)) {
    const eventRows = shEvents.getDataRange().getValues();
    for (let e = 1; e < eventRows.length; e++) {
      if (String(eventRows[e][0]) === sourceEventId) {
        requirePassword = String(eventRows[e][8] || '') === 'TRUE' || eventRows[e][8] === true;
        if (payload.allowChangePassword === undefined || payload.allowChangePassword === null) {
          allowChangePassword = String(eventRows[e][9] || '') === 'TRUE' || eventRows[e][9] === true;
        }
        break;
      }
    }
  }

  const root = DriveApp.getFolderById(env.driveFolderId);
  const stamp = driveTimeStampForNaming_();
  const safe = sanitizeDriveSegment_(name, 80);
  const folderName = '電子簽到_' + safe + '_' + stamp;
  const folder = root.createFolder(folderName);
  const driveFolderId = folder.getId();
  const driveFolderUrl = folder.getUrl();

  const settingsTitle = '電子簽到_' + safe + '_' + stamp + '_設定';
  const driveSettingsUrl = createEventSettingsSpreadsheet_(folder, settingsTitle, eventId, name);

  shEvents.appendRow([eventId, name, '', '', false, driveFolderId, driveFolderUrl, new Date(), requirePassword, allowChangePassword]);

  let copiedGroupsCount = 0;
  let copiedRosterCount = 0;
  if (sourceEventId) {
    const shGroups = ss.getSheetByName(SHEETS.GROUPS);
    const grpRows = shGroups.getDataRange().getValues();
    const groupMap = {};
    const newGrpRows = [];

    for (let g = 1; g < grpRows.length; g++) {
      const gr = grpRows[g];
      if (String(gr[1]) === sourceEventId && gr[0]) {
        const oldGrpId = String(gr[0]);
        const newGrpId = newId_('grp');
        groupMap[oldGrpId] = newGrpId;
        newGrpRows.push([newGrpId, eventId, String(gr[2] || ''), String(gr[3] || ''), Number(gr[4] || 0)]);
      }
    }
    if (newGrpRows.length > 0) {
      const lastG = shGroups.getLastRow();
      shGroups.getRange(lastG + 1, 1, newGrpRows.length, 5).setValues(newGrpRows);
      copiedGroupsCount = newGrpRows.length;
    }

    const shRoster = ss.getSheetByName(SHEETS.ROSTER);
    const rosRows = shRoster.getDataRange().getValues();
    const newRosRows = [];
    for (let r = 1; r < rosRows.length; r++) {
      const rr = rosRows[r];
      if (String(rr[1]) === sourceEventId && rr[0]) {
        const oldGrpId = String(rr[2] || '');
        const targetGrpId = groupMap[oldGrpId] || '';
        const newPersonId = newId_('p');
        newRosRows.push([
          newPersonId,
          eventId,
          targetGrpId,
          String(rr[3] || ''),
          String(rr[4] || ''),
          !(String(rr[5]) === 'FALSE' || rr[5] === false),
          Number(rr[6] || 0),
          String(rr[7] || ''),
        ]);
      }
    }
    if (newRosRows.length > 0) {
      const lastR = shRoster.getLastRow();
      shRoster.getRange(lastR + 1, 1, newRosRows.length, 8).setValues(newRosRows);
      copiedRosterCount = newRosRows.length;
    }
  }

  return {
    ok: true,
    eventId,
    name,
    driveFolderId,
    driveFolderUrl,
    driveSettingsUrl,
    copiedGroupsCount,
    copiedRosterCount,
    requirePassword,
    allowChangePassword,
  };
}

function adminUpdateEventSettings(payload) {
  requireAdmin_();
  const eventId = String((payload && payload.eventId) || '').trim();
  if (!eventId) throw new Error('缺少 eventId。');

  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.EVENTS);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === eventId) {
      if (payload.name !== undefined) {
        const n = String(payload.name).trim();
        if (n) sh.getRange(i + 1, 2).setValue(n);
      }
      if (payload.requirePassword !== undefined) {
        sh.getRange(i + 1, 9).setValue(!!payload.requirePassword);
      }
      if (payload.allowChangePassword !== undefined) {
        sh.getRange(i + 1, 10).setValue(!!payload.allowChangePassword);
      }
      return { ok: true };
    }
  }
  throw new Error('找不到活動。');
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

/** 管理員讀取現場簽到驗證碼與輪替設定（用於 QR 旁顯示、簽到頁輸入驗證）。 */
function adminGetEventSecurity(eventId) {
  requireAdmin_();
  const id = String(eventId || '').trim();
  if (!id) throw new Error('缺少 eventId。');
  ensureCheckinTokenRotated_(id);
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

/** 產生新的 6 位現場簽到驗證碼並覆寫舊值。 */
function adminRegenerateEventCheckinToken(payload) {
  requireAdmin_();
  const eventId = String((payload && payload.eventId) || '').trim();
  if (!eventId) throw new Error('缺少 eventId。');
  const token = generateCheckinCode_();
  upsertConfig_(eventCheckinTokenKey_(eventId), token);
  deleteConfig_(eventCheckinTokenPrevKey_(eventId));
  deleteConfig_(eventCheckinTokenLegacyKey_(eventId));
  upsertConfig_(eventCheckinTokenRotatedAtKey_(eventId), String(Date.now()));
  invalidateBoardStateCache_(eventId);
  return { ok: true, checkinToken: token };
}

/** 清除驗證碼後，公開 API 不再要求現場簽到驗證碼。 */
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

