// @ts-check
import { readingLeaf } from './leaf-reader.js';
import { BookWorld } from './book-world.js';
export function syncReadingMode(state, i18n) {
  const $ = id => document.getElementById(id), paper = state.share.interaction === 'paper';
  const book = state.world instanceof BookWorld;
  const available = paper && state.engine?.kind === 'engine' && (book || readingLeaf(state.json));
  const hint = paper ? (available ? 'paper.hint' : 'paper.unavailable') : 'tool.hint';
  const label = paper ? (available ? 'paper.label' : 'paper.unavailable') : 'viewer.label';
  $('input-hint').dataset.i18n = hint; $('input-hint').textContent = i18n.t(hint);
  if (state.renderer) {
    state.renderer.canvas.setAttribute('data-i18n-attr', `aria-label:${label}`);
    state.renderer.canvas.setAttribute('aria-label', i18n.t(label));
  }
  $('btn-grab').disabled = paper; $('btn-play').disabled = book;
  $('controls').closest('section').hidden = book;
  const r = book ? state.world.readingState() : null;
  $('reading-position').hidden = !book;
  $('reading-position').textContent = r ? i18n.t('paper.position', { pages: r.pages.join('–'), total: r.total }) : '';
  $('viewer').setAttribute('aria-busy', String(!!r?.busy));
  for (const [id, direction, disabled] of [['btn-back', 'back', r?.position === 0], ['btn-forward', 'forward', r?.position === state.world?.book?.leaves.length]]) {
    const key = book ? `paper.${direction}` : `play.${direction}`;
    $(id).setAttribute('data-i18n-attr', `aria-label:${key};title:${key}`);
    $(id).setAttribute('aria-label', i18n.t(key)); $(id).title = i18n.t(key);
    $(id).disabled = book && (r.busy || disabled);
  }
  $('btn-restart').disabled = book && (r.busy || r.position === 0);
}
