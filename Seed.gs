function adminSeedDemoData() {
  requireAdmin_();
  const { eventId } = adminCreateEvent({ name: '示範活動' });
  const ss = getDb_();
  const shGroups = ss.getSheetByName(SHEETS.GROUPS);
  const shRoster = ss.getSheetByName(SHEETS.ROSTER);

  const g1 = newId_('grp');
  const g2 = newId_('grp');
  shGroups.appendRow([g1, eventId, 'A類', '第1組', 1]);
  shGroups.appendRow([g2, eventId, 'A類', '第2組', 2]);

  shRoster.appendRow([newId_('p'), eventId, g1, '王小明', '', true, 1]);
  shRoster.appendRow([newId_('p'), eventId, g1, '陳小華', '', true, 2]);
  shRoster.appendRow([newId_('p'), eventId, g2, '林小美', '', true, 1]);
  shRoster.appendRow([newId_('p'), eventId, g2, '張大同', '', true, 2]);

  return { ok: true, eventId };
}

