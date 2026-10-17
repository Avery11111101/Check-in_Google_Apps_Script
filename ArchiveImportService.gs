/**
 * @fileoverview 雲端硬碟封存活動匯入與還原服務
 * 負責掃描系統目錄下具有時間戳之封存活動試算表、解析結構相容性、保留原 eventId、完整還原密碼雜湊與名冊分組
 */

/**
 * 掃描系統根目錄下的所有封存活動試算表與版本檔案
 * @returns {{ ok: boolean, archives: Array<Object> }}
 */
function adminListDriveArchives() {
  requireAdmin_();
  try {
    const env = getInitializedEnvFast_();
    if (!env || !env.driveFolderId) {
      return { ok: true, archives: [] };
    }

    let rootFolder = null;
    try {
      rootFolder = DriveApp.getFolderById(env.driveFolderId);
    } catch (_e) {
      return { ok: true, archives: [] };
    }
    if (!rootFolder) return { ok: true, archives: [] };

    // 取得當前系統資料庫內已存在的活動清單，以供比對標記
    const ssDb = getDb_();
    const shEvents = ssDb.getSheetByName(SHEETS.EVENTS);
    const existingEventsMap = new Map();
    if (shEvents) {
      const eRows = shEvents.getDataRange().getValues();
      for (let i = 1; i < eRows.length; i++) {
        const eid = String(eRows[i][0] || '').trim();
        if (eid) {
          existingEventsMap.set(eid, {
            name: String(eRows[i][1] || '').trim(),
            isOpen: String(eRows[i][4] || '') === 'TRUE' || eRows[i][4] === true,
          });
        }
      }
    }

    const archives = [];
    const childFolders = rootFolder.getFolders();

    while (childFolders && childFolders.hasNext()) {
      const folder = childFolders.next();
      const folderName = folder.getName();
      const folderId = folder.getId();

      // 檢查子資料夾是否符合活動資料夾結構：如「電子簽到_...」
      const files = folder.getFiles();
      while (files && files.hasNext()) {
        const file = files.next();
        const mime = file.getMimeType();
        const fileName = file.getName();

        // 僅處理 Google 試算表且檔名符合設定/封存特徵
        if (mime === 'application/vnd.google-apps.spreadsheet' &&
            (fileName.indexOf('_設定') !== -1 || fileName.indexOf('設定') !== -1 || fileName.indexOf('封存') !== -1 || fileName.indexOf('電子簽到_') === 0)) {
          
          const meta = parseArchiveFileMetadata_(folderName, fileName, file, existingEventsMap);
          if (meta) {
            meta.folderId = folderId;
            meta.folderName = folderName;
            archives.push(meta);
          }
        }
      }
    }

    // 依更新時間新到舊排序
    archives.sort((a, b) => (b.rawTimestamp || 0) - (a.rawTimestamp || 0));

    return { ok: true, archives: archives };
  } catch (err) {
    Logger.log('adminListDriveArchives error: ' + (err && err.message));
    throw new Error('掃描雲端硬碟封存檔案失敗：' + (err && err.message));
  }
}

/**
 * 解析單一封存試算表之中繼資訊（相容任意後綴時間戳與不同工作表格式）
 * @private
 */
function parseArchiveFileMetadata_(folderName, fileName, file, existingEventsMap) {
  try {
    const fileId = file.getId();
    const lastUpdated = file.getLastUpdated();
    const rawTimestamp = lastUpdated ? lastUpdated.getTime() : 0;
    const timeFormatted = lastUpdated ? Utilities.formatDate(lastUpdated, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss') : '';

    // 解析檔名與活動名稱（智慧過濾任意時間戳記）
    // 檔名格式通常為：電子簽到_<活動名稱>_<yyyyMMdd_HHmmss_SSS>_設定
    let parsedEventName = '';
    let parsedStamp = '';

    const cleanBase = fileName.replace(/\.xlsx$/i, '').trim();
    const nameMatch = cleanBase.match(/^電子簽到_(.+?)(?:_(\d{8}(?:_\d{6}(?:_\d{3})?)?.*))?(?:_設定|_封存)?$/);
    if (nameMatch) {
      parsedEventName = nameMatch[1] || '';
      parsedStamp = nameMatch[2] || '';
    } else {
      // 嘗試從資料夾名稱還原活動名稱
      const folderMatch = folderName.match(/^電子簽到_(.+?)(?:_(\d{8}(?:_\d{6}(?:_\d{3})?)?.*))?$/);
      if (folderMatch) {
        parsedEventName = folderMatch[1] || '';
        parsedStamp = folderMatch[2] || '';
      } else {
        parsedEventName = cleanBase.replace(/_設定|_封存/g, '').trim();
      }
    }

    // 輕量開啟試算表以讀取「說明」工作表之 eventId 與同步時間
    let eventId = '';
    let eventNameFromNote = '';
    let syncTimeFromNote = '';
    let groupCountEst = 0;
    let rosterCountEst = 0;
    let hasCompleteSheets = false;
    let hasImportSheet = false;

    try {
      const ss = SpreadsheetApp.openById(fileId);
      const shNote = ss.getSheetByName('說明');
      if (shNote && typeof shNote.getDataRange === 'function') {
        const noteValues = shNote.getDataRange().getValues();
        for (let r = 0; r < Math.min(noteValues.length, 10); r++) {
          const rowText = String(noteValues[r][0] || '').trim();
          const idMatch = rowText.match(/(?:eventId|活動\s*ID)[^：:]*[：:]\s*(evt_[A-Za-z0-9_\-]+|[A-Za-z0-9_\-]+)/i);
          if (idMatch && idMatch[1]) {
            eventId = idMatch[1].trim();
          }
          const nameMatchInNote = rowText.match(/活動名稱[：:]\s*(.+)/i);
          if (nameMatchInNote && nameMatchInNote[1]) {
            eventNameFromNote = nameMatchInNote[1].trim();
          }
          const timeMatch = rowText.match(/最後同步時間[：:]\s*(.+)/i);
          if (timeMatch && timeMatch[1]) {
            syncTimeFromNote = timeMatch[1].trim();
          }
        }
      }

      // 檢查工作表存在性與估算名額
      const shGroups = ss.getSheetByName('分組');
      const shRoster = ss.getSheetByName('名單');
      const shImport = ss.getSheetByName('活動匯入名冊');

      if (shGroups && shRoster) {
        hasCompleteSheets = true;
        groupCountEst = Math.max(0, shGroups.getLastRow() - 1);
        rosterCountEst = Math.max(0, shRoster.getLastRow() - 1);
      } else if (shImport) {
        hasImportSheet = true;
        rosterCountEst = Math.max(0, shImport.getLastRow() - 1);
      }
    } catch (_ssErr) {
      // 若開表暫時受限，以檔名解析為主
    }

    const finalEventName = eventNameFromNote || parsedEventName || '未命名封存活動';
    const existsInfo = eventId ? existingEventsMap.get(eventId) : null;

    return {
      fileId: fileId,
      fileName: fileName,
      fileUrl: file.getUrl ? file.getUrl() : '',
      eventName: finalEventName,
      stamp: parsedStamp || '',
      eventId: eventId,
      syncTime: syncTimeFromNote || timeFormatted,
      lastUpdated: timeFormatted,
      rawTimestamp: rawTimestamp,
      groupCountEst: groupCountEst,
      rosterCountEst: rosterCountEst,
      hasCompleteSheets: hasCompleteSheets,
      hasImportSheet: hasImportSheet,
      existsInDb: !!existsInfo,
      existingDbName: existsInfo ? existsInfo.name : '',
      existingIsOpen: existsInfo ? existsInfo.isOpen : false,
    };
  } catch (err) {
    Logger.log('parseArchiveFileMetadata_ notice: ' + (err && err.message));
    return null;
  }
}

/**
 * 執行從雲端硬碟封存試算表匯入並還原活動
 * 遵循決策：保留原 eventId、覆寫或更新主資料庫、完整載入密碼雜湊、同步至 Fast Store
 * @param {{ fileId: string, customEventName?: string }} payload
 * @returns {Object} 還原結果
 */
function adminImportDriveArchive(payload) {
  requireAdmin_();
  const fileId = String(payload && payload.fileId || '').trim();
  if (!fileId) throw new Error('缺少封存檔案 ID (fileId)。');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('伺服器忙碌中（取得鎖定逾時），請稍後再試。');
  }

  try {
    const ssTarget = SpreadsheetApp.openById(fileId);
    if (!ssTarget) throw new Error('無法開啟指定的雲端硬碟試算表。');

    // 1. 取得說明資訊與原始 eventId
    let originalEventId = '';
    let archiveEventName = '';
    const shNote = ssTarget.getSheetByName('說明');
    if (shNote && typeof shNote.getDataRange === 'function') {
      const noteValues = shNote.getDataRange().getValues();
      for (let r = 0; r < Math.min(noteValues.length, 10); r++) {
        const rowText = String(noteValues[r][0] || '').trim();
        const idMatch = rowText.match(/(?:eventId|活動\s*ID)[^：:]*[：:]\s*(evt_[A-Za-z0-9_\-]+|[A-Za-z0-9_\-]+)/i);
        if (idMatch && idMatch[1]) {
          originalEventId = idMatch[1].trim();
        }
        const nameMatch = rowText.match(/活動名稱[：:]\s*(.+)/i);
        if (nameMatch && nameMatch[1]) {
          archiveEventName = nameMatch[1].trim();
        }
      }
    }

    // 決定最終 eventId（保留原 ID；若完全無 ID 則生成新 ID）
    const targetEventId = originalEventId || newId_('evt');
    const targetEventName = String(payload.customEventName || archiveEventName || ssTarget.getName().replace(/_設定|_封存/g, '')).trim();

    // 2. 解析分組與名單結構（優先：分組+名單工作表；降級：活動匯入名冊工作表）
    const parsedData = extractArchiveDataFromSpreadsheet_(ssTarget, targetEventId);
    const groups = parsedData.groups || [];
    const roster = parsedData.roster || [];

    // 3. 取得活動資料夾
    let targetFolderId = '';
    let targetFolderUrl = '';
    try {
      const targetFile = DriveApp.getFileById(fileId);
      const parents = targetFile.getParents();
      if (parents && parents.hasNext()) {
        const p = parents.next();
        targetFolderId = p.getId();
        targetFolderUrl = p.getUrl();
      }
    } catch (_driveErr) {}

    const now = new Date();
    const ssDb = getDb_();

    // 4. 同步更新/新增主庫 SHEETS.EVENTS
    const shEvents = ssDb.getSheetByName(SHEETS.EVENTS);
    if (!shEvents) throw new Error('系統主資料庫缺少 Events 工作表。');
    const eventRows = shEvents.getDataRange().getValues();
    let eventRowIndex = -1;

    for (let i = 1; i < eventRows.length; i++) {
      if (String(eventRows[i][0]).trim() === targetEventId) {
        eventRowIndex = i + 1; // 1-indexed
        break;
      }
    }

    if (eventRowIndex > 0) {
      // 既有活動覆寫更新
      shEvents.getRange(eventRowIndex, 2).setValue(targetEventName); // 活動名稱
      if (targetFolderId) shEvents.getRange(eventRowIndex, 6).setValue(targetFolderId);
      shEvents.getRange(eventRowIndex, 7).setValue(ssTarget.getUrl()); // 設定檔 URL
      shEvents.getRange(eventRowIndex, 8).setValue(now); // 更新時間
    } else {
      // 恢復/新增至主表 (eventId, name, startAt, endAt, isOpen, driveFolderId, driveFolderUrl, createdAt, requirePassword, allowChangePassword)
      shEvents.appendRow([
        targetEventId,
        targetEventName,
        '',
        '',
        false,
        targetFolderId,
        targetFolderUrl || ssTarget.getUrl(),
        now,
        false,
        false,
      ]);
    }

    // 5. 批次更新主庫 SHEETS.GROUPS
    const shGroups = ssDb.getSheetByName(SHEETS.GROUPS);
    if (shGroups) {
      const existingGrpRows = shGroups.getDataRange().getValues();
      const otherEventGroups = [];
      for (let g = 1; g < existingGrpRows.length; g++) {
        if (String(existingGrpRows[g][1]).trim() !== targetEventId && existingGrpRows[g][0]) {
          otherEventGroups.push(existingGrpRows[g]);
        }
      }

      const currentEventGroups = groups.map(g => [
        g.groupId,
        targetEventId,
        g.category || (g.path ? g.path.split('/')[0] : DEFAULT_GROUP_CATEGORY_),
        g.groupName || g.name || DEFAULT_GROUP_NAME_,
        Number(g.sort || 0),
        g.parentId || '',
        g.path || g.name || '',
      ]);

      const finalGroupRows = otherEventGroups.concat(currentEventGroups);
      if (existingGrpRows.length > 1) {
        shGroups.getRange(2, 1, existingGrpRows.length - 1, Math.max(shGroups.getLastColumn(), 7)).clearContent();
      }
      if (finalGroupRows.length > 0) {
        shGroups.getRange(2, 1, finalGroupRows.length, 7).setValues(finalGroupRows);
      }
    }

    // 6. 批次更新主庫 SHEETS.ROSTER（包含還原真實 passwordHash）
    const shRoster = ssDb.getSheetByName(SHEETS.ROSTER);
    if (shRoster) {
      const existingRosterRows = shRoster.getDataRange().getValues();
      const otherEventRoster = [];
      for (let r = 1; r < existingRosterRows.length; r++) {
        if (String(existingRosterRows[r][1]).trim() !== targetEventId && existingRosterRows[r][0]) {
          otherEventRoster.push(existingRosterRows[r]);
        }
      }

      const currentEventRoster = roster.map(m => [
        m.personId,
        targetEventId,
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
    }

    // 7. 同步寫入 Fast Store 快取層（立即可編輯與簽到）
    fastStoreSave(targetEventId, { groups: groups, roster: roster }, false);

    return {
      ok: true,
      eventId: targetEventId,
      name: targetEventName,
      groupCount: groups.length,
      rosterCount: roster.length,
      isRestored: eventRowIndex > 0,
      driveFolderUrl: targetFolderUrl,
      driveSettingsUrl: ssTarget.getUrl(),
    };
  } finally {
    try {
      lock.releaseLock();
    } catch (_e) {}
  }
}

/**
 * 從試算表多工作表中提取分組、名單與密碼雜湊
 * @private
 */
function extractArchiveDataFromSpreadsheet_(ssTarget, targetEventId) {
  const shGroups = ssTarget.getSheetByName('分組');
  const shRoster = ssTarget.getSheetByName('名單');
  const shImport = ssTarget.getSheetByName('活動匯入名冊');

  // 策略一：完整的「分組」與「名單」工作表
  if (shGroups && shRoster && shGroups.getLastRow() > 1) {
    const grpRows = shGroups.getDataRange().getValues();
    const grpHeaders = grpRows[0].map(h => String(h || '').trim());
    const groups = [];
    const groupKeyMap = new Map();

    const isAdvancedGrp = grpHeaders.indexOf('groupId') !== -1;
    const colGroupId = grpHeaders.indexOf('groupId');
    const colGrpPath = grpHeaders.indexOf('分類路徑');
    const colGrpName = grpHeaders.indexOf('名稱');
    const colGrpDepth = grpHeaders.indexOf('層級深度');
    const colGrpSort = grpHeaders.indexOf('排序');
    const colGrpParent = grpHeaders.indexOf('父節點Id');

    for (let i = 1; i < grpRows.length; i++) {
      const row = grpRows[i];
      if (!row || !row[0]) continue;

      if (isAdvancedGrp) {
        const gid = String(row[colGroupId] || newId_('grp')).trim();
        const path = String(row[colGrpPath] || row[colGrpName] || '').trim();
        const name = String(row[colGrpName] || path.split('/').pop() || '').trim();
        const gObj = {
          groupId: gid,
          parentId: String(row[colGrpParent] || '').trim(),
          name: name,
          groupName: name,
          category: path ? path.split('/')[0] : DEFAULT_GROUP_CATEGORY_,
          depth: Number(row[colGrpDepth] || 0),
          sort: Number(row[colGrpSort] || 0),
          path: path,
        };
        groups.push(gObj);
        groupKeyMap.set(gid, gObj);
        if (path) groupKeyMap.set(path, gObj);
      } else {
        // 舊版分組結構：category, groupName, sort
        const cat = String(row[0] || DEFAULT_GROUP_CATEGORY_).trim();
        const gName = String(row[1] || DEFAULT_GROUP_NAME_).trim();
        const gid = newId_('grp');
        const path = cat ? (cat + '/' + gName) : gName;
        const gObj = {
          groupId: gid,
          parentId: '',
          name: gName,
          groupName: gName,
          category: cat,
          depth: 1,
          sort: Number(row[2] || 0),
          path: path,
        };
        groups.push(gObj);
        groupKeyMap.set(path, gObj);
        groupKeyMap.set(gName, gObj);
      }
    }

    // 解析名單
    const rosRows = shRoster.getDataRange().getValues();
    const rosHeaders = rosRows[0].map(h => String(h || '').trim());
    const roster = [];

    const colPersonId = rosHeaders.indexOf('personId');
    const colRosPath = rosHeaders.indexOf('所屬分類路徑');
    const colRosName = rosHeaders.indexOf('姓名');
    const colRosSort = rosHeaders.indexOf('排序');
    const colRosEnabled = rosHeaders.indexOf('啟用狀態');
    const colRosGid = rosHeaders.indexOf('groupId');
    const colRosHash = rosHeaders.indexOf('passwordHash');

    // 嘗試從活動匯入名冊建立姓名/路徑對應的 Hash 備查 Map
    const importHashMap = new Map();
    if (shImport && shImport.getLastRow() > 1) {
      const impRows = shImport.getDataRange().getValues();
      for (let m = 1; m < impRows.length; m++) {
        const impPath = String(impRows[m][0] || '').trim();
        const impName = String(impRows[m][1] || '').trim();
        const impPwd = String(impRows[m][2] || '').trim();
        if (impName && impPwd && impPwd !== '(已加密防偽)') {
          importHashMap.set(impPath + '::' + impName, impPwd);
          importHashMap.set(impName, impPwd);
        }
      }
    }

    for (let j = 1; j < rosRows.length; j++) {
      const rRow = rosRows[j];
      if (!rRow || (!rRow[0] && !rRow[colRosName !== -1 ? colRosName : 2])) continue;

      if (colPersonId !== -1) {
        const pid = String(rRow[colPersonId] || newId_('per')).trim();
        const path = String(rRow[colRosPath] || '').trim();
        const dName = String(rRow[colRosName] || '').trim();
        let gid = String(rRow[colRosGid] || '').trim();
        if (!gid && path && groupKeyMap.has(path)) {
          gid = groupKeyMap.get(path).groupId;
        }

        // 讀取 passwordHash：優先取名單欄位，次取匯入名冊雜湊
        let pHash = colRosHash !== -1 ? String(rRow[colRosHash] || '').trim() : '';
        if (!pHash || pHash === '(已加密防偽)') {
          pHash = importHashMap.get(path + '::' + dName) || importHashMap.get(dName) || '';
        }

        roster.push({
          personId: pid,
          groupId: gid || (groups[0] ? groups[0].groupId : ''),
          displayName: dName,
          font: '',
          enabled: String(rRow[colRosEnabled]).toUpperCase() !== 'FALSE' && rRow[colRosEnabled] !== false,
          sort: Number(rRow[colRosSort] || 0),
          passwordHash: pHash,
          hasPassword: !!(pHash && pHash.trim()),
        });
      } else {
        // 舊版名單結構：category, groupName, displayName, sort, font, enabled
        const cat = String(rRow[0] || '').trim();
        const gName = String(rRow[1] || '').trim();
        const dName = String(rRow[2] || '').trim();
        const path = cat ? (cat + '/' + gName) : gName;
        const matchedG = groupKeyMap.get(path) || groupKeyMap.get(gName) || groups[0];

        let pHash = importHashMap.get(path + '::' + dName) || importHashMap.get(dName) || '';

        roster.push({
          personId: newId_('per'),
          groupId: matchedG ? matchedG.groupId : '',
          displayName: dName,
          font: String(rRow[4] || ''),
          enabled: String(rRow[5]).toUpperCase() !== 'FALSE' && rRow[5] !== false,
          sort: Number(rRow[3] || 0),
          passwordHash: pHash,
          hasPassword: !!(pHash && pHash.trim()),
        });
      }
    }

    return { groups: groups, roster: roster };
  }

  // 策略二：僅有「活動匯入名冊」工作表（依路徑斜線重組分類樹）
  if (shImport && shImport.getLastRow() > 1) {
    const impRows = shImport.getDataRange().getValues();
    const groupTree = [];
    const groupPathMap = new Map();
    const roster = [];

    for (let k = 1; k < impRows.length; k++) {
      const pathRaw = String(impRows[k][0] || DEFAULT_GROUP_NAME_).trim();
      const dName = String(impRows[k][1] || '').trim();
      const pwdRaw = String(impRows[k][2] || '').trim();
      const sort = Number(impRows[k][3] || 0);
      const enabled = String(impRows[k][4]).toUpperCase() !== 'FALSE' && impRows[k][4] !== false;

      if (!dName) continue;

      // 建立分組樹節點
      let currParentId = '';
      const parts = pathRaw.split('/').map(s => s.trim()).filter(Boolean);
      let accumulatedPath = '';

      parts.forEach((seg, depth) => {
        accumulatedPath = accumulatedPath ? (accumulatedPath + '/' + seg) : seg;
        if (!groupPathMap.has(accumulatedPath)) {
          const newGid = newId_('grp');
          const gNode = {
            groupId: newGid,
            parentId: currParentId,
            name: seg,
            groupName: seg,
            category: parts[0] || DEFAULT_GROUP_CATEGORY_,
            depth: depth,
            sort: 0,
            path: accumulatedPath,
          };
          groupTree.push(gNode);
          groupPathMap.set(accumulatedPath, gNode);
          currParentId = newGid;
        } else {
          currParentId = groupPathMap.get(accumulatedPath).groupId;
        }
      });

      const pHash = (pwdRaw && pwdRaw !== '(已加密防偽)') ? pwdRaw : '';

      roster.push({
        personId: newId_('per'),
        groupId: currParentId,
        displayName: dName,
        font: '',
        enabled: enabled,
        sort: sort,
        passwordHash: pHash,
        hasPassword: !!(pHash && pHash.trim()),
      });
    }

    return { groups: groupTree, roster: roster };
  }

  return { groups: [], roster: [] };
}
