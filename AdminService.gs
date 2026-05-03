function adminListGroups(eventId) {
  requireAdmin_();
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.GROUPS);
  const rows = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[1]) !== String(eventId)) continue;
    if (!r[0]) continue;
    const norm = normalizeGroupCategoryAndName_(String(r[2] || ''), String(r[3] || ''));
    out.push({ groupId: String(r[0]), category: norm.category, groupName: norm.groupName, sort: Number(r[4] || 0) });
  }
  return out.sort((a, b) => a.category.localeCompare(b.category, 'zh-Hant') || (a.sort - b.sort) || a.groupName.localeCompare(b.groupName, 'zh-Hant'));
}

function adminCreateGroup(payload) {
  requireAdmin_();
  const eventId = String(payload.eventId || '').trim();
  const rawCat = String(payload.category || '').trim();
  const rawName = String(payload.groupName || '').trim();
  const sort = Number(payload.sort || 0);
  if (!eventId) throw new Error('缺少 eventId。');

  const norm = normalizeGroupCategoryAndName_(rawCat, rawName);
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.GROUPS);
  const groupId = newId_('grp');
  sh.appendRow([groupId, eventId, norm.category, norm.groupName, sort]);
  return { ok: true, groupId };
}

function adminDeleteGroup(payload) {
  requireAdmin_();
  const groupId = String(payload.groupId || '').trim();
  if (!groupId) throw new Error('缺少 groupId。');

  // 先檢查是否有人員綁定
  const ss = getDb_();
  const shRoster = ss.getSheetByName(SHEETS.ROSTER);
  const roster = shRoster.getDataRange().getValues();
  for (let i = 1; i < roster.length; i++) {
    if (String(roster[i][2]) === groupId) throw new Error('此分組仍有名單綁定，請先調整名單。');
  }

  const sh = ss.getSheetByName(SHEETS.GROUPS);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === groupId) {
      sh.deleteRow(i + 1);
      return { ok: true };
    }
  }
  throw new Error('找不到分組。');
}

function adminListRoster(eventId) {
  requireAdmin_();
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.ROSTER);
  const rows = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[1]) !== String(eventId)) continue;
    if (!r[0]) continue;
    out.push({
      personId: String(r[0]),
      groupId: String(r[2] || ''),
      displayName: String(r[3] || ''),
      font: String(r[4] || ''),
      enabled: !(String(r[5]) === 'FALSE' || r[5] === false),
      sort: Number(r[6] || 0),
    });
  }
  return out.sort((a, b) => (a.sort - b.sort) || a.displayName.localeCompare(b.displayName, 'zh-Hant'));
}

function adminCreateRoster(payload) {
  requireAdmin_();
  const eventId = String(payload.eventId || '').trim();
  const groupId = String(payload.groupId || '').trim();
  const displayName = String(payload.displayName || '').trim();
  const sort = Number(payload.sort || 0);
  if (!eventId) throw new Error('缺少 eventId。');
  if (!displayName) throw new Error('姓名不可為空。');

  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.ROSTER);
  const personId = newId_('p');
  sh.appendRow([personId, eventId, groupId, displayName, '', true, sort]);
  return { ok: true, personId };
}

/** 一次大量寫入名單列數上限（避免超時）。 */
var ADMIN_ROSTER_BULK_MAX_ = 500;

/**
 * 一次新增多名成員至同一活動、同一分組（groupId 可空＝未綁定分組）。
 * @param {{eventId:string, groupId?:string, displayNames?:string[]}} payload
 */
function adminCreateRosterBulk(payload) {
  requireAdmin_();
  const eventId = String(payload.eventId || '').trim();
  const groupId = String(payload.groupId != null ? payload.groupId : '').trim();
  if (!eventId) throw new Error('缺少 eventId。');

  const raw = payload && payload.displayNames;
  const names = [];
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const n = String(raw[i] || '').trim();
      if (n) names.push(n);
    }
  }
  if (!names.length) throw new Error('沒有有效的姓名。');
  if (names.length > ADMIN_ROSTER_BULK_MAX_) {
    throw new Error('一次最多新增 ' + ADMIN_ROSTER_BULK_MAX_ + ' 筆，請分批操作。');
  }

  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.ROSTER);
  const lastRow = sh.getLastRow();
  const startRow = lastRow < 1 ? 2 : lastRow + 1;
  const rows = [];
  const personIds = [];
  for (let j = 0; j < names.length; j++) {
    const personId = newId_('p');
    personIds.push(personId);
    rows.push([personId, eventId, groupId, names[j], '', true, j]);
  }
  sh.getRange(startRow, 1, rows.length, 7).setValues(rows);
  return { ok: true, count: names.length, personIds: personIds };
}

function adminUpdateRoster(payload) {
  requireAdmin_();
  const personId = String(payload.personId || '').trim();
  if (!personId) throw new Error('缺少 personId。');

  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.ROSTER);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]) !== personId) continue;
    const nextGroupId = (payload.groupId !== undefined) ? String(payload.groupId) : String(r[2] || '');
    const nextName = (payload.displayName !== undefined) ? String(payload.displayName) : String(r[3] || '');
    const nextEnabled = (payload.enabled !== undefined) ? !!payload.enabled : !(String(r[5]) === 'FALSE' || r[5] === false);
    const nextSort = (payload.sort !== undefined) ? Number(payload.sort) : Number(r[6] || 0);
    sh.getRange(i + 1, 3, 1, 5).setValues([[nextGroupId, nextName, String(r[4] || ''), nextEnabled, nextSort]]);
    return { ok: true };
  }
  throw new Error('找不到人員。');
}

function adminDeleteRoster(payload) {
  requireAdmin_();
  const personId = String(payload.personId || '').trim();
  if (!personId) throw new Error('缺少 personId。');

  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.ROSTER);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === personId) {
      sh.deleteRow(i + 1);
      return { ok: true };
    }
  }
  throw new Error('找不到人員。');
}

/** 產生 6 位看板配對碼（現場看板輸入後可取得即時 QR，無須在網址帶 checkinToken）。 */
function adminCreateBoardPairCode(eventId) {
  requireAdmin_();
  const id = String(eventId || '').trim();
  if (!id) throw new Error('缺少 eventId。');
  return createBoardPairCodeForEvent_(id);
}

/** 看板「名單變更全螢幕轉場」全域預設（單台瀏覽器可於看板頁覆寫）。 */
function adminGetBoardTransitionDefault() {
  requireAdmin_();
  return { ok: true, enabled: getBoardTransitionDefault_() };
}

function adminSetBoardTransitionDefault(payload) {
  requireAdmin_();
  const en = !!(payload && payload.enabled);
  PropertiesService.getScriptProperties().setProperty('BOARD_TRANSITION_DEFAULT', en ? 'true' : 'false');
  return { ok: true, enabled: en };
}

