// The catalog is a bounded, scrollable list. With 141 objects and their full summaries it was
// 42,000 px tall, which put the Parameters card (below it in the left panel) 42,289 px down on a
// 1440 × 900 desktop and 30,918 px down at 390 px, with the selected object near the bottom of the
// list (live walk, 2026-10-18). Layout cannot run under node --test, so the CSS rules are checked
// as text and the scroll arithmetic as a pure function; a browser check is in the PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogScrollTop } from '../studio/src/panels.js';

const css = readFileSync(new URL('../studio/studio.css', import.meta.url), 'utf8');
/** Declarations of the first top-level rule whose selector list is exactly `selector`. */
function rule(selector) {
  const m = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
}

test('the catalog list is height-bounded and scrolls on its own', () => {
  const r = rule('.catalog');
  assert.match(r, /max-height:\s*[^;]+;/, '.catalog needs a max-height');
  assert.match(r, /overflow-y:\s*auto/, '.catalog must scroll inside itself');
  assert.match(r, /position:\s*relative/, 'the list is the offsetParent of its items (scroll arithmetic)');
});

test('catalog summaries are clamped to a few lines', () => {
  const r = rule('.catalog-summary');
  assert.match(r, /-webkit-line-clamp:\s*[23];/);
  assert.match(r, /overflow:\s*hidden/);
});

test('the selected object is scrolled to the middle of the list, never above the top', () => {
  assert.equal(catalogScrollTop(0, 70, 500), 0);
  assert.equal(catalogScrollTop(100, 70, 500), 0);
  assert.equal(catalogScrollTop(39758, 70, 500), 39758 - 215);
  assert.equal(catalogScrollTop(1000, 600, 500), 1000);   // an item taller than the list shows its top
});
