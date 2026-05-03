function eventCheckinTokenKey_(eventId) {
  return 'EVENT_CHECKIN_TOKEN_' + String(eventId || '').trim();
}

function eventCheckinTokenPrevKey_(eventId) {
  return 'EVENT_CHECKIN_TOKEN_PREV_' + String(eventId || '').trim();
}

function eventCheckinTokenRotateSecondsKey_(eventId) {
  return 'EVENT_CHECKIN_TOKEN_ROTATE_SECONDS_' + String(eventId || '').trim();
}

function eventCheckinTokenRotatedAtKey_(eventId) {
  return 'EVENT_CHECKIN_TOKEN_ROTATED_AT_' + String(eventId || '').trim();
}

/** 自動輪替時曾生效過的密鑰列表（JSON 陣列），供掃描稍舊 QR 仍可通過驗證；長度有上限。 */
function eventCheckinTokenLegacyKey_(eventId) {
  return 'EVENT_CHECKIN_TOKEN_LEGACY_' + String(eventId || '').trim();
}

var CHECKIN_TOKEN_LEGACY_MAX_ = 12;

function readCheckinTokenLegacyList_(eventId) {
  const eid = String(eventId || '').trim();
  if (!eid) return [];
  const raw = String(getConfig_(eventCheckinTokenLegacyKey_(eid), '') || '').trim();
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(x => String(x || '').trim()).filter(Boolean);
  } catch (_e) {
    return [];
  }
}

function appendCheckinTokenToLegacy_(eventId, oldToken) {
  const eid = String(eventId || '').trim();
  const t = String(oldToken || '').trim();
  if (!eid || !t) return;
  let list = readCheckinTokenLegacyList_(eid);
  list = [t].concat(list.filter(x => x !== t)).slice(0, CHECKIN_TOKEN_LEGACY_MAX_);
  upsertConfig_(eventCheckinTokenLegacyKey_(eid), JSON.stringify(list));
}

function getEventCheckinToken_(eventId) {
  return String(getConfig_(eventCheckinTokenKey_(eventId), '') || '').trim();
}

function getEventCheckinTokenPrev_(eventId) {
  return String(getConfig_(eventCheckinTokenPrevKey_(eventId), '') || '').trim();
}

/**
 * 輪替週期（秒）：0 表示不自動變更；否則為 ≥30 之整數。
 */
function getEventCheckinRotateSeconds_(eventId) {
  const raw = String(getConfig_(eventCheckinTokenRotateSecondsKey_(eventId), '') || '').trim();
  if (!raw) return 0;
  const n = Math.floor(Number(raw));
  if (!isFinite(n) || n < 0) return 0;
  if (n === 0) return 0;
  return Math.max(30, n);
}

function tokenAuthMismatchError_() {
  return new Error('缺少或錯誤的現場簽到驗證碼。請向管理員確認目前 6 位數驗證碼，或於看板頁先完成看板授權。');
}

/** 活動未設定驗證碼卻帶入 token 時（避免任意六位數看似「通過驗證」）。 */
function tokenAuthSpuriousWhenNoCodeError_() {
  return new Error(
    '此活動未於後台設定「現場簽到驗證碼」，請勿填寫驗證碼欄位。若需要驗證碼，請洽管理員於管理頁產生或啟用。'
  );
}

/** 現場簽到驗證碼：6 位數字（100000–999999）。 */
function generateCheckinCode_() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * 若已逾輪替週期則在鎖內更新：prev ← 舊 current，current ← 新值。
 * 可能連續輪替數次以追上長時間未觸發之進度。
 */
function ensureCheckinTokenRotated_(eventId) {
  const eid = String(eventId || '').trim();
  if (!eid) return;

  const periodSec = getEventCheckinRotateSeconds_(eid);
  if (periodSec <= 0) return;

  const lock = LockService.getScriptLock();
  let acquired = false;
  try {
    acquired = lock.tryLock(30000);
    if (!acquired) return;

    let current = String(getConfig_(eventCheckinTokenKey_(eid), '') || '').trim();
    if (!current) return;

    const atRaw = String(getConfig_(eventCheckinTokenRotatedAtKey_(eid), '') || '').trim();
    let rotatedAt = Number(atRaw);
    if (!isFinite(rotatedAt) || rotatedAt <= 0) {
      rotatedAt = Date.now();
      upsertConfig_(eventCheckinTokenRotatedAtKey_(eid), String(rotatedAt));
      return;
    }

    const periodMs = periodSec * 1000;
    let now = Date.now();

    while (now - rotatedAt >= periodMs) {
      const oldCur = current;
      let next = generateCheckinCode_();
      let guard = 0;
      while (next === oldCur && guard < 20) {
        next = generateCheckinCode_();
        guard++;
      }
      current = next;
      upsertConfig_(eventCheckinTokenPrevKey_(eid), oldCur);
      appendCheckinTokenToLegacy_(eid, oldCur);
      upsertConfig_(eventCheckinTokenKey_(eid), current);
      rotatedAt += periodMs;
      upsertConfig_(eventCheckinTokenRotatedAtKey_(eid), String(rotatedAt));
      invalidateBoardStateCache_(eid);
      now = Date.now();
    }
  } finally {
    if (acquired) lock.releaseLock();
  }
}

function assertCheckinTokenMatches_(eventId, gotRaw) {
  const expected = getEventCheckinToken_(eventId);
  const got = String(gotRaw || '').trim();
  if (!expected) {
    if (got) throw tokenAuthSpuriousWhenNoCodeError_();
    return;
  }
  if (got === expected) return;
  const prev = getEventCheckinTokenPrev_(eventId);
  if (prev && got === prev) return;
  const legacy = readCheckinTokenLegacyList_(eventId);
  if (legacy.length && legacy.indexOf(got) !== -1) return;
  throw tokenAuthMismatchError_();
}

/**
 * 若該活動在 Attendance_Config 設有簽到密鑰，則必須帶入正確 token 才能存取公開 API。
 */
function assertPublicEventToken_(eventId, token) {
  const eid = String(eventId || '').trim();
  ensureCheckinTokenRotated_(eid);
  assertCheckinTokenMatches_(eid, token);
}

/** 看板配對碼（Script Cache）TTL，秒。 */
function boardPairTtlSeconds_() {
  return 180;
}

/** 看板工作階段 TTL（GAS Cache 上限 21600 秒）；每次成功讀看板會續期。 */
function boardSessionTtlSeconds_() {
  return 21600;
}

function boardPairCacheKey_(sixDigitCode) {
  return 'board_pair_' + String(sixDigitCode || '').trim();
}

function boardSessCacheKey_(sessionToken) {
  return 'board_sess_' + String(sessionToken || '').trim();
}

function getBoardSessionEventId_(sessionToken) {
  const t = String(sessionToken || '').trim();
  if (!t || t.indexOf('bs_') !== 0) return '';
  try {
    const v = CacheService.getScriptCache().get(boardSessCacheKey_(t));
    return String(v || '').trim();
  } catch (_e) {
    return '';
  }
}

function touchBoardSession_(sessionToken, eventId) {
  const t = String(sessionToken || '').trim();
  const eid = String(eventId || '').trim();
  if (!t || !eid) return;
  try {
    const cache = CacheService.getScriptCache();
    const cur = String(cache.get(boardSessCacheKey_(t)) || '').trim();
    if (cur !== eid) return;
    cache.put(boardSessCacheKey_(t), eid, boardSessionTtlSeconds_());
  } catch (_e) {
    // ignore
  }
}

/**
 * 看板用：僅接受有效之看板工作階段（bs_…）。現場簽到驗證碼不得用於讀取看板（避免掃 QR 旁可見之碼即取得名單）。
 */
function assertPublicEventTokenOrBoardSession_(eventId, clientCredential) {
  const eid = String(eventId || '').trim();
  ensureCheckinTokenRotated_(eid);
  const expected = getEventCheckinToken_(eid);
  if (!expected) return;
  const got = String(clientCredential || '').trim();
  const sid = getBoardSessionEventId_(got);
  if (sid === eid) {
    touchBoardSession_(got, eid);
    return;
  }
  throw tokenAuthMismatchError_();
}

/**
 * 管理員產生 6 位看板配對碼（須已登入且為管理員；由 adminCreateBoardPairCode 呼叫）。
 * @returns {{ ok: boolean, code: string, expiresInSeconds: number }}
 */
function createBoardPairCodeForEvent_(eventId) {
  const eid = String(eventId || '').trim();
  if (!eid) throw new Error('缺少 eventId。');
  ensureCheckinTokenRotated_(eid);
  if (!getEventCheckinToken_(eid)) throw new Error('此活動尚未設定現場簽到驗證碼，無須產生看板授權碼。');
  const cache = CacheService.getScriptCache();
  const ttl = boardPairTtlSeconds_();
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const key = boardPairCacheKey_(code);
    if (cache.get(key)) continue;
    cache.put(key, JSON.stringify({ eventId: eid }), ttl);
    return { ok: true, code: code, expiresInSeconds: ttl };
  }
  throw new Error('無法產生驗證碼，請稍後再試。');
}

/**
 * 看板前端：以管理員顯示的 6 位碼換取工作階段 token（一次性配對）。
 */
function publicExchangeBoardPairCode(eventId, code) {
  const eid = String(eventId || '').trim();
  if (!eid) throw new Error('請先選擇活動。');
  ensureCheckinTokenRotated_(eid);
  if (!getEventCheckinToken_(eid)) {
    throw new Error('此活動未設定現場簽到驗證碼，看板不需授權碼。');
  }
  const digits = String(code || '').replace(/\D/g, '');
  if (digits.length !== 6) throw new Error('請輸入 6 位數驗證碼。');
  const key = boardPairCacheKey_(digits);
  const cache = CacheService.getScriptCache();
  const raw = cache.get(key);
  if (!raw) {
    throw new Error('驗證碼錯誤或已過期，請向管理員重新索取。');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    cache.remove(key);
    throw new Error('驗證碼無效。');
  }
  const pairEid = parsed && parsed.eventId ? String(parsed.eventId).trim() : '';
  if (pairEid !== eid) {
    throw new Error('驗證碼與目前選擇的活動不符。');
  }
  cache.remove(key);
  const sessionToken = 'bs_' + Utilities.getUuid().replace(/-/g, '');
  cache.put(boardSessCacheKey_(sessionToken), eid, boardSessionTtlSeconds_());
  return { ok: true, boardSessionToken: sessionToken };
}

/** 組合簽到頁完整網址（供看板 QR 與輪詢更新）。不含驗證碼；使用者於簽到頁手動輸入目前 6 位碼。 */
function buildPublicCheckinUrl_(eventId, _unusedCheckinToken) {
  const id = String(eventId || '').trim();
  ensureCheckinTokenRotated_(id);
  const base = String(getWebAppUrl_() || '')
    .split(/[?#]/)[0]
    .replace(/\/$/, '');
  if (!id) return '';
  const path = '?page=checkin&eventId=' + encodeURIComponent(id);
  return base ? base + path : path;
}

/**
 * 目前現場簽到驗證碼（6 位數字），供看板／管理端顯示；無設定時空字串。
 */
function getCurrentCheckinCodeForDisplay_(eventId) {
  const eid = String(eventId || '').trim();
  if (!eid) return '';
  ensureCheckinTokenRotated_(eid);
  return String(getEventCheckinToken_(eid) || '').trim();
}

function invalidateBoardStateCache_(eventId) {
  try {
    const id = String(eventId || '').trim();
    if (!id) return;
    const cache = CacheService.getDocumentCache();
    cache.remove(boardStateCacheKey_(id));
  } catch (_e) {
    // ignore
  }
}

/**
 * 看板用：簽到 QR 內嵌連結何時因密鑰輪替而失效（錨點與 ensureCheckinTokenRotated_ 寫入之 rotatedAt 一致）。
 * @returns {{ checkinQrHasToken: boolean, checkinQrRotateSeconds: number, checkinQrRotatedAtMs: number, checkinQrInvalidInSeconds: (number|null) }}
 */
function getBoardCheckinQrExpiryMeta_(eventId) {
  const eid = String(eventId || '').trim();
  const tok = String(getEventCheckinToken_(eid) || '').trim();
  if (!tok) {
    return { checkinQrHasToken: false, checkinQrRotateSeconds: 0, checkinQrRotatedAtMs: 0, checkinQrInvalidInSeconds: null };
  }
  const rs = getEventCheckinRotateSeconds_(eid);
  const atRaw = String(getConfig_(eventCheckinTokenRotatedAtKey_(eid), '') || '').trim();
  const rotatedAt = Number(atRaw);
  if (!rs || rs < 30) {
    return {
      checkinQrHasToken: true,
      checkinQrRotateSeconds: 0,
      checkinQrRotatedAtMs: isFinite(rotatedAt) && rotatedAt > 0 ? rotatedAt : 0,
      checkinQrInvalidInSeconds: null,
    };
  }
  if (!isFinite(rotatedAt) || rotatedAt <= 0) {
    return { checkinQrHasToken: true, checkinQrRotateSeconds: rs, checkinQrRotatedAtMs: 0, checkinQrInvalidInSeconds: null };
  }
  const periodMs = rs * 1000;
  const now = Date.now();
  let anchor = rotatedAt;
  while (anchor + periodMs <= now) anchor += periodMs;
  const sec = Math.max(0, Math.ceil((anchor + periodMs - now) / 1000));
  return { checkinQrHasToken: true, checkinQrRotateSeconds: rs, checkinQrRotatedAtMs: rotatedAt, checkinQrInvalidInSeconds: sec };
}

function boardStateCacheKey_(eventId) {
  return 'board_state_v1_' + String(eventId || '').trim();
}

function getBoardStateCacheTtlSeconds_() {
  const raw = String(PropertiesService.getScriptProperties().getProperty('BOARD_STATE_CACHE_TTL_SECONDS') || '2').trim();
  const n = Number(raw);
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(300, Math.floor(n));
}

/** 清除密鑰時一併刪除輪替與上一組 token 設定。 */
function clearEventCheckinTokenRotationAux_(eventId) {
  const eid = String(eventId || '').trim();
  if (!eid) return;
  deleteConfig_(eventCheckinTokenPrevKey_(eid));
  deleteConfig_(eventCheckinTokenRotateSecondsKey_(eid));
  deleteConfig_(eventCheckinTokenRotatedAtKey_(eid));
  deleteConfig_(eventCheckinTokenLegacyKey_(eid));
}
