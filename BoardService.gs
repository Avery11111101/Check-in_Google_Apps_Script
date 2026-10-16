/**
 * ============================================================================
 * BoardService.gs
 * 即時看板服務：公開活動清單、Fast Store 秒級名冊讀取與即時簽到樹狀狀態彙整
 * ============================================================================
 */

/**
 * 匿名可讀活動 id／名稱／是否開放簽到（不含 Drive 連結）。
 * @param {boolean} [onlyOpen] 若為 true，僅回傳「已開放簽到」的活動（簽到頁下拉用，降低活動清單外洩）。
 */
function publicListBoardEvents(onlyOpen) {
  const filterOpen = onlyOpen === true;
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.EVENTS);
  const rows = sh ? sh.getDataRange().getValues() : [];

  // 一次讀取 Config 表，避免 N+1 呼叫 getEventCheckinToken_
  const shCfg = ss.getSheetByName(SHEETS.CONFIG);
  const cfgRows = shCfg ? shCfg.getDataRange().getValues() : [];
  const tokenMap = {};
  for (let c = 1; c < cfgRows.length; c++) {
    const k = String(cfgRows[c][0] || '');
    if (k.indexOf('EVENT_CHECKIN_TOKEN_') === 0 && k.indexOf('EVENT_CHECKIN_TOKEN_PREV_') !== 0 && k.indexOf('EVENT_CHECKIN_TOKEN_ROTATE_') !== 0 && k.indexOf('EVENT_CHECKIN_TOKEN_LEGACY_') !== 0) {
      const eid = k.replace('EVENT_CHECKIN_TOKEN_', '');
      tokenMap[eid] = String(cfgRows[c][1] || '').trim();
    }
  }

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
      requiresCheckinCode: !!(tokenMap[eidRow] || String(getEventCheckinToken_(eidRow) || '').trim()),
      requirePassword: String(r[8] || '') === 'TRUE' || r[8] === true,
      allowChangePassword: String(r[9] || '') === 'TRUE' || r[9] === true,
    });
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { ok: true, events: out };
}

/**
 * 取得活動之完整即時看板狀態（分組、名冊、樹狀階層與個人簽到狀態）
 * 分組與名冊改自 Fast Store 讀取（0 試算表 RPC，延遲 < 100ms）
 * 同時回傳舊版向下相容的 groups/categories 與全新無限階層樹狀 tree 物件
 * @param {string} eventId
 * @param {string} token
 * @returns {Object}
 */
function publicGetBoardState(eventId, token) {
  const eid = String(eventId || '').trim();
  assertPublicEventTokenOrBoardSession_(eid, token);

  const checkinUrl = buildPublicCheckinUrl_(eid, getEventCheckinToken_(eid));

  const configuredTtl = getBoardStateCacheTtlSeconds_();
  const ttl = configuredTtl > 0 ? Math.max(configuredTtl, 20) : 20;
  if (eid) {
    try {
      const cache = CacheService.getScriptCache();
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

  // 1. 從 Fast Store 讀取分組與名冊（消除對 SHEETS.GROUPS 與 SHEETS.ROSTER 之全表掃描 RPC）
  const store = fastStoreGet(eid);
  const groups = store.groups || [];
  const roster = store.roster || [];

  const groupMap = new Map();
  groups.forEach(g => {
    groupMap.set(g.groupId, {
      groupId: g.groupId,
      parentId: g.parentId || '',
      name: g.name || g.groupName || DEFAULT_GROUP_NAME_,
      category: g.category || (g.path ? g.path.split('/')[0] : DEFAULT_GROUP_CATEGORY_),
      groupName: g.groupName || g.name || DEFAULT_GROUP_NAME_,
      sort: Number(g.sort || 0),
      depth: Number(g.depth || 0),
      path: g.path || g.name || g.groupName || '',
    });
  });

  // 2. 從試算表僅讀取即時狀態表 STATUS
  const ss = getDb_();
  const shStatus = ss.getSheetByName(SHEETS.STATUS);
  const statusRows = shStatus ? shStatus.getDataRange().getValues() : [];

  const statusMap = new Map(); // `${eid}::${personId}` -> {status, lastTime}
  for (let i = 1; i < statusRows.length; i++) {
    const r = statusRows[i];
    if (String(r[0]) !== eid) continue;
    const personId = String(r[1] || '');
    if (!personId) continue;
    statusMap.set(eid + '::' + personId, {
      status: String(r[2] || 'NOT_YET'),
      lastTime: cellToPlain_(r[3]),
    });
  }

  // 3. 組裝人員資料至各分組
  const peopleByGroup = new Map();
  const unknownGroupLabels = normalizeGroupCategoryAndName_('', '');

  roster.forEach(r => {
    if (r.enabled === false) return; // 僅納入啟用成員
    const personId = String(r.personId);
    const groupId = String(r.groupId || '');
    const displayName = String(r.displayName || '');
    const sort = Number(r.sort || 0);
    const st = statusMap.get(eid + '::' + personId) || { status: 'NOT_YET', lastTime: '' };
    const g = groupMap.get(groupId) || {
      category: unknownGroupLabels.category,
      groupName: unknownGroupLabels.groupName,
      sort: 9999,
      path: '',
      depth: 0,
    };

    const p = {
      personId: personId,
      displayName: displayName,
      category: g.category,
      groupName: g.groupName,
      status: st.status,
      statusLabel: statusLabel_(st.status),
      lastTime: st.lastTime ? String(st.lastTime) : '',
      sort: sort,
      groupPath: g.path,
    };

    if (!peopleByGroup.has(groupId)) peopleByGroup.set(groupId, []);
    peopleByGroup.get(groupId).push(p);
  });

  // 4. 構建向下相容的 outGroups
  const sortedGroups = groups.slice().sort((a, b) => {
    const c = (a.category || '').localeCompare(b.category || '', 'zh-Hant');
    if (c !== 0) return c;
    return (a.sort - b.sort) || (a.groupName || '').localeCompare(b.groupName || '', 'zh-Hant');
  });

  const outGroups = sortedGroups.map(g => ({
    category: g.category,
    groupName: g.groupName,
    groupId: g.groupId,
    path: g.path,
    depth: g.depth,
    people: (peopleByGroup.get(g.groupId) || []).sort((a, b) => (a.sort - b.sort) || a.displayName.localeCompare(b.displayName, 'zh-Hant')),
  }));

  // 未分類人員掛載至末尾
  const ungrouped = peopleByGroup.get('') || [];
  if (ungrouped.length) {
    const u = normalizeGroupCategoryAndName_('', '');
    outGroups.push({
      category: u.category,
      groupName: u.groupName,
      groupId: '',
      path: u.category,
      depth: 0,
      people: ungrouped.sort((a, b) => (a.sort - b.sort) || a.displayName.localeCompare(b.displayName, 'zh-Hant')),
    });
  }

  // 5. 構建向下相容的 outCategories
  const categoryMap = new Map();
  for (let i = 0; i < outGroups.length; i++) {
    const og = outGroups[i];
    const catName = og.category || '未分類';
    if (!categoryMap.has(catName)) {
      categoryMap.set(catName, {
        category: catName,
        total: 0,
        signed: 0,
        notYet: 0,
        signedOut: 0,
        groups: [],
      });
    }
    const catEntry = categoryMap.get(catName);
    catEntry.groups.push({
      groupId: og.groupId,
      groupName: og.groupName,
      people: og.people,
    });
    for (let pIdx = 0; pIdx < og.people.length; pIdx++) {
      const st = og.people[pIdx].status;
      catEntry.total++;
      if (st === 'IN') catEntry.signed++;
      else if (st === 'OUT') catEntry.signedOut++;
      else catEntry.notYet++;
    }
  }

  const outCategories = Array.from(categoryMap.values()).map(c => {
    c.attendanceRate = c.total > 0 ? ((c.signed / c.total) * 100).toFixed(1) : '0.0';
    return c;
  });

  // 6. 構建全新無限層級樹狀目錄結構 (tree: { rootFolders, unassignedMembers })
  const tree = buildFolderTree_(groups, roster, statusMap);

  const nowStr = cellToPlain_(new Date());
  const coreForCache = {
    ok: true,
    now: nowStr,
    groups: outGroups,
    categories: outCategories,
    roster: roster.filter(r => r.enabled !== false).map(r => {
      const pid = String(r.personId);
      const st = statusMap.get(eid + '::' + pid) || { status: 'NOT_YET', lastTime: '' };
      const g = groupMap.get(String(r.groupId || '')) || {};
      return {
        personId: pid,
        displayName: String(r.displayName || ''),
        groupId: String(r.groupId || ''),
        category: g.category || unknownGroupLabels.category,
        groupName: g.groupName || unknownGroupLabels.groupName,
        status: st.status,
        statusLabel: statusLabel_(st.status),
        lastTime: st.lastTime ? String(st.lastTime) : '',
        sort: Number(r.sort || 0),
        groupPath: g.path || '',
      };
    }),
    tree: tree,
  };

  const meta = getBoardCheckinQrExpiryMeta_(eid);
  const currentCheckinCode = getCurrentCheckinCodeForDisplay_(eid);
  const payload = Object.assign({}, coreForCache, { checkinUrl: checkinUrl, currentCheckinCode: currentCheckinCode }, meta);

  if (ttl > 0 && eid) {
    try {
      const cache = CacheService.getScriptCache();
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
