function driveRootFolderName_() {
  return '電子簽到_系統_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
}

function driveTimeStampForNaming_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss_SSS');
}

function sanitizeDriveSegment_(raw, maxLen) {
  const cap = maxLen || 80;
  let s = String(raw || '')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) s = '未命名活動';
  if (s.length > cap) s = s.slice(0, cap);
  return s;
}

function createEventSettingsSpreadsheet_(parentFolder, title, eventId, eventName) {
  const ss = SpreadsheetApp.create(title);
  DriveApp.getFileById(ss.getId()).moveTo(parentFolder);

  const shGroups = ss.getSheets()[0];
  shGroups.setName('分組');
  shGroups.getRange(1, 1, 1, 3).setValues([[
    'category（分類）',
    'groupName（分組名稱）',
    'sort（排序數字，可 0）',
  ]]);
  shGroups.setFrozenRows(1);

  const shRoster = ss.insertSheet('名單');
  shRoster.getRange(1, 1, 1, 6).setValues([[
    'category（分類）',
    'groupName（分組名稱）',
    'displayName（顯示名稱）',
    'sort（排序數字，可 0）',
    'font（可留空）',
    'enabled（TRUE／FALSE）',
  ]]);
  shRoster.setFrozenRows(1);

  const shNote = ss.insertSheet('說明');
  shNote.getRange(1, 1, 4, 1).setValues([
    ['此檔為電子簽到活動設定範本，檔名與活動資料夾使用相同時間戳對應。'],
    ['eventId（請勿手改）：' + eventId],
    ['活動名稱：' + eventName],
    ['請編輯「分組」「名單」工作表；匯入後台可後續擴充，現階段請於管理頁建立分組／名單。'],
  ]);
  shNote.setColumnWidth(1, 520);

  return ss.getUrl();
}
