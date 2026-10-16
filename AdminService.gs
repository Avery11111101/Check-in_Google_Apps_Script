/**
 * ============================================================================
 * AdminService.gs
 * 管理端核心服務：無限層級資料夾樹狀名冊 (R1)、Tiered Fast Store 秒級讀寫 (R2)、
 * 雲端試算表永久同步 (adminSyncToSheets) 與儲存健康度監控 (adminGetStorageHealth)
 * ============================================================================
 */

var ADMIN_ROSTER_BULK_MAX_ = 500;

/**
 * 輔助函式：若 payload 未提供 eventId，自動從分組 ID 或系統單一活動解析
 */
function resolveEventIdForGroup_(groupId) {
  if (!groupId) return '';
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.GROUPS);
  if (!sh) return '';
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(groupId)) {
      return String(rows[i][1] || '');
    }
  }
  return '';
}

/**
 * 輔助函式：若 payload 未提供 eventId，自動從人員 ID 解析所屬活動
 */
function resolveEventIdForPerson_(personId) {
  if (!personId) return '';
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.ROSTER);
  if (!sh) return '';
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(personId)) {
      return String(rows[i][1] || '');
    }
  }
  return '';
}

// ============================================================================
// R1: 無限層級資料夾樹狀分類 (GROUPS CRUD)
// ============================================================================

/**
 * 取得活動之所有分組（支援無限層級鄰接表與物化路徑）
 * 100% 透過 Fast Store 讀取，0 試算表 RPC 延遲 < 20ms
 * @param {string} eventId
 * @returns {Array<{groupId:string, parentId:string, name:string, path:string, sort:number, depth:number, category:string, groupName:string}>}
 */
function adminListGroups(eventId) {
  requireAdmin_();
  const eid = String(eventId || '').trim();
  if (!eid) return [];

  const store = fastStoreGet(eid);
  const groups = (store.groups || []).map(g => ({
    groupId: String(g.groupId),
    parentId: String(g.parentId || ''),
    name: String(g.name || g.groupName || ''),
    path: String(g.path || g.name || g.groupName || ''),
    sort: Number(g.sort || 0),
    depth: Number(g.depth || 0),
    category: String(g.category || (g.path ? g.path.split('/')[0] : DEFAULT_GROUP_CATEGORY_)),
    groupName: String(g.groupName || g.name || DEFAULT_GROUP_NAME_),
  }));

  return groups.sort((a, b) =>
    a.path.localeCompare(b.path, 'zh-Hant') ||
    (a.sort - b.sort) ||
    a.name.localeCompare(b.name, 'zh-Hant')
  );
}

/**
 * 新增分類節點（支援在任意層級建立子目錄，或向後相容舊版 category + groupName 呼叫）
 * @param {Object|string} payloadOrEventId
 * @param {Object} [data]
 * @returns {{ok:boolean, groupId:string, path:string, name:string, parentId:string, depth:number, sort:number}}
 */
function adminCreateGroup(payloadOrEventId, data) {
  requireAdmin_();
  let payload = {};
  if (payloadOrEventId && typeof payloadOrEventId === 'object') {
    payload = payloadOrEventId;
  } else if (typeof payloadOrEventId === 'string') {
    payload = Object.assign({}, data || {}, { eventId: payloadOrEventId });
  }

  const eventId = String(payload.eventId || '').trim();
  if (!eventId) throw new Error('缺少 eventId。');

  let parentId = String(payload.parentId != null ? payload.parentId : '').trim();
  let name = String(payload.name != null ? payload.name : (payload.groupName != null ? payload.groupName : '')).trim();
  const rawCat = String(payload.category != null ? payload.category : '').trim();
  const sort = Number(payload.sort || 0);

  const store = fastStoreGet(eventId);

  // 向下相容處理：若由舊版前端或測試傳入 category + groupName 且未指定 parentId
  if (!parentId && rawCat && rawCat !== name && rawCat !== DEFAULT_GROUP_CATEGORY_) {
    let parentGroup = (store.groups || []).find(g => g.name === rawCat && (!g.parentId || g.depth === 0));
    if (!parentGroup) {
      const rootId = newId_('grp');
      parentGroup = {
        groupId: rootId,
        parentId: '',
        name: rawCat,
        path: rawCat,
        sort: 0,
        depth: 0,
        category: rawCat,
        groupName: rawCat,
      };
      store.groups.push(parentGroup);
    }
    parentId = parentGroup.groupId;
  }

  if (!name) {
    name = rawCat || DEFAULT_GROUP_NAME_;
  }

  let depth = 0;
  let path = name;
  if (parentId) {
    const parentNode = (store.groups || []).find(g => g.groupId === parentId);
    if (parentNode) {
      depth = Number(parentNode.depth || 0) + 1;
      path = parentNode.path + '/' + name;
    } else {
      parentId = '';
      depth = 0;
      path = name;
    }
  }

  const groupId = newId_('grp');
  const newGroup = {
    groupId: groupId,
    parentId: parentId,
    name: name,
    sort: sort,
    depth: depth,
    path: path,
    category: path.split('/')[0] || DEFAULT_GROUP_CATEGORY_,
    groupName: name,
  };

  store.groups.push(newGroup);
  recalculateGroupPaths_(store.groups);
  fastStoreSave(eventId, store, true);
  invalidateBoardStateCache_(eventId);

  return {
    ok: true,
    groupId: newGroup.groupId,
    path: newGroup.path,
    name: newGroup.name,
    parentId: newGroup.parentId,
    depth: newGroup.depth,
    sort: newGroup.sort,
  };
}

/**
 * 刪除分類節點（安全防護：若包含子目錄或已綁定名單成員則阻擋刪除）
 * @param {Object|string} payloadOrGroupId
 * @param {string} [secondArg]
 * @returns {{ok:boolean}}
 */
function adminDeleteGroup(payloadOrGroupId, secondArg) {
  requireAdmin_();
  let groupId = '';
  let eventId = '';

  if (payloadOrGroupId && typeof payloadOrGroupId === 'object') {
    groupId = String(payloadOrGroupId.groupId || payloadOrGroupId.id || '').trim();
    eventId = String(payloadOrGroupId.eventId || '').trim();
  } else if (typeof payloadOrGroupId === 'string') {
    if (secondArg && typeof secondArg === 'string') {
      eventId = payloadOrGroupId.trim();
      groupId = secondArg.trim();
    } else {
      groupId = payloadOrGroupId.trim();
    }
  }

  if (!groupId) throw new Error('缺少 groupId。');
  if (!eventId) {
    eventId = resolveEventIdForGroup_(groupId);
  }
  if (!eventId) throw new Error('無法確認分組所屬活動 eventId。');

  const store = fastStoreGet(eventId);

  // 防護檢查 1：是否尚有子分類掛載於此分類下
  const hasChild = (store.groups || []).some(g => g.parentId === groupId);
  if (hasChild) {
    throw new Error('此分組下尚有子分類，請先刪除或移動子分類。');
  }

  // 防護檢查 2：是否仍有名冊成員綁定此分類
  const hasMember = (store.roster || []).some(r => r.groupId === groupId);
  if (hasMember) {
    throw new Error('此分組仍有名單綁定，請先調整名單。');
  }

  const prevLen = store.groups.length;
  store.groups = store.groups.filter(g => g.groupId !== groupId);
  if (store.groups.length === prevLen) {
    throw new Error('找不到分組。');
  }

  recalculateGroupPaths_(store.groups);
  fastStoreSave(eventId, store, true);
  invalidateBoardStateCache_(eventId);

  return { ok: true };
}

/**
 * 編輯分類資訊（支援改名、變更父層、變更排序並自動級聯更新子分類路徑）
 * @param {Object} payload
 * @returns {{ok:boolean, group:Object}}
 */
function adminUpdateGroup(payload) {
  requireAdmin_();
  let groupId = String((payload && (payload.groupId || payload.id)) || '').trim();
  let eventId = String((payload && payload.eventId) || '').trim();
  if (!groupId) throw new Error('缺少 groupId。');
  if (!eventId) eventId = resolveEventIdForGroup_(groupId);
  if (!eventId) throw new Error('無法確認分組所屬活動 eventId。');

  const store = fastStoreGet(eventId);
  const target = (store.groups || []).find(g => g.groupId === groupId);
  if (!target) throw new Error('找不到分組。');

  if (payload.name !== undefined) {
    const newName = String(payload.name).trim();
    if (!newName) throw new Error('分類名稱不可為空。');
    target.name = newName;
    target.groupName = newName;
  }

  if (payload.parentId !== undefined) {
    const nextParentId = String(payload.parentId || '').trim();
    if (nextParentId === groupId) {
      throw new Error('不能將分組的父分類設為自己。');
    }
    if (nextParentId) {
      // 走訪 nextParentId 之祖先鏈，防止將分類移動至其子分類下形成循環參照
      let curr = nextParentId;
      const visited = new Set();
      while (curr) {
        if (curr === groupId) {
          throw new Error('不能將分類移動至其子分類下（循環參照）。');
        }
        if (visited.has(curr)) break;
        visited.add(curr);
        const ancestor = (store.groups || []).find(g => g.groupId === curr);
        curr = ancestor && ancestor.parentId ? String(ancestor.parentId).trim() : '';
      }
    }
    target.parentId = nextParentId;
  }

  if (payload.sort !== undefined) {
    target.sort = Number(payload.sort || 0);
  }

  recalculateGroupPaths_(store.groups);
  fastStoreSave(eventId, store, true);
  invalidateBoardStateCache_(eventId);

  return { ok: true, group: target };
}

// ============================================================================
// R1: 名冊管理 (ROSTER CRUD) - 100% 對接 Fast Store
// ============================================================================

/**
 * 取得活動名冊（含完整分類階層麵包屑 groupPath）
 * 100% 透過 Fast Store 讀取，0 試算表 RPC 延遲 < 20ms
 * @param {string} eventId
 * @returns {Array<{personId:string, eventId:string, groupId:string, displayName:string, font:string, enabled:boolean, sort:number, hasPassword:boolean, groupPath:string}>}
 */
function adminListRoster(eventId) {
  requireAdmin_();
  const eid = String(eventId || '').trim();
  if (!eid) return [];

  const store = fastStoreGet(eid);
  const groupPathMap = new Map();
  (store.groups || []).forEach(g => {
    groupPathMap.set(g.groupId, g.path || g.name);
  });

  const out = (store.roster || []).map(r => ({
    personId: String(r.personId),
    eventId: eid,
    groupId: String(r.groupId || ''),
    displayName: String(r.displayName || ''),
    font: String(r.font || ''),
    enabled: r.enabled !== false,
    sort: Number(r.sort || 0),
    hasPassword: !!(r.passwordHash && String(r.passwordHash).trim()),
    groupPath: r.groupId && groupPathMap.has(r.groupId) ? groupPathMap.get(r.groupId) : '',
  }));

  return out.sort((a, b) =>
    (a.sort - b.sort) ||
    a.displayName.localeCompare(b.displayName, 'zh-Hant')
  );
}

/**
 * 單筆新增名冊成員（groupId 可掛載於樹中任意節點或為空＝未分類）
 * @param {Object} payload
 * @returns {{ok:boolean, personId:string, hasPassword:boolean}}
 */
function adminCreateRoster(payload) {
  requireAdmin_();
  const eventId = String(payload.eventId || '').trim();
  const groupId = String(payload.groupId || '').trim();
  const displayName = String(payload.displayName || '').trim();
  const sort = Number(payload.sort || 0);
  const font = String(payload.font || '').trim();
  const password = payload && payload.password ? String(payload.password).trim() : '';
  const passwordHash = password ? hashPassword_(password) : '';

  if (!eventId) throw new Error('缺少 eventId。');
  if (!displayName) throw new Error('姓名不可為空。');

  const store = fastStoreGet(eventId);
  const personId = newId_('p');

  store.roster.push({
    personId: personId,
    eventId: eventId,
    groupId: groupId,
    displayName: displayName,
    font: font,
    enabled: true,
    sort: sort,
    passwordHash: passwordHash,
    hasPassword: !!passwordHash,
  });

  fastStoreSave(eventId, store, true);
  invalidateBoardStateCache_(eventId);

  return { ok: true, personId: personId, hasPassword: !!passwordHash };
}

function adminCreatePerson(payload) {
  return adminCreateRoster(payload);
}

/**
 * 批次大量新增名單（多行姓名至同一活動同一分類）
 * @param {Object} payload
 * @returns {{ok:boolean, count:number, personIds:Array<string>}}
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

  const store = fastStoreGet(eventId);
  const personIds = [];
  for (let j = 0; j < names.length; j++) {
    const personId = newId_('p');
    personIds.push(personId);
    store.roster.push({
      personId: personId,
      eventId: eventId,
      groupId: groupId,
      displayName: names[j],
      font: '',
      enabled: true,
      sort: j,
      passwordHash: '',
      hasPassword: false,
    });
  }

  fastStoreSave(eventId, store, true);
  invalidateBoardStateCache_(eventId);

  return { ok: true, count: names.length, personIds: personIds };
}

/**
 * 批次匯入名冊（支援無限階層路徑：如「行政處/資訊科/系統組, 王小明, 1234」或多欄階層）
 * 自動遞迴建立各層分類，並將人員正確綁定至目標節點
 * @param {Object} payload
 * @returns {{ok:boolean, importedCount:number, createdGroupsCount:number}}
 */
function adminImportRosterBatch(payload) {
  requireAdmin_();
  const eventId = String((payload && payload.eventId) || '').trim();
  const rawText = String((payload && payload.rawText) || '').trim();
  if (!eventId) throw new Error('缺少 eventId。');
  if (!rawText) throw new Error('匯入內容不可為空。');

  const store = fastStoreGet(eventId);

  // 建立路徑對應表：path -> groupId
  const pathToGroupIdMap = new Map();
  (store.groups || []).forEach(g => {
    pathToGroupIdMap.set(g.path, g.groupId);
    if (g.depth === 0) pathToGroupIdMap.set(g.name, g.groupId);
  });

  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error('沒有有效的資料列。');

  let importedCount = 0;
  let createdGroupsCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let parts = [];
    if (line.indexOf('\t') !== -1) {
      parts = line.split('\t');
    } else if (line.indexOf(',') !== -1) {
      parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(s => s.replace(/^"|"$/g, '').trim());
    } else if (line.indexOf(';') !== -1) {
      parts = line.split(';');
    } else {
      parts = [line];
    }

    // 表頭略過判定
    if (i === 0) {
      const f0 = String(parts[0] || '').trim();
      const f1 = String(parts[1] || '').trim();
      const f2 = String(parts[2] || '').trim();
      if (f0 === '主類別' || f1 === '子類別' || f2 === '姓名' || f0 === '姓名' || f0 === '分類路徑') {
        continue;
      }
    }

    let pathStr = '';
    let name = '';
    let pwd = '';

    if (parts.length === 1) {
      name = String(parts[0] || '').trim();
    } else if (parts.length === 2) {
      pathStr = String(parts[0] || '').trim();
      name = String(parts[1] || '').trim();
    } else if (parts.length === 3) {
      if (String(parts[0] || '').indexOf('/') !== -1) {
        pathStr = String(parts[0] || '').trim();
        name = String(parts[1] || '').trim();
        pwd = String(parts[2] || '').trim();
      } else {
        // 向下相容傳統「主類別, 子類別, 姓名」格式
        pathStr = String(parts[0] || '').trim() + '/' + String(parts[1] || '').trim();
        name = String(parts[2] || '').trim();
      }
    } else {
      // 4 欄以上
      if (String(parts[0] || '').indexOf('/') !== -1) {
        pathStr = String(parts[0] || '').trim();
        name = String(parts[1] || '').trim();
        pwd = String(parts[2] || '').trim();
      } else {
        name = String(parts[parts.length - 2] || '').trim();
        pwd = String(parts[parts.length - 1] || '').trim();
        const pathSegments = parts.slice(0, parts.length - 2).map(s => String(s || '').trim()).filter(Boolean);
        pathStr = pathSegments.join('/');
      }
    }

    if (!name) continue;

    // 自動逐層解析與遞迴建立分類節點
    let targetGroupId = '';
    if (pathStr) {
      const segments = pathStr.split('/').map(s => s.trim()).filter(Boolean);
      let currentParentId = '';
      let accumulatedPath = '';

      for (let sIdx = 0; sIdx < segments.length; sIdx++) {
        const segName = segments[sIdx];
        accumulatedPath = accumulatedPath ? (accumulatedPath + '/' + segName) : segName;

        let existingId = pathToGroupIdMap.get(accumulatedPath);
        if (!existingId) {
          existingId = newId_('grp');
          const newGrp = {
            groupId: existingId,
            parentId: currentParentId,
            name: segName,
            sort: store.groups.length,
            depth: sIdx,
            path: accumulatedPath,
            category: accumulatedPath.split('/')[0] || DEFAULT_GROUP_CATEGORY_,
            groupName: segName,
          };
          store.groups.push(newGrp);
          pathToGroupIdMap.set(accumulatedPath, existingId);
          createdGroupsCount++;
        }
        currentParentId = existingId;
      }
      targetGroupId = currentParentId;
    }

    const personId = newId_('p');
    const passwordHash = pwd ? hashPassword_(pwd) : '';
    store.roster.push({
      personId: personId,
      eventId: eventId,
      groupId: targetGroupId,
      displayName: name,
      font: '',
      enabled: true,
      sort: store.roster.length,
      passwordHash: passwordHash,
      hasPassword: !!passwordHash,
    });
    importedCount++;
  }

  if (!importedCount) throw new Error('未解析出任何有效人員資料。');

  recalculateGroupPaths_(store.groups);
  fastStoreSave(eventId, store, true);
  invalidateBoardStateCache_(eventId);

  return {
    ok: true,
    importedCount: importedCount,
    createdGroupsCount: createdGroupsCount,
  };
}

/**
 * 編輯人員資訊（支援移動所屬分類、修改姓名、啟用狀態、自訂排序或重設密碼）
 * @param {Object} payload
 * @returns {{ok:boolean, hasPassword:boolean}}
 */
function adminUpdateRoster(payload) {
  requireAdmin_();
  const personId = String((payload && payload.personId) || '').trim();
  if (!personId) throw new Error('缺少 personId。');
  let eventId = String((payload && payload.eventId) || '').trim();
  if (!eventId) eventId = resolveEventIdForPerson_(personId);
  if (!eventId) throw new Error('無法確認人員所屬活動 eventId。');

  const store = fastStoreGet(eventId);
  const hit = (store.roster || []).find(r => r.personId === personId);
  if (!hit) throw new Error('找不到人員。');

  if (payload.groupId !== undefined) hit.groupId = String(payload.groupId || '').trim();
  if (payload.displayName !== undefined) {
    const dn = String(payload.displayName).trim();
    if (dn) hit.displayName = dn;
  }
  if (payload.font !== undefined) hit.font = String(payload.font || '').trim();
  if (payload.enabled !== undefined) hit.enabled = !!payload.enabled;
  if (payload.sort !== undefined) hit.sort = Number(payload.sort || 0);
  if (payload.password !== undefined) {
    const pwd = String(payload.password).trim();
    hit.passwordHash = pwd ? hashPassword_(pwd) : '';
    hit.hasPassword = !!hit.passwordHash;
  }

  fastStoreSave(eventId, store, true);
  invalidateBoardStateCache_(eventId);

  return { ok: true, hasPassword: !!hit.passwordHash };
}

function adminUpdatePerson(payload) {
  return adminUpdateRoster(payload);
}

/**
 * 重設成員密碼
 * @param {Object} payload
 * @returns {{ok:boolean, hasPassword:boolean}}
 */
function adminResetPersonPassword(payload) {
  requireAdmin_();
  const personId = String((payload && payload.personId) || '').trim();
  if (!personId) throw new Error('缺少 personId。');
  let eventId = String((payload && payload.eventId) || '').trim();
  if (!eventId) eventId = resolveEventIdForPerson_(personId);
  if (!eventId) throw new Error('無法確認人員所屬活動 eventId。');

  const newPassword = (payload && payload.newPassword != null) ? String(payload.newPassword).trim() : '';
  const passwordHash = newPassword ? hashPassword_(newPassword) : '';

  const store = fastStoreGet(eventId);
  const hit = (store.roster || []).find(r => r.personId === personId);
  if (!hit) throw new Error('找不到人員。');

  hit.passwordHash = passwordHash;
  hit.hasPassword = !!passwordHash;

  fastStoreSave(eventId, store, true);

  return { ok: true, hasPassword: !!passwordHash };
}

/**
 * 刪除名冊成員
 * @param {Object|string} payloadOrPersonId
 * @returns {{ok:boolean}}
 */
function adminDeleteRoster(payloadOrPersonId) {
  requireAdmin_();
  let personId = '';
  let eventId = '';
  if (payloadOrPersonId && typeof payloadOrPersonId === 'object') {
    personId = String(payloadOrPersonId.personId || '').trim();
    eventId = String(payloadOrPersonId.eventId || '').trim();
  } else if (typeof payloadOrPersonId === 'string') {
    personId = payloadOrPersonId.trim();
  }
  if (!personId) throw new Error('缺少 personId。');
  if (!eventId) eventId = resolveEventIdForPerson_(personId);
  if (!eventId) throw new Error('無法確認人員所屬活動 eventId。');

  const store = fastStoreGet(eventId);
  const prevLen = store.roster.length;
  store.roster = store.roster.filter(r => r.personId !== personId);
  if (store.roster.length === prevLen) {
    throw new Error('找不到人員。');
  }

  fastStoreSave(eventId, store, true);
  invalidateBoardStateCache_(eventId);

  return { ok: true };
}

function adminDeletePerson(payloadOrPersonId) {
  return adminDeleteRoster(payloadOrPersonId);
}

// ============================================================================
// R2: TIERED STORAGE SYNC & HEALTH MONITORING
// ============================================================================

/**
 * 批次永久同步至 Google Sheets 永久封存庫 (Tier 3)
 * 一次性全量批次覆寫（setValues），杜絕每次微操作之連續全表掃描
 * @param {Object|string} [payloadOrEventId]
 * @returns {{ok:boolean, success:boolean, count:number, groupsCount:number, timestamp:string}}
 */
function adminSyncToSheets(payloadOrEventId) {
  requireAdmin_();
  let eventId = '';
  if (payloadOrEventId && typeof payloadOrEventId === 'object') {
    eventId = String(payloadOrEventId.eventId || '').trim();
  } else if (typeof payloadOrEventId === 'string') {
    eventId = payloadOrEventId.trim();
  }
  if (!eventId) throw new Error('缺少 eventId。');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const store = fastStoreGet(eventId);
    const ss = getDb_();

    // 1. 同步 GROUPS 表 (7 欄：groupId, eventId, category, groupName, sort, parentId, path)
    const shGroups = ss.getSheetByName(SHEETS.GROUPS);
    const existingGroupRows = shGroups.getDataRange().getValues();
    const otherEventGroups = [];
    for (let g = 1; g < existingGroupRows.length; g++) {
      if (String(existingGroupRows[g][1]) !== eventId && existingGroupRows[g][0]) {
        otherEventGroups.push(existingGroupRows[g]);
      }
    }

    const currentEventGroups = (store.groups || []).map(g => [
      g.groupId,
      eventId,
      g.category || (g.path ? g.path.split('/')[0] : DEFAULT_GROUP_CATEGORY_),
      g.groupName || g.name || DEFAULT_GROUP_NAME_,
      Number(g.sort || 0),
      g.parentId || '',
      g.path || g.name || '',
    ]);

    const finalGroupRows = otherEventGroups.concat(currentEventGroups);
    if (existingGroupRows.length > 1) {
      shGroups.getRange(2, 1, existingGroupRows.length - 1, Math.max(shGroups.getLastColumn(), 7)).clearContent();
    }
    if (finalGroupRows.length > 0) {
      shGroups.getRange(2, 1, finalGroupRows.length, 7).setValues(finalGroupRows);
    }

    // 2. 同步 ROSTER 表 (8 欄：personId, eventId, groupId, displayName, font, enabled, sort, passwordHash)
    const shRoster = ss.getSheetByName(SHEETS.ROSTER);
    const existingRosterRows = shRoster.getDataRange().getValues();
    const otherEventRoster = [];
    for (let r = 1; r < existingRosterRows.length; r++) {
      if (String(existingRosterRows[r][1]) !== eventId && existingRosterRows[r][0]) {
        otherEventRoster.push(existingRosterRows[r]);
      }
    }

    const currentEventRoster = (store.roster || []).map(m => [
      m.personId,
      eventId,
      m.groupId || '',
      m.displayName || '',
      m.font || '',
      m.enabled !== false,
      Number(m.sort || 0),
      m.passwordHash || '',
    ]);

    const finalRosterRows = otherEventRoster.concat(currentEventRoster);
    if (existingRosterRows.length > 1) {
      shRoster.getRange(2, 1, existingRosterRows.length - 1, Math.max(shRoster.getLastColumn(), 8)).clearContent();
    }
    if (finalRosterRows.length > 0) {
      shRoster.getRange(2, 1, finalRosterRows.length, 8).setValues(finalRosterRows);
    }

    // 3. 同步至雲端硬碟活動資料夾專屬試算表（永久封存庫，供未來匯入活動使用）
    const driveSettingsUrl = syncEventToDriveSpreadsheet_(eventId, store);

    // 4. 更新快取狀態為已同步 (isDirty = false)
    store.isDirty = false;
    store.lastSynced = Date.now();
    fastStoreSave(eventId, store, false);

    const timeStr = cellToPlain_(new Date());
    return {
      ok: true,
      success: true,
      count: store.roster.length,
      groupsCount: store.groups.length,
      timestamp: timeStr,
      driveSettingsUrl: driveSettingsUrl || '',
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 將活動名冊與分組同步至雲端硬碟活動資料夾內的專屬試算表（永久封存庫），
 * 自動生成供未來匯入新活動專用的標準格式工作表。
 * @param {string} eventId
 * @param {Object} store
 * @returns {string} 試算表 URL
 */
function syncEventToDriveSpreadsheet_(eventId, store) {
  const eid = String(eventId || '').trim();
  if (!eid || !store) return '';
  try {
    const ssDb = getDb_();
    const shEvents = ssDb.getSheetByName(SHEETS.EVENTS);
    if (!shEvents) return '';
    const eventRows = shEvents.getDataRange().getValues();
    let folderId = '';
    let eventName = '';
    for (let i = 1; i < eventRows.length; i++) {
      if (String(eventRows[i][0]).trim() === eid) {
        eventName = String(eventRows[i][1] || '').trim();
        folderId = String(eventRows[i][5] || '').trim();
        break;
      }
    }
    if (!folderId) return '';

    let folder = null;
    try {
      folder = DriveApp.getFolderById(folderId);
    } catch (_e) {
      return '';
    }
    if (!folder) return '';

    // 尋找資料夾內的設定/封存試算表
    let settingsFile = null;
    if (typeof folder.getFiles === 'function') {
      const files = folder.getFiles();
      while (files && typeof files.hasNext === 'function' && files.hasNext()) {
        const f = files.next();
        const fn = typeof f.getName === 'function' ? f.getName() : '';
        const mime = typeof f.getMimeType === 'function' ? f.getMimeType() : '';
        if ((!mime || mime === 'application/vnd.google-apps.spreadsheet') &&
            (fn.indexOf('_設定') !== -1 || fn.indexOf('設定') !== -1 || fn.indexOf('封存') !== -1)) {
          settingsFile = f;
          break;
        }
      }
    }

    let targetSs = null;
    if (settingsFile && typeof settingsFile.getId === 'function') {
      try {
        targetSs = SpreadsheetApp.openById(settingsFile.getId());
      } catch (_e2) {}
    }

    if (!targetSs) {
      const stamp = typeof driveTimeStampForNaming_ === 'function' ? driveTimeStampForNaming_() : String(Date.now());
      const safe = typeof sanitizeDriveSegment_ === 'function' ? sanitizeDriveSegment_(eventName, 80) : (eventName || '活動');
      const title = '電子簽到_' + safe + '_' + stamp + '_設定';
      try {
        const created = SpreadsheetApp.create(title);
        const createdFile = DriveApp.getFileById(created.getId());
        if (createdFile && typeof createdFile.moveTo === 'function') {
          createdFile.moveTo(folder);
        }
        targetSs = created;
      } catch (_e3) {
        return '';
      }
    }

    if (!targetSs) return '';

    // 建立群組對照 Map
    const groupMap = new Map();
    (store.groups || []).forEach(g => {
      groupMap.set(String(g.groupId), g);
    });

    // 1. 活動匯入名冊工作表 (供未來直接複製或匯出 CSV 匯入活動使用)
    let shImport = targetSs.getSheetByName('活動匯入名冊');
    if (!shImport) {
      shImport = targetSs.insertSheet('活動匯入名冊', 0);
    }
    if (typeof shImport.clear === 'function') shImport.clear();
    const importHeaders = ['分類路徑', '姓名', '密碼', '排序', '啟用狀態'];
    const importRows = [importHeaders];

    (store.roster || []).forEach(m => {
      const g = groupMap.get(String(m.groupId)) || {};
      const path = g.path || g.name || DEFAULT_GROUP_NAME_;
      importRows.push([
        path,
        m.displayName || '',
        m.passwordHash ? '(已加密防偽)' : '',
        Number(m.sort || 0),
        m.enabled !== false ? 'TRUE' : 'FALSE',
      ]);
    });

    if (importRows.length > 0 && typeof shImport.getRange === 'function') {
      shImport.getRange(1, 1, importRows.length, importHeaders.length).setValues(importRows);
      if (typeof shImport.setFrozenRows === 'function') shImport.setFrozenRows(1);
    }

    // 2. 分組工作表
    let shGroups = targetSs.getSheetByName('分組');
    if (!shGroups) shGroups = targetSs.insertSheet('分組');
    if (typeof shGroups.clear === 'function') shGroups.clear();
    const groupHeaders = ['groupId', '分類路徑', '名稱', '層級深度', '排序', '父節點Id'];
    const groupData = [groupHeaders];
    (store.groups || []).forEach(g => {
      groupData.push([
        g.groupId || '',
        g.path || g.name || '',
        g.name || g.groupName || '',
        Number(g.depth || 0),
        Number(g.sort || 0),
        g.parentId || '',
      ]);
    });
    if (groupData.length > 0 && typeof shGroups.getRange === 'function') {
      shGroups.getRange(1, 1, groupData.length, groupHeaders.length).setValues(groupData);
      if (typeof shGroups.setFrozenRows === 'function') shGroups.setFrozenRows(1);
    }

    // 3. 名單工作表
    let shRoster = targetSs.getSheetByName('名單');
    if (!shRoster) shRoster = targetSs.insertSheet('名單');
    if (typeof shRoster.clear === 'function') shRoster.clear();
    const rosterHeaders = ['personId', '所屬分類路徑', '姓名', '排序', '啟用狀態', 'groupId'];
    const rosterData = [rosterHeaders];
    (store.roster || []).forEach(m => {
      const g = groupMap.get(String(m.groupId)) || {};
      rosterData.push([
        m.personId || '',
        g.path || g.name || '',
        m.displayName || '',
        Number(m.sort || 0),
        m.enabled !== false,
        m.groupId || '',
      ]);
    });
    if (rosterData.length > 0 && typeof shRoster.getRange === 'function') {
      shRoster.getRange(1, 1, rosterData.length, rosterHeaders.length).setValues(rosterData);
      if (typeof shRoster.setFrozenRows === 'function') shRoster.setFrozenRows(1);
    }

    // 4. 說明工作表
    let shNote = targetSs.getSheetByName('說明');
    if (!shNote) shNote = targetSs.insertSheet('說明');
    if (typeof shNote.clear === 'function') shNote.clear();
    const timeStr = typeof cellToPlain_ === 'function' ? cellToPlain_(new Date()) : new Date().toLocaleString();
    if (typeof shNote.getRange === 'function') {
      shNote.getRange(1, 1, 6, 1).setValues([
        ['【電子簽到活動雲端硬碟永久封存庫】'],
        ['活動名稱：' + eventName],
        ['活動 ID (eventId)：' + eid],
        ['最後同步時間：' + timeStr],
        ['【未來活動匯入使用指南】：'],
        ['若要在未來建立新活動時重複使用此名單，請開啟「活動匯入名冊」工作表，全選複製內容後，在後台點擊「批次匯入名冊」並貼上即可完全還原！'],
      ]);
      if (typeof shNote.setColumnWidth === 'function') shNote.setColumnWidth(1, 620);
    }

    return typeof targetSs.getUrl === 'function' ? targetSs.getUrl() : '';
  } catch (err) {
    Logger.log('syncEventToDriveSpreadsheet_ notice: ' + (err && err.message));
    return '';
  }
}

/**
 * 取得平臺儲存健康狀態（容量使用量、百分比、所處儲存層級與健康警示）
 * @param {Object|string} [payloadOrEventId]
 * @returns {{ok:boolean, usedBytes:number, maxBytes:number, percent:number, tier:string, status:string, healthLabel:string, isDriveOverflowActive:boolean, isDirty:boolean, lastSheetsSyncTime:string, itemCounts:Object}}
 */
function adminGetStorageHealth(payloadOrEventId) {
  requireAdmin_();
  let eventId = '';
  if (payloadOrEventId && typeof payloadOrEventId === 'object') {
    eventId = String(payloadOrEventId.eventId || '').trim();
  } else if (typeof payloadOrEventId === 'string') {
    eventId = payloadOrEventId.trim();
  }

  const usedBytes = fastStoreCalculatePropertiesBytes_();
  const maxBytes = 512000; // 500 KB GAS PropertiesService 總上限
  const percent = Math.min(100, Math.round((usedBytes / maxBytes) * 1000) / 10);

  let status = 'HEALTHY';
  let healthLabel = '容量充足 (優良)';
  if (usedBytes > 409600) {
    status = 'CRITICAL';
    healthLabel = '逼近上限 (溢位啟動)';
  } else if (usedBytes > 307200) {
    status = 'WARNING';
    healthLabel = '用量較高 (注意)';
  }

  const meta = eventId ? fastStoreGetMetadata(eventId) : null;
  const isDriveOverflowActive = !!(meta && meta.driveFileId);
  const tier = isDriveOverflowActive ? 'drive' : 'properties';

  return {
    ok: true,
    usedBytes: usedBytes,
    maxBytes: maxBytes,
    percent: percent,
    tier: tier,
    status: status,
    healthLabel: healthLabel,
    isDriveOverflowActive: isDriveOverflowActive,
    isDirty: !!(meta && meta.isDirty),
    lastSheetsSyncTime: meta && meta.lastSynced ? cellToPlain_(new Date(meta.lastSynced)) : '尚未同步',
    itemCounts: {
      groups: meta ? Number(meta.groupsCount || 0) : 0,
      roster: meta ? Number(meta.rosterCount || 0) : 0,
    },
  };
}

/**
 * 手動切換活動之 Google Drive 溢位擴充儲存
 * @param {Object} payload
 * @returns {{ok:boolean, isDriveOverflowActive:boolean}}
 */
function adminToggleDriveOverflow(payload) {
  requireAdmin_();
  const eventId = String((payload && payload.eventId) || '').trim();
  const enabled = !!(payload && payload.enabled);
  if (!eventId) throw new Error('缺少 eventId。');

  const store = fastStoreGet(eventId);
  if (enabled) {
    // 強制溢位至 Google Drive
    fastStoreSave(eventId, store, store.isDirty, true);
  } else {
    // 轉回 PropertiesService
    fastStoreClear(eventId);
    fastStoreSave(eventId, store, store.isDirty, false);
  }

  const meta = fastStoreGetMetadata(eventId);
  return {
    ok: true,
    isDriveOverflowActive: !!(meta && meta.driveFileId),
  };
}

// ============================================================================
// 看板與配對輔助 API
// ============================================================================

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
