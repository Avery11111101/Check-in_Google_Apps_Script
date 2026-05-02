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
      startAt: r[2] || '',
      endAt: r[3] || '',
      isOpen: String(r[4] || '') === 'TRUE' || r[4] === true,
      driveFolderId: String(r[5] || ''),
      driveFolderUrl: String(r[6] || ''),
      createdAt: r[7] || '',
    });
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
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

function publicListRoster(eventId) {
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.ROSTER);
  const rows = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[1]) !== String(eventId)) continue;
    if (String(r[5]) === 'FALSE' || r[5] === false) continue;
    out.push({ personId: String(r[0]), displayName: String(r[3] || '') });
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hant'));
}

