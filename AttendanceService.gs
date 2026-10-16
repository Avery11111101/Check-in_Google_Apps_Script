const ALLOWED_ACTIONS_ = ['IN', 'OUT'];

function validateAttendancePayload_(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('無效的請求資料。');
  const eventId = String(payload.eventId || '').trim();
  const personId = String(payload.personId || '').trim();
  const action = String(payload.action || '').trim().toUpperCase();
  const font = String(payload.font || '').trim();
  const token = payload.token != null ? String(payload.token).trim() : '';
  const password = payload.password != null ? String(payload.password).trim() : '';

  if (!eventId) throw new Error('缺少 eventId。');
  if (eventId.length > 64) throw new Error('eventId 格式異常。');
  if (!personId) throw new Error('缺少 personId。');
  if (personId.length > 64) throw new Error('personId 格式異常。');
  if (!ALLOWED_ACTIONS_.includes(action)) throw new Error('action 必須是 IN 或 OUT。');
  if (font.length > 64) throw new Error('font 參數過長。');
  if (token.length > 32) throw new Error('token 參數過長。');
  if (password.length > 100) throw new Error('密碼長度超出限制。');

  return { eventId, personId, action, font, token, password, clientMeta: payload.clientMeta || {} };
}

function publicSubmitAttendance(payload) {
  const p = validateAttendancePayload_(payload);

  // 1. 於鎖外進行驗證，不佔用鎖排隊資源
  assertPublicEventToken_(p.eventId, p.token);

  const eventMeta = getEventMeta_(p.eventId);
  if (!eventMeta.isOpen) throw new Error('此活動尚未開放簽到/簽退。請通知管理員開啟。');

  const person = getPersonInEvent_(p.eventId, p.personId);

  // 密碼驗證：若活動設定 requirePassword 且人員已有密碼
  if (eventMeta.requirePassword) {
    if (person.passwordHash) {
      if (!p.password) {
        throw new Error('此活動需要輸入個人簽到密碼。');
      }
      const inputHash = p.password.length === 64 ? p.password.toLowerCase() : hashPassword_(p.password);
      if (inputHash !== person.passwordHash) {
        throw new Error('個人簽到密碼錯誤。若忘記密碼請洽管理員重設。');
      }
    } else if (p.password) {
      // 若人員尚未設定密碼且提供了密碼，初次簽到自動綁定
      const newHash = hashPassword_(p.password);
      const ss = getDb_();
      const shRoster = ss.getSheetByName(SHEETS.ROSTER);
      shRoster.getRange(person.rowIndex, 8).setValue(newHash);
    }
  }

  // 2. 鎖內僅執行狀態比對與原子性寫入（持鎖時間極短）
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const now = new Date();
    const serverTimeStr = cellToPlain_(now);

    const ss = getDb_();
    const shStatus = ss.getSheetByName(SHEETS.STATUS);
    const statusRows = shStatus.getDataRange().getValues();

    let targetRow = -1;
    let lastStatus = 'NOT_YET';
    let lastTime = null;

    for (let i = 1; i < statusRows.length; i++) {
      const r = statusRows[i];
      if (String(r[0]) === p.eventId && String(r[1]) === p.personId) {
        targetRow = i + 1;
        lastStatus = String(r[2] || 'NOT_YET');
        lastTime = r[3];
        break;
      }
    }

    const minMs = 15 * 1000;
    if (lastTime && (now.getTime() - new Date(lastTime).getTime()) < minMs) {
      throw new Error('操作太頻繁，請稍後再試。');
    }

    // 防重複：同狀態重送不寫 log
    if (p.action === 'IN' && lastStatus === 'IN') {
      return { ok: true, serverTime: serverTimeStr, deduped: true, status: 'IN' };
    }
    if (p.action === 'OUT' && lastStatus === 'OUT') {
      return { ok: true, serverTime: serverTimeStr, deduped: true, status: 'OUT' };
    }

    // 原子寫入 Status 與 Log
    if (targetRow > 0) {
      shStatus.getRange(targetRow, 3, 1, 2).setValues([[p.action, now]]);
    } else {
      shStatus.appendRow([p.eventId, p.personId, p.action, now]);
    }

    const shLogs = ss.getSheetByName(SHEETS.LOGS);
    const logId = newId_('log');
    shLogs.appendRow([logId, p.eventId, p.personId, p.action, now, p.font, JSON.stringify(p.clientMeta || {})]);

    invalidateBoardStateCache_(p.eventId);
    return { ok: true, serverTime: serverTimeStr, status: p.action };
  } finally {
    lock.releaseLock();
  }
}

function publicChangePassword(payload) {
  const eventId = String((payload && payload.eventId) || '').trim();
  const personId = String((payload && payload.personId) || '').trim();
  const oldPassword = String((payload && payload.oldPassword) || '').trim();
  const newPassword = String((payload && payload.newPassword) || '').trim();
  const token = payload && payload.token != null ? String(payload.token).trim() : '';

  if (!eventId || !personId) throw new Error('缺少必要參數。');
  if (!newPassword) throw new Error('新密碼不可為空。');
  if (newPassword.length < 4 || newPassword.length > 50) {
    throw new Error('新密碼長度須介於 4 至 50 字元。');
  }

  assertPublicEventToken_(eventId, token);

  const meta = getEventMeta_(eventId);
  if (!meta.isOpen) {
    throw new Error('此活動目前未開放簽到，無法變更個人密碼。');
  }
  if (!meta.allowChangePassword) {
    throw new Error('此活動未允許成員自行變更密碼，請洽管理員。');
  }

  const person = getPersonInEvent_(eventId, personId);
  if (person.passwordHash) {
    const oldHash = oldPassword.length === 64 ? oldPassword.toLowerCase() : hashPassword_(oldPassword);
    if (oldHash !== person.passwordHash) {
      throw new Error('舊密碼不正確，請重新輸入。');
    }
  }

  const newHash = hashPassword_(newPassword);
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.ROSTER);
  sh.getRange(person.rowIndex, 8).setValue(newHash);

  return { ok: true, message: '密碼已成功更新！' };
}

function publicGetPersonStatus(eventId, personId, token) {
  const eid = String(eventId || '').trim();
  assertPublicEventToken_(eid, token);
  const eventMeta = getEventMeta_(eid);
  const person = getPersonInEvent_(eid, personId);
  const s = getStatus_(eid, personId);
  /** 一律為純字串，避免 HtmlService 序列化含 Date 時整包變 null（客戶端讀不到 status）。 */
  const lastTimeStr = cellToPlain_(s.lastTime);
  return {
    ok: true,
    status: String(s.status || 'NOT_YET'),
    statusLabel: String(statusLabel_(s.status)),
    lastTime: lastTimeStr,
    requirePassword: !!eventMeta.requirePassword,
    allowChangePassword: !!eventMeta.allowChangePassword,
    hasPassword: !!person.passwordHash,
  };
}

function getEventMeta_(eventId) {
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.EVENTS);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]) === String(eventId)) {
      return {
        eventId: String(r[0]),
        name: String(r[1] || ''),
        isOpen: String(r[4] || '') === 'TRUE' || r[4] === true,
        requirePassword: String(r[8] || '') === 'TRUE' || r[8] === true,
        allowChangePassword: String(r[9] || '') === 'TRUE' || r[9] === true,
      };
    }
  }
  throw new Error('找不到活動 eventId。');
}

function isEventOpen_(eventId) {
  return getEventMeta_(eventId).isOpen;
}

function getPersonInEvent_(eventId, personId) {
  const ss = getDb_();
  const sh = ss.getSheetByName(SHEETS.ROSTER);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]) === String(personId) && String(r[1]) === String(eventId)) {
      if (String(r[5]) === 'FALSE' || r[5] === false) throw new Error('此人員已停用。');
      return {
        rowIndex: i + 1,
        personId: String(r[0]),
        eventId: String(r[1]),
        groupId: String(r[2] || ''),
        displayName: String(r[3] || ''),
        font: String(r[4] || ''),
        enabled: true,
        sort: Number(r[6] || 0),
        passwordHash: String(r[7] || '').trim(),
      };
    }
  }
  throw new Error('此人員不在本活動名單中。');
}

function assertPersonInEvent_(eventId, personId) {
  return !!getPersonInEvent_(eventId, personId);
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


