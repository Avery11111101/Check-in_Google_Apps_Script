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
      hasPassword: !!String(r[7] || '').trim(),
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
  const password = payload && payload.password ? String(payload.password).trim() : '';
  const passwordHash = password ? hashPassword_(password) : '';
  if (!eventId) throw new Error('缺少 eventId。');
  if (!displayName) throw new Error('姓名不可為空。');

  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.ROSTER);
  const personId = newId_('p');
  sh.appendRow([personId, eventId, groupId, displayName, '', true, sort, passwordHash]);
  return { ok: true, personId, hasPassword: !!passwordHash };
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
    rows.push([personId, eventId, groupId, names[j], '', true, j, '']);
  }
  sh.getRange(startRow, 1, rows.length, 8).setValues(rows);
  return { ok: true, count: names.length, personIds: personIds };
}

/**
 * 批次匯入名冊（支援 CSV 格式或貼上多列資料：主類別,子類別,姓名,密碼）。
 * 自動建立不存在之群組，並將密碼雜湊化安全儲存。
 */
function adminImportRosterBatch(payload) {
  requireAdmin_();
  const eventId = String((payload && payload.eventId) || '').trim();
  const rawText = String((payload && payload.rawText) || '').trim();
  if (!eventId) throw new Error('缺少 eventId。');
  if (!rawText) throw new Error('匯入內容不可為空。');

  const ss = getDb_();
  const shGroups = ss.getSheetByName(SHEETS.GROUPS);
  const grpRows = shGroups.getDataRange().getValues();
  const groupMap = {};
  for (let g = 1; g < grpRows.length; g++) {
    if (String(grpRows[g][1]) === eventId && grpRows[g][0]) {
      const cat = String(grpRows[g][2] || '').trim() || DEFAULT_GROUP_CATEGORY_;
      const name = String(grpRows[g][3] || '').trim() || DEFAULT_GROUP_NAME_;
      groupMap[cat + ':::' + name] = String(grpRows[g][0]);
    }
  }

  const lines = rawText.split(/\r?\n/).map(function(l) { return l.trim(); }).filter(Boolean);
  if (!lines.length) throw new Error('沒有有效的資料列。');

  const newGroupRows = [];
  const rosterRows = [];
  let importedCount = 0;
  let createdGroupsCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let parts = [];
    if (line.indexOf('\t') !== -1) {
      parts = line.split('\t');
    } else if (line.indexOf(',') !== -1) {
      parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(function(s) {
        return s.replace(/^"|"$/g, '').trim();
      });
    } else if (line.indexOf(';') !== -1) {
      parts = line.split(';');
    } else {
      parts = [line];
    }

    if (i === 0) {
      const f0 = String(parts[0] || '').trim();
      const f1 = String(parts[1] || '').trim();
      const f2 = String(parts[2] || '').trim();
      if (f0 === '主類別' || f1 === '子類別' || f2 === '姓名' || f0 === '姓名') {
        continue;
      }
    }

    let cat = '';
    let grp = '';
    let name = '';
    let pwd = '';

    if (parts.length >= 3) {
      cat = String(parts[0] || '').trim();
      grp = String(parts[1] || '').trim();
      name = String(parts[2] || '').trim();
      pwd = parts[3] ? String(parts[3]).trim() : '';
    } else if (parts.length === 2) {
      grp = String(parts[0] || '').trim();
      name = String(parts[1] || '').trim();
    } else {
      name = String(parts[0] || '').trim();
    }

    if (!name) continue;

    const norm = normalizeGroupCategoryAndName_(cat, grp);
    const key = norm.category + ':::' + norm.groupName;
    let targetGroupId = groupMap[key];
    if (!targetGroupId) {
      targetGroupId = newId_('grp');
      groupMap[key] = targetGroupId;
      newGroupRows.push([targetGroupId, eventId, norm.category, norm.groupName, Object.keys(groupMap).length]);
      createdGroupsCount++;
    }

    const personId = newId_('p');
    const passwordHash = pwd ? hashPassword_(pwd) : '';
    rosterRows.push([personId, eventId, targetGroupId, name, '', true, importedCount, passwordHash]);
    importedCount++;
  }

  if (!rosterRows.length) throw new Error('未解析出任何有效人員資料。');

  if (newGroupRows.length > 0) {
    const lastG = shGroups.getLastRow();
    shGroups.getRange(lastG + 1, 1, newGroupRows.length, 5).setValues(newGroupRows);
  }

  const shRoster = ss.getSheetByName(SHEETS.ROSTER);
  const lastR = shRoster.getLastRow();
  shRoster.getRange(lastR + 1, 1, rosterRows.length, 8).setValues(rosterRows);

  return {
    ok: true,
    importedCount: importedCount,
    createdGroupsCount: createdGroupsCount,
  };
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
    const nextFont = (payload.font !== undefined) ? String(payload.font) : String(r[4] || '');
    const nextEnabled = (payload.enabled !== undefined) ? !!payload.enabled : !(String(r[5]) === 'FALSE' || r[5] === false);
    const nextSort = (payload.sort !== undefined) ? Number(payload.sort) : Number(r[6] || 0);
    let nextPasswordHash = String(r[7] || '');
    if (payload.password !== undefined) {
      const pwd = String(payload.password).trim();
      nextPasswordHash = pwd ? hashPassword_(pwd) : '';
    }
    sh.getRange(i + 1, 3, 1, 6).setValues([[nextGroupId, nextName, nextFont, nextEnabled, nextSort, nextPasswordHash]]);
    return { ok: true, hasPassword: !!nextPasswordHash };
  }
  throw new Error('找不到人員。');
}

function adminUpdatePerson(payload) {
  return adminUpdateRoster(payload);
}

function adminResetPersonPassword(payload) {
  requireAdmin_();
  const personId = String((payload && payload.personId) || '').trim();
  if (!personId) throw new Error('缺少 personId。');
  const newPassword = (payload && payload.newPassword != null) ? String(payload.newPassword).trim() : '';
  const passwordHash = newPassword ? hashPassword_(newPassword) : '';

  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.ROSTER);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === personId) {
      sh.getRange(i + 1, 8).setValue(passwordHash);
      return { ok: true, hasPassword: !!passwordHash };
    }
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

function adminDeletePerson(payload) {
  return adminDeleteRoster(payload);
}

/** 產生 6 位看板一次性授權碼（現場看板輸入後換取工作階段；與簽到用 6 位驗證碼不同）。 */
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

