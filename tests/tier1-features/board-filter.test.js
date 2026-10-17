const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Tier 1: [Board Filter] Board Status Filter & Category View Interaction', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const boardHtmlPath = path.join(rootDir, 'Board.html');
  const appCssPath = path.join(rootDir, 'app.css.html');

  const boardHtml = fs.readFileSync(boardHtmlPath, 'utf8');
  const appCss = fs.readFileSync(appCssPath, 'utf8');

  it('Board.html includes interactive filter pills for ALL, NOT_YET, IN, and OUT', () => {
    assert.match(boardHtml, /class="pill boardFilterPill is-active"[^>]*data-filter="ALL"/, 'Must have ALL filter pill');
    assert.match(boardHtml, /class="pill boardFilterPill"[^>]*data-filter="NOT_YET"/, 'Must have NOT_YET filter pill');
    assert.match(boardHtml, /class="pill boardFilterPill"[^>]*data-filter="IN"/, 'Must have IN filter pill');
    assert.match(boardHtml, /class="pill boardFilterPill"[^>]*data-filter="OUT"/, 'Must have OUT filter pill');
    assert.match(boardHtml, /id="boardFilterEmpty"/, 'Must have empty state notice element');
  });

  it('Board.html buildPersonHtml_ and patchBoardInPlace_ inject and update data-status', () => {
    assert.match(boardHtml, /data-status="'\s*\+\s*s\s*\+\s*'"/, 'buildPersonHtml_ must inject data-status on .person');
    assert.match(boardHtml, /node\.setAttribute\(['"]data-status['"],\s*nextStatus\)/, 'patchBoardInPlace_ must update data-status');
  });

  it('Board.html defines setBoardFilter and initBoardFilterEvents_', () => {
    assert.match(boardHtml, /function setBoardFilter\(/, 'Must define setBoardFilter');
    assert.match(boardHtml, /function updateBoardFilterEmptyNotice_\(/, 'Must define updateBoardFilterEmptyNotice_');
    assert.match(boardHtml, /function initBoardFilterEvents_\(/, 'Must define initBoardFilterEvents_');
  });

  it('app.css.html contains board filter CSS selectors and :has() rules', () => {
    assert.match(appCss, /\.boardFilterPill\.is-active/, 'Must style active filter pill');
    assert.match(appCss, /#board\[data-board-filter="NOT_YET"\] \.person:not\(\[data-status="NOT_YET"\]\)/, 'Must hide non-matching NOT_YET persons');
    assert.match(appCss, /#board\[data-board-filter="IN"\] \.person:not\(\[data-status="IN"\]\)/, 'Must hide non-matching IN persons');
    assert.match(appCss, /#board\[data-board-filter="OUT"\] \.person:not\(\[data-status="OUT"\]\)/, 'Must hide non-matching OUT persons');
    assert.match(appCss, /\.boardCategoryCard:not\(:has\(\.person\[data-status="NOT_YET"\]\)\)/, 'Must hide empty category cards on filter');
  });
});
