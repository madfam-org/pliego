// @ts-check
// DOM builders for the studio panels. Every control is a native, labelled form element (keyboard
// operable out of the box); no inline styles or handlers — listeners are attached here.

/** @typedef {ReturnType<typeof import('../../shared/i18n.js').createI18n>} I18n */

const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') n.textContent = String(v);
    else if (k === 'class') n.className = String(v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids) if (k) n.append(k);
  return n;
};
const fmt = (v, digits = 0) => Number(v).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
// Manifest slider values: as many decimals as the step has; units as a reader writes them.
const stepDigits = (step) => { const s = String(step ?? 1), i = s.indexOf('.'); return i < 0 ? 0 : Math.min(4, s.length - i - 1); };
const UNIT_TEXT = { deg: '°', ratio: '' };
export function paramText(v, p) {
  const u = p.unit in UNIT_TEXT ? UNIT_TEXT[p.unit] : p.unit || '';
  return `${fmt(v, stepDigits(p.step))}${u === '°' ? u : u ? ` ${u}` : ''}`;
}

/**
 * The list's scrollTop that puts an item (offsetTop and height inside the list) in the middle of
 * the list's visible height; an item taller than the list shows its top.
 * @param {number} itemTop @param {number} itemHeight @param {number} listHeight
 */
export function catalogScrollTop(itemTop, itemHeight, listHeight) {
  return Math.max(0, itemHeight >= listHeight ? itemTop : itemTop - (listHeight - itemHeight) / 2);
}

/**
 * @param {HTMLElement} list @param {any[]} items @param {string|null} current @param {I18n} i18n
 * @param {(slug: string) => void} onSelect
 */
export function renderCatalog(list, items, current, i18n, onSelect) {
  const keep = list.scrollTop;
  const moved = list.dataset.current !== (current || '');
  list.dataset.current = current || '';
  list.replaceChildren();
  if (!items.length) { list.append(h('li', { class: 'note', text: i18n.t('catalog.empty') })); return; }
  for (const it of items) {
    const title = i18n.loc(it.title);
    // The preview (the default crease pattern, built with the image) is decorative: the button already
    // names the object, so alt="" keeps screen readers from saying the name twice. A preview that fails
    // to load is removed rather than left as a broken image.
    const btn = h('button', { type: 'button', class: 'catalog-item', 'aria-current': it.slug === current ? 'true' : null },
      h('span', { class: 'catalog-title', text: title }),
      it.summary ? h('span', { class: 'catalog-summary', text: i18n.loc(it.summary) }) : null);
    if (it.thumbnail) {
      const thumb = h('img', { class: 'catalog-thumb', src: it.thumbnail, alt: '', width: 56, height: 56, loading: 'lazy', decoding: 'async' });
      thumb.addEventListener('error', () => { thumb.remove(); btn.classList.remove('has-thumb'); });
      btn.prepend(thumb);
      btn.classList.add('has-thumb');
    }
    btn.addEventListener('click', () => onSelect(it.slug));
    list.append(h('li', {}, btn));
  }
  // The list scrolls on its own (studio.css): bring a newly selected object into view, and keep the
  // visitor's own scroll position when the panel is only re-rendered (language, parameters).
  const sel = /** @type {HTMLElement|null} */ (list.querySelector('[aria-current="true"]'));
  const li = sel && /** @type {HTMLElement} */ (sel.parentElement);
  list.scrollTop = moved && li ? catalogScrollTop(li.offsetTop, li.offsetHeight, list.clientHeight) : keep;
}

/**
 * Mode selector, shown only when the object has more than one mode (e.g. an exact rigid program
 * and a by-hand physics version of the same fold).
 * @param {HTMLElement} box @param {{id: string, label: any}[]} modes @param {string|null} current
 * @param {boolean} enabled @param {I18n} i18n @param {(id: string) => void} onChange
 */
export function renderModes(box, modes, current, enabled, i18n, onChange) {
  box.replaceChildren();
  box.hidden = !Array.isArray(modes) || modes.length < 2;
  if (box.hidden) return;
  const sel = h('select', { id: 'mode-select', disabled: !enabled });
  for (const m of modes) sel.append(h('option', { value: m.id, selected: m.id === current, text: i18n.loc(m.label) || m.id }));
  sel.addEventListener('change', () => onChange(sel.value));
  box.append(h('div', { class: 'field' }, h('label', { for: 'mode-select', text: i18n.t('mode.label') }), sel));
}

/**
 * @param {HTMLFormElement} form @param {HTMLElement} note @param {any[]} params
 * @param {Record<string, any>} values @param {boolean} enabled @param {I18n} i18n
 * @param {(id: string, value: any) => void} onChange
 */
export function renderParams(form, note, params, values, enabled, i18n, onChange) {
  form.replaceChildren();
  note.textContent = !params.length ? i18n.t('params.none') : enabled ? '' : i18n.t('params.offline');
  note.hidden = !note.textContent;
  for (const p of params) {
    const id = `param-${p.id}`;
    const label = i18n.loc(p.label) || p.id;
    let field;
    if (p.type === 'slider') {
      const out = h('output', { for: id, class: 'value', text: paramText(values[p.id], p) });
      const input = h('input', { type: 'range', id, min: p.min, max: p.max, step: p.step || 1, value: values[p.id], disabled: !enabled });
      input.addEventListener('input', () => { out.textContent = paramText(input.value, p); });
      input.addEventListener('change', () => onChange(p.id, Number(input.value)));
      field = h('div', { class: 'field' }, h('label', { for: id }, h('span', { text: label }), out), input);
    } else if (p.type === 'select') {
      const sel = h('select', { id, disabled: !enabled });
      for (const o of p.options || []) sel.append(h('option', { value: o.value, selected: String(o.value) === String(values[p.id]), text: i18n.loc(o.label) || String(o.value) }));
      sel.addEventListener('change', () => onChange(p.id, sel.value));
      field = h('div', { class: 'field' }, h('label', { for: id, text: label }), sel);
    } else if (p.type === 'checkbox') {
      const cb = h('input', { type: 'checkbox', id, checked: !!values[p.id], disabled: !enabled });
      cb.addEventListener('change', () => onChange(p.id, cb.checked));
      field = h('div', { class: 'field field-check' }, cb, h('label', { for: id, text: label }));
    }
    if (field) form.append(field);
  }
}

/** Current step index (0-based) for a sequence value, −1 before the first step. */
export function stepIndex(value, n) {
  if (value <= 0) return -1;
  return Math.min(n - 1, Math.ceil(value) - 1);
}

/**
 * Controls from `pliego:controls`.
 * @param {HTMLElement} box @param {any} json @param {I18n} i18n
 * @param {{needsEngine: (id: string) => boolean, onChange: (id: string, value: number|boolean) => void}} hooks
 */
export function renderControls(box, json, i18n, hooks) {
  box.replaceChildren();
  const controls = json['pliego:controls'] || [];
  const steps = json['pliego:sequence']?.steps || [];
  const inputs = new Map();
  const labelFns = [];
  if (!controls.length) box.append(h('p', { class: 'note', text: i18n.t('controls.none') }));
  for (const c of controls) {
    const id = `ctl-${c.id}`;
    const blocked = hooks.needsEngine(c.id);
    if (c.kind === 'toggle') {
      const cb = h('input', { type: 'checkbox', id, checked: !!c.default, disabled: blocked });
      cb.addEventListener('change', () => hooks.onChange(c.id, cb.checked));
      box.append(h('div', { class: 'field field-check' }, cb, h('label', { for: id, text: i18n.loc(c.label) })));
      inputs.set(c.id, { input: cb, control: c, set: (v) => { cb.checked = !!v; } });
      continue;
    }
    const isSeq = c.kind === 'sequence';
    const min = c.min ?? 0;
    const max = c.max ?? (isSeq ? steps.length : c.kind === 'wind' ? 10 : c.kind === 'angle' ? 180 : 100);
    const unit = c.unit === 'deg' ? '°' : c.kind === 'wind' ? ' m/s' : c.unit ? ` ${c.unit}` : '';
    const input = h('input', { type: 'range', id, min, max, step: isSeq ? 0.01 : c.kind === 'wind' ? 0.1 : 1, value: c.default ?? min, disabled: blocked });
    const out = h('output', { for: id, class: 'value' });
    const caption = isSeq ? h('p', { class: 'step-caption', id: `${id}-caption`, 'aria-live': 'polite' }) : null;
    const describe = () => {
      const v = Number(input.value);
      if (isSeq) {
        const k = stepIndex(v, steps.length);
        out.textContent = k < 0 ? '0' : i18n.t('controls.stepOf', { n: k + 1, total: steps.length });
        const text = k < 0 ? i18n.t('controls.start') : i18n.loc(steps[k].label);
        if (caption) caption.textContent = v >= steps.length ? `${text} — ${i18n.t('controls.done')}` : text;
        input.setAttribute('aria-valuetext', `${out.textContent}: ${text}`);
      } else {
        out.textContent = `${fmt(v, c.kind === 'wind' ? 1 : 0)}${unit}`;
        input.setAttribute('aria-valuetext', out.textContent);
      }
    };
    input.addEventListener('input', () => { describe(); hooks.onChange(c.id, Number(input.value)); });
    const label = h('label', { for: id }, h('span', { class: 'ctl-label' }), out);
    const field = h('div', { class: 'field' }, label, input, caption,
      blocked ? h('p', { class: 'note warn', text: i18n.t('controls.needsEngine') }) : null);
    if (caption) input.setAttribute('aria-describedby', caption.id);
    box.append(field);
    const relabel = () => { /** @type {HTMLElement} */ (label.querySelector('.ctl-label')).textContent = i18n.loc(c.label); describe(); };
    relabel();
    labelFns.push(relabel);
    inputs.set(c.id, { input, control: c, min, max, set: (v) => { input.value = String(v); describe(); } });
  }
  const seq = controls.find((c) => c.kind === 'sequence' && !hooks.needsEngine(c.id));
  const primary = seq || controls.find((c) => (c.kind === 'angle' || c.kind === 'distance') && !hooks.needsEngine(c.id));
  return {
    inputs,
    sequenceId: seq ? seq.id : null,
    primaryId: primary ? primary.id : null,
    get(id) { const e = inputs.get(id); return e ? (e.input.type === 'checkbox' ? e.input.checked : Number(e.input.value)) : 0; },
    set(id, v) { const e = inputs.get(id); if (e) e.set(v); },
    range(id) { const e = inputs.get(id); return e ? [Number(e.min ?? 0), Number(e.max ?? 1)] : [0, 1]; },
    relabel() { labelFns.forEach((f) => f()); },
  };
}

/**
 * Step list (diagram text) — each step is a button that jumps to the end of that step.
 * @param {HTMLOListElement} ol @param {HTMLElement} card @param {any} json @param {I18n} i18n
 * @param {(value: number) => void} onJump
 */
export function renderSteps(ol, card, json, i18n, onJump) {
  ol.replaceChildren();
  const steps = json['pliego:sequence']?.steps || [];
  card.hidden = !steps.length;
  const items = steps.map((s, k) => {
    const btn = h('button', { type: 'button', class: 'step' },
      h('span', { class: 'step-n', text: String(k + 1) }),
      h('span', { class: 'step-text', text: i18n.loc(s.label) }),
      s.note ? h('span', { class: 'step-note', text: i18n.loc(s.note) }) : null);
    btn.addEventListener('click', () => onJump(k + 1));
    const li = h('li', {}, btn);
    ol.append(li);
    return btn;
  });
  return (value) => {
    const k = stepIndex(value, steps.length);
    items.forEach((b, i) => { if (i === k) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
  };
}

/**
 * Export buttons. Without the API they stay focusable but aria-disabled, with a visible tooltip.
 * @param {HTMLElement} box @param {HTMLElement} note @param {string[]} formats @param {boolean} api
 * @param {I18n} i18n @param {(fmt: string) => void} onExport @param {() => void} onLocalSvg
 */
export function renderExports(box, note, formats, api, i18n, onExport, onLocalSvg) {
  box.replaceChildren();
  note.textContent = api ? '' : i18n.t('export.offline');
  note.hidden = api;
  note.id = 'export-note';
  for (const f of formats) {
    const btn = h('button', { type: 'button', class: 'chip export', 'aria-disabled': api ? null : 'true', 'aria-describedby': api ? null : 'export-note', 'data-tip': api ? null : i18n.t('export.offline'), text: f.toUpperCase() });
    btn.addEventListener('click', () => { if (api) onExport(f); });
    box.append(btn);
  }
  const local = h('button', { type: 'button', class: 'chip export export-local', text: i18n.t('export.svgLocal') });
  local.addEventListener('click', onLocalSvg);
  box.append(local);
}
