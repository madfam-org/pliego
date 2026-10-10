// @ts-check
// Landing behaviour: apply the chosen language and wire the language buttons.
// No analytics, no third-party requests.

import { createI18n, LANG_EVENT } from '../shared/i18n.js';
import { LANDING_STRINGS } from './landing-strings.js';

const i18n = createI18n(LANDING_STRINGS);

function syncButtons() {
  for (const b of document.querySelectorAll('[data-lang-btn]')) {
    b.setAttribute('aria-pressed', String(b.getAttribute('data-lang-btn') === i18n.lang));
  }
  document.title = i18n.t('meta.title');
}

function init() {
  i18n.apply();
  syncButtons();
  document.documentElement.classList.remove('i18n-pending');
  for (const b of document.querySelectorAll('[data-lang-btn]')) {
    b.addEventListener('click', () => i18n.setLang(String(b.getAttribute('data-lang-btn'))));
  }
  document.addEventListener(LANG_EVENT, syncButtons);
}

init();
