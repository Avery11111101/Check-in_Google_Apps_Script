function publicSubmitAttendance(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const eventId = String(payload.eventId || '').trim();
    const personId = String(payload.personId || '').trim();
    const action = String(payload.action || '').trim().toUpperCase(); // IN | OUT
    const font = String(payload.font || '').trim();
    const clientMeta = payload.clientMeta || {};
    const token = payload && payload.token != null ? String(payload.token) : '';

    if (!eventId) throw new Error('缺少 eventId。');
    if (!personId) throw new Error('缺少 personId。');
    if (action !== 'IN' && action !== 'OUT') throw new Error('action 必須是 IN 或 OUT。');

    assertPublicEventToken_(eventId, token);

    if (!isEventOpen_(eventId)) throw new Error('此活動尚未開放簽到/簽退。請通知管理員開啟。');
    assertPersonInEvent_(eventId, personId);

    const now = new Date();
    const serverTimeStr = cellToPlain_(now);
    const last = getStatus_(eventId, personId);
    const minMs = 15 * 1000;
    if (last.lastTime && (now.getTime() - new Date(last.lastTime).getTime()) < minMs) {
      throw new Error('操作太頻繁，請稍後再試。');
    }

    // 防重複：同狀態重送不寫 log
    if (action === 'IN' && last.status === 'IN') {
      return { ok: true, serverTime: serverTimeStr, deduped: true, status: 'IN' };
    }
    if (action === 'OUT' && last.status === 'OUT') {
      return { ok: true, serverTime: serverTimeStr, deduped: true, status: 'OUT' };
    }

    writeLog_(eventId, personId, action, now, font, clientMeta);
    setStatus_(eventId, personId, action, now);
    invalidateBoardStateCache_(eventId);
    return { ok: true, serverTime: serverTimeStr, status: action };
  } finally {
    lock.releaseLock();
  }
}

function publicGetPersonStatus(eventId, personId, token) {
  const eid = String(eventId || '').trim();
  assertPublicEventToken_(eid, token);
  const s = getStatus_(eid, personId);
  /** 一律為純字串，避免 HtmlService 序列化含 Date 時整包變 null（客戶端讀不到 status）。 */
  const lastTimeStr = cellToPlain_(s.lastTime);
  return {
    ok: true,
    status: String(s.status || 'NOT_YET'),
    statusLabel: String(statusLabel_(s.status)),
    lastTime: lastTimeStr,
  };
}

function isEventOpen_(eventId) {
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.EVENTS);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(eventId)) {
      return String(rows[i][4] || '') === 'TRUE' || rows[i][4] === true;
    }
  }
  throw new Error('找不到活動 eventId。');
}

function assertPersonInEvent_(eventId, personId) {
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.ROSTER);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]) === String(personId) && String(r[1]) === String(eventId)) {
      if (String(r[5]) === 'FALSE' || r[5] === false) throw new Error('此人員已停用。');
      return true;
    }
  }
  throw new Error('此人員不在本活動名單中。');
}

function writeLog_(eventId, personId, action, now, font, clientMeta) {
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.LOGS);
  const logId = newId_('log');
  sh.appendRow([logId, eventId, personId, action, now, font, JSON.stringify(clientMeta || {})]);
}

function getStatus_(eventId, personId) {
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.STATUS);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]) === String(eventId) && String(r[1]) === String(personId)) {
      const st = String(r[2] || 'NOT_YET');
      return { status: st, lastTime: cellToPlain_(r[3]) };
    }
  }
  return { status: 'NOT_YET', lastTime: '' };
}

function setStatus_(eventId, personId, status, now) {
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.STATUS);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]) === String(eventId) && String(r[1]) === String(personId)) {
      sh.getRange(i + 1, 3, 1, 2).setValues([[status, now]]);
      return;
    }
  }
  sh.appendRow([eventId, personId, status, now]);
}

function statusLabel_(status) {
  if (status === 'IN') return '已簽到';
  if (status === 'OUT') return '已簽退';
  return '未簽到';
}

