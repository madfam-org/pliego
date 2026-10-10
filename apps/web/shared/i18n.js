// @ts-check
// Shared i18n runtime for the landing and the studio.
// Strings live in per-page tables ({en, es, fr, pt}); the DOM carries data-i18n keys and is
// re-applied on every language change. A `pliego:lang` CustomEvent tells modules to re-render.

import { storeGet, storeSet } from './store.js';

export const LANGS = /** @type {const} */ (['en', 'es', 'fr', 'pt']);
export const LANG_KEY = 'pliego-lang';
export const LANG_EVENT = 'pliego:lang';

/** @param {unknown} l @returns {l is 'en'|'es'|'fr'|'pt'} */
export function isLang(l) {
  return typeof l === 'string' && /** @type {readonly string[]} */ (LANGS).includes(l);
}

/**
 * Resolution order: explicit ?lang= query → stored choice → navigator languages → en.
 * @param {{query?: string|null, stored?: string|null, navigatorLangs?: readonly string[]}} src
 * @returns {'en'|'es'|'fr'|'pt'}
 */
export function resolveLang({ query = null, stored = null, navigatorLangs = [] }) {
  if (isLang(query)) return query;
  if (isLang(stored)) return stored;
  for (const nl of navigatorLangs) {
    const prefix = String(nl || '').toLowerCase().split('-')[0];
    if (isLang(prefix)) return prefix;
  }
  return 'en';
}

/** Reads the browser's sources (guarded) and resolves the initial language. */
export function pickInitialLang() {
  let query = null;
  try {
    query = new URLSearchParams(globalThis.location ? globalThis.location.search : '').get('lang');
  } catch { /* no location */ }
  const nav = globalThis.navigator;
  const navigatorLangs = nav ? (nav.languages && nav.languages.length ? nav.languages : [nav.language]) : [];
  return resolveLang({ query, stored: storeGet(LANG_KEY), navigatorLangs });
}

/**
 * @param {Record<string, Record<string, string>>} table
 * @param {'en'|'es'|'fr'|'pt'} [initial]
 */
export function createI18n(table, initial) {
  const state = { lang: initial || pickInitialLang() };

  /** @param {string} key @param {Record<string, string|number>} [vars] */
  function t(key, vars) {
    const raw = (table[state.lang] && table[state.lang][key]) ?? (table.en && table.en[key]) ?? key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
  }

  /** Localise an i18n object from a document ({en, es?, fr?, pt?}); falls back to en. */
  function loc(obj) {
    if (obj == null) return '';
    if (typeof obj === 'string') return obj;
    return obj[state.lang] || obj.en || '';
  }

  /**
   * Apply translations under `root`:
   *   data-i18n="key"                         → textContent
   *   data-i18n-attr="aria-label:key;title:k" → attributes
   * @param {ParentNode} [root]
   */
  function apply(root) {
    const scope = root || globalThis.document;
    if (!scope) return;
    for (const el of scope.querySelectorAll('[data-i18n]')) {
      el.textContent = t(/** @type {string} */ (el.getAttribute('data-i18n')));
    }
    for (const el of scope.querySelectorAll('[data-i18n-attr]')) {
      for (const pair of String(el.getAttribute('data-i18n-attr')).split(';')) {
        const [attr, key] = pair.split(':').map((s) => s.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      }
    }
  }

  /** @param {string} lang */
  function setLang(lang) {
    if (!isLang(lang)) return;
    state.lang = lang;
    storeSet(LANG_KEY, lang);
    const doc = globalThis.document;
    if (doc) {
      doc.documentElement.lang = lang;
      doc.documentElement.setAttribute('data-lang', lang);
      apply(doc);
      doc.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: { lang } }));
    }
  }

  return {
    get lang() { return state.lang; },
    t, loc, apply, setLang,
  };
}
