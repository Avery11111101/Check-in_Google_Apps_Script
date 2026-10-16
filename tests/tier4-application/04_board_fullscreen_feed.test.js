// tests/tier4-application/04_board_fullscreen_feed.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFreshContext } = require('../harness/vm-loader.js');
const { MockDocument, MockWindow } = require('../harness/dom-mock.js');

describe('Tier 4: [Application] Fullscreen Board State Feed & Responsive Layout', () => {
  let context, mocks;
  const projectRoot = path.resolve(__dirname, '../..');

  beforeEach(() => {
    const res = createFreshContext({ projectRoot });
    context = res.context;
    mocks = res.mocks;

    context.ensureInitialized_();
    mocks.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', 'admin@example.com');
  });

  test('publicGetBoardState returns complete hierarchical structure and attendance stats', () => {
    const eventId = 'evt_board_feed';
    const db = context.getDb_();
    const shEvents = db.getSheetByName(context.SHEETS.EVENTS);
    shEvents.appendRow([eventId, '大螢幕即時看板', '', '', true, '', '', new Date(), false, false]);

    // Create groups
    const g1 = context.adminCreateGroup({ eventId, name: '一級處', category: '一級處', groupName: '', sort: 1 });
    const g2 = context.adminCreateGroup({ eventId, parentId: g1.groupId, name: '二級科', category: '一級處', groupName: '二級科', sort: 1 });

    // Create members
    const m1 = context.adminCreateRoster({ eventId, groupId: g2.groupId, displayName: '看板人員A', sort: 1 });
    const m2 = context.adminCreateRoster({ eventId, groupId: g2.groupId, displayName: '看板人員B', sort: 2 });

    // Sync to Sheets
    if (typeof context.adminSyncToSheets === 'function') {
      context.adminSyncToSheets(eventId);
    }

    // Submit 1 check-in
    context.publicSubmitAttendance({ eventId, personId: m1.personId, action: 'IN' });

    // Call publicGetBoardState
    const board = context.publicGetBoardState(eventId);
    assert.ok(board && (board.ok || board.groups), 'Board state should return valid object');

    // Verify groups and roster exist
    assert.ok(Array.isArray(board.groups), 'board.groups must be an array');
    assert.ok(Array.isArray(board.roster), 'board.roster must be an array');
    assert.ok(board.roster.length >= 2, 'Roster should contain at least 2 members');

    // Verify status mapping
    const personA = board.roster.find(r => r.personId === m1.personId);
    assert.ok(personA, 'Person A must be in board roster');
    assert.strictEqual(personA.status, 'IN', 'Person A status must be IN');

    const personB = board.roster.find(r => r.personId === m2.personId);
    assert.ok(personB, 'Person B must be in board roster');
    assert.strictEqual(personB.status, 'NOT_YET', 'Person B status must be NOT_YET');
  });

  test('Board.html DOM structure contains full-screen stats and responsive elements', () => {
    const boardHtmlPath = path.join(projectRoot, 'Board.html');
    assert.ok(fs.existsSync(boardHtmlPath), 'Board.html must exist');
    const html = fs.readFileSync(boardHtmlPath, 'utf8');

    // Verify presence of key UI elements
    assert.ok(html.includes('id="effectiveTotal"'), 'Must contain effectiveTotal element');
    assert.ok(html.includes('id="signedCount"'), 'Must contain signedCount element');
    assert.ok(html.includes('id="notYetCount"'), 'Must contain notYetCount element');
    assert.ok(html.includes('id="attendanceRate"'), 'Must contain attendanceRate element');
    assert.ok(html.includes('class="page-board"'), 'Body must have page-board class');
  });

  test('Board layout supports widescreen resolution without fixed width capping', () => {
    const cssPath = path.join(projectRoot, 'app.css.html');
    const boardHtmlPath = path.join(projectRoot, 'Board.html');
    const css = fs.readFileSync(cssPath, 'utf8');
    const boardHtml = fs.readFileSync(boardHtmlPath, 'utf8');

    // Target contract for M3 / Fullscreen board:
    // Either app.css or Board.html unlocks .page-board .container or widescreen 100% / 100vw
    const hasFullscreenRule = (
      css.includes('.page-board') ||
      boardHtml.includes('max-width: 100%') ||
      boardHtml.includes('width: 100vw') ||
      css.includes('max-width: 100%') ||
      css.includes('width: 100vw')
    );
    assert.ok(hasFullscreenRule, 'Board must support widescreen fluid width (100% or 100vw)');
  });
});
