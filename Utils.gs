/**
 * 將試算表儲存格值轉成可 JSON 序列化、且適合 HtmlService 客戶端的純字串。
 * Date 會格式化成專案時區下的 yyyy-MM-dd HH:mm:ss，避免 google.script.run 回傳含 Date 時整包變 null。
 */
function cellToPlain_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  if (v === null || v === undefined) return '';
  return String(v);
}

/** 分組試算表欄位：空白時寫入／顯示用預設文案。 */
var DEFAULT_GROUP_CATEGORY_ = '未分類';
var DEFAULT_GROUP_NAME_ = '未分組';

/**
 * 分類、分組名稱 trim 後若為空字串，分別替換為未分類、未分組。
 * @returns {{category:string, groupName:string}}
 */
function normalizeGroupCategoryAndName_(category, groupName) {
  var c = String(category || '').trim();
  var g = String(groupName || '').trim();
  if (!c) c = DEFAULT_GROUP_CATEGORY_;
  if (!g) g = DEFAULT_GROUP_NAME_;
  return { category: c, groupName: g };
}
