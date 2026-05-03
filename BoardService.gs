/** 看板用：匿名可讀活動 id／名稱／是否開放簽到（不含 Drive 連結）。 */
function publicListBoardEvents() {
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
      isOpen: String(r[4] || '') === 'TRUE' || r[4] === true,
      createdAt: cellToPlain_(r[7]),
    });
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { ok: true, events: out };
}

function publicGetBoardState(eventId) {
  const ss = getDb_();
  const shGroups = ss.getSheetByName(SHEETS.GROUPS);
  const shRoster = ss.getSheetByName(SHEETS.ROSTER);
  const shStatus = ss.getSheetByName(SHEETS.STATUS);

  const groupRows = shGroups.getDataRange().getValues();
  const rosterRows = shRoster.getDataRange().getValues();
  const statusRows = shStatus.getDataRange().getValues();

  const groups = [];
  const groupMap = new Map(); // groupId -> {category, groupName, sort}
  for (let i = 1; i < groupRows.length; i++) {
    const r = groupRows[i];
    if (String(r[1]) !== String(eventId)) continue;
    const groupId = String(r[0] || '');
    if (!groupId) continue;
    const g = {
      groupId,
      category: String(r[2] || ''),
      groupName: String(r[3] || ''),
      sort: Number(r[4] || 0),
    };
    groupMap.set(groupId, g);
    groups.push(g);
  }

  groups.sort((a, b) => {
    const c = a.category.localeCompare(b.category, 'zh-Hant');
    if (c !== 0) return c;
    return (a.sort - b.sort) || a.groupName.localeCompare(b.groupName, 'zh-Hant');
  });

  const statusMap = new Map(); // `${eventId}::${personId}` -> {status,lastTime}
  for (let i = 1; i < statusRows.length; i++) {
    const r = statusRows[i];
    if (String(r[0]) !== String(eventId)) continue;
    const personId = String(r[1] || '');
    if (!personId) continue;
    statusMap.set(eventId + '::' + personId, { status: String(r[2] || 'NOT_YET'), lastTime: cellToPlain_(r[3]) });
  }

  const peopleByGroup = new Map(); // groupId -> []
  for (let i = 1; i < rosterRows.length; i++) {
    const r = rosterRows[i];
    if (String(r[1]) !== String(eventId)) continue;
    if (String(r[5]) === 'FALSE' || r[5] === false) continue;
    const groupId = String(r[2] || '');
    const displayName = String(r[3] || '');
    const sort = Number(r[6] || 0);
    const st = statusMap.get(eventId + '::' + String(r[0])) || { status: 'NOT_YET', lastTime: '' };
    const g = groupMap.get(groupId) || { category: '', groupName: '未分組', sort: 9999 };
    const p = {
      personId: String(r[0] || ''),
      displayName,
      category: g.category,
      groupName: g.groupName,
      status: st.status,
      statusLabel: statusLabel_(st.status),
      lastTime: st.lastTime ? String(st.lastTime) : '',
      sort,
    };
    if (!peopleByGroup.has(groupId)) peopleByGroup.set(groupId, []);
    peopleByGroup.get(groupId).push(p);
  }

  const outGroups = groups.map(g => ({
    category: g.category,
    groupName: g.groupName,
    groupId: g.groupId,
    people: (peopleByGroup.get(g.groupId) || []).sort((a, b) => (a.sort - b.sort) || a.displayName.localeCompare(b.displayName, 'zh-Hant')),
  }));

  // 把未分組的人也加到最後（如果有）
  const ungrouped = peopleByGroup.get('') || [];
  if (ungrouped.length) {
    outGroups.push({
      category: '',
      groupName: '未分組',
      groupId: '',
      people: ungrouped.sort((a, b) => (a.sort - b.sort) || a.displayName.localeCompare(b.displayName, 'zh-Hant')),
    });
  }

  /** `now` 用字串避免 HtmlService 客戶端序列化含 Date 物件時整包變 null。 */
  return { ok: true, now: cellToPlain_(new Date()), groups: outGroups };
}

