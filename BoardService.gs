/**
 * 匿名可讀活動 id／名稱／是否開放簽到（不含 Drive 連結）。
 * @param {boolean} [onlyOpen] 若為 true，僅回傳「已開放簽到」的活動（簽到頁下拉用，降低活動清單外洩）。
 */
function publicListBoardEvents(onlyOpen) {
  const filterOpen = onlyOpen === true;
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.EVENTS);
  const rows = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    const isOpen = String(r[4] || '') === 'TRUE' || r[4] === true;
    if (filterOpen && !isOpen) continue;
    const eidRow = String(r[0]);
    out.push({
      eventId: eidRow,
      name: String(r[1] || ''),
      isOpen,
      createdAt: cellToPlain_(r[7]),
      requiresCheckinCode: !!String(getEventCheckinToken_(eidRow) || '').trim(),
    });
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { ok: true, events: out };
}

function publicGetBoardState(eventId, token) {
  const eid = String(eventId || '').trim();
  assertPublicEventTokenOrBoardSession_(eid, token);

  const checkinUrl = buildPublicCheckinUrl_(eid, getEventCheckinToken_(eid));

  const ttl = getBoardStateCacheTtlSeconds_();
  if (ttl > 0 && eid) {
    try {
      const cache = CacheService.getDocumentCache();
      const hit = cache.get(boardStateCacheKey_(eid));
      if (hit) {
        const parsed = JSON.parse(hit);
        if (parsed && typeof parsed === 'object' && parsed.ok) {
          const freshUrl = buildPublicCheckinUrl_(eid, getEventCheckinToken_(eid));
          const meta = getBoardCheckinQrExpiryMeta_(eid);
          const currentCheckinCode = getCurrentCheckinCodeForDisplay_(eid);
          return Object.assign({}, parsed, { checkinUrl: freshUrl, currentCheckinCode: currentCheckinCode }, meta);
        }
      }
    } catch (_e) {
      // 快取未命中或解析失敗則重算
    }
  }

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
    if (String(r[1]) !== String(eid)) continue;
    const groupId = String(r[0] || '');
    if (!groupId) continue;
    const norm = normalizeGroupCategoryAndName_(String(r[2] || ''), String(r[3] || ''));
    const g = {
      groupId,
      category: norm.category,
      groupName: norm.groupName,
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

  const statusMap = new Map(); // `${eid}::${personId}` -> {status,lastTime}
  for (let i = 1; i < statusRows.length; i++) {
    const r = statusRows[i];
    if (String(r[0]) !== String(eid)) continue;
    const personId = String(r[1] || '');
    if (!personId) continue;
    statusMap.set(eid + '::' + personId, { status: String(r[2] || 'NOT_YET'), lastTime: cellToPlain_(r[3]) });
  }

  const peopleByGroup = new Map(); // groupId -> []
  const unknownGroupLabels = normalizeGroupCategoryAndName_('', '');
  for (let i = 1; i < rosterRows.length; i++) {
    const r = rosterRows[i];
    if (String(r[1]) !== String(eid)) continue;
    if (String(r[5]) === 'FALSE' || r[5] === false) continue;
    const groupId = String(r[2] || '');
    const displayName = String(r[3] || '');
    const sort = Number(r[6] || 0);
    const st = statusMap.get(eid + '::' + String(r[0])) || { status: 'NOT_YET', lastTime: '' };
    const g = groupMap.get(groupId) || {
      category: unknownGroupLabels.category,
      groupName: unknownGroupLabels.groupName,
      sort: 9999,
    };
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
    const u = normalizeGroupCategoryAndName_('', '');
    outGroups.push({
      category: u.category,
      groupName: u.groupName,
      groupId: '',
      people: ungrouped.sort((a, b) => (a.sort - b.sort) || a.displayName.localeCompare(b.displayName, 'zh-Hant')),
    });
  }

  /** `now` 用字串避免 HtmlService 客戶端序列化含 Date 物件時整包變 null。快取僅存名單狀態本體，簽到網址與失效倒數每次回傳時再併入，避免短 TTL 快取內文字過期。 */
  const nowStr = cellToPlain_(new Date());
  const coreForCache = { ok: true, now: nowStr, groups: outGroups };
  const meta = getBoardCheckinQrExpiryMeta_(eid);
  const currentCheckinCode = getCurrentCheckinCodeForDisplay_(eid);
  const payload = Object.assign({}, coreForCache, { checkinUrl: checkinUrl, currentCheckinCode: currentCheckinCode }, meta);
  if (ttl > 0 && eid) {
    try {
      const cache = CacheService.getDocumentCache();
      const serialized = JSON.stringify(coreForCache);
      if (serialized.length < 95000) {
        cache.put(boardStateCacheKey_(eid), serialized, ttl);
      }
    } catch (_e) {
      // 略過快取寫入（內容過大或配額）
    }
  }
  return payload;
}

