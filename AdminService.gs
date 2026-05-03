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
    out.push({ groupId: String(r[0]), category: String(r[2] || ''), groupName: String(r[3] || ''), sort: Number(r[4] || 0) });
  }
  return out.sort((a, b) => a.category.localeCompare(b.category, 'zh-Hant') || (a.sort - b.sort) || a.groupName.localeCompare(b.groupName, 'zh-Hant'));
}

function adminCreateGroup(payload) {
  requireAdmin_();
  const eventId = String(payload.eventId || '').trim();
  const category = String(payload.category || '').trim();
  const groupName = String(payload.groupName || '').trim();
  const sort = Number(payload.sort || 0);
  if (!eventId) throw new Error('缺少 eventId。');
  if (!category) throw new Error('分類不可為空。');
  if (!groupName) throw new Error('分組名稱不可為空。');

  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.GROUPS);
  const groupId = newId_('grp');
  sh.appendRow([groupId, eventId, category, groupName, sort]);
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

