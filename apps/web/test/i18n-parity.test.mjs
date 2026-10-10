// i18n gate: en/es/fr/pt key parity for the studio and landing tables, no empty strings, every key
// referenced from HTML (data-i18n, data-i18n-attr) or JS (t('…')) exists, and the non-English
// tables are actually translated (not English copies).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUDIO_STRINGS } from '../studio/src/strings.js';
import { LANDING_STRINGS } from '../assets/landing-strings.js';
import { resolveLang, LANGS } from '../shared/i18n.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(WEB, p), 'utf8');

// Reviewed: these strings are the same word in that language (cognates, proper nouns, units).
const COGNATES = {
  studio: { es: ['status.fps'], fr: ['play.pause', 'diagram.perforation', 'status.contacts', 'mode.label'], pt: [] },
  landing: { es: ['rung.2.t', 'rung.7.t'], fr: ['nav.label', 'rung.1.t', 'rung.2.t', 'rung.7.t', 'fact.contact.k'], pt: ['rung.2.t', 'rung.7.t'] },
};

function htmlKeys(html) {
  const keys = new Set();
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) keys.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(';')) keys.add(pair.split(':')[1].trim());
  return keys;
}

for (const [name, table, html, jsDir] of [
  ['studio', STUDIO_STRINGS, 'studio/index.html', 'studio/src'],
  ['landing', LANDING_STRINGS, 'index.html', 'assets'],
]) {
  test(`${name}: key parity across ${LANGS.join('/')}`, () => {
    const en = Object.keys(table.en).sort();
    assert.ok(en.length > 10, 'table is suspiciously small');
    for (const l of LANGS) {
      const keys = Object.keys(table[l] || {}).sort();
      assert.deepEqual(keys, en, `${name}.${l} keys differ from en`);
      for (const k of keys) assert.ok(String(table[l][k]).trim().length > 0, `${name}.${l}.${k} is empty`);
    }
    console.log(`i18n-parity ${name}: keys=${en.length} langs=${LANGS.length}`);
  });

  test(`${name}: placeholders match across languages`, () => {
    const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const k of Object.keys(table.en)) for (const l of LANGS) assert.equal(ph(table[l][k]), ph(table.en[k]), `${name}.${l}.${k} placeholders`);
  });

  test(`${name}: every key used in HTML and JS exists`, () => {
    const used = htmlKeys(read(html));
    for (const f of readdirSync(join(WEB, jsDir)).filter((x) => x.endsWith('.js'))) {
      const src = read(`${jsDir}/${f}`);
      for (const m of src.matchAll(/\bt\(\s*'([a-z0-9.]+)'/g)) used.add(m[1]);
      for (const m of src.matchAll(/i18n\.t\(\s*'([a-z0-9.]+)'/g)) used.add(m[1]);
    }
    if (name === 'studio') for (const k of ['outline', 'mountain', 'valley', 'cut', 'score', 'perforation']) used.add(`diagram.${k}`);
    assert.ok(used.size > 10, `scanned too few keys (${used.size})`);
    const missing = [...used].filter((k) => !(k in table.en));
    assert.deepEqual(missing, [], `${name}: keys used but not defined`);
    console.log(`i18n-usage ${name}: used=${used.size} missing=0`);
  });

  test(`${name}: non-English tables are translated (only reviewed cognates may equal English)`, () => {
    for (const l of ['es', 'fr', 'pt']) {
      const allowed = new Set(COGNATES[name][l]);
      const same = Object.keys(table.en).filter((k) => table[l][k] === table.en[k] && !allowed.has(k));
      assert.deepEqual(same, [], `${name}.${l}: identical to English and not a reviewed cognate`);
    }
  });
}

test('language resolution: query → stored → navigator → en', () => {
  assert.equal(resolveLang({ query: 'fr', stored: 'es', navigatorLangs: ['pt-BR'] }), 'fr');
  assert.equal(resolveLang({ query: 'xx', stored: 'es', navigatorLangs: ['pt-BR'] }), 'es');
  assert.equal(resolveLang({ stored: null, navigatorLangs: ['de-DE', 'pt-BR'] }), 'pt');
  assert.equal(resolveLang({ navigatorLangs: ['ES-mx'] }), 'es');
  assert.equal(resolveLang({}), 'en');
});

test('lang-boot.js mirrors the shared language list and storage key', () => {
  const boot = read('shared/lang-boot.js');
  assert.match(boot, /\['en', 'es', 'fr', 'pt'\]/);
  assert.match(boot, /'pliego-lang'/);
});
