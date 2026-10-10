// CSP lint: everything under apps/web must run under
//   script-src 'self'; style-src 'self'; default-src 'none' (plus img/connect 'self')
// HTML: no inline <script> bodies (JSON-LD data blocks are not executed and are allowed), no on*
// handler attributes, no style= attributes, no <style> elements, no javascript: URLs, no external
// src/href except the documented SEO links (rel=canonical, rel=alternate).
// JS: no eval / new Function / string timers / document.write / innerHTML / style attributes.
// Also checks the dev server sends the strict CSP and refuses traversal and dot-paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(WEB);
const html = files.filter((f) => f.endsWith('.html'));
const js = files.filter((f) => /\.(m?js)$/.test(f) && !f.includes(`${join('apps', 'web', 'test')}`) && !relative(WEB, f).startsWith('test'));

test('HTML is CSP-clean', () => {
  const problems = [];
  for (const f of html) {
    const src = readFileSync(f, 'utf8');
    const rel = relative(WEB, f);
    for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = m[1], body = m[2].trim();
      if (/type=["']application\/ld\+json["']/.test(attrs)) { JSON.parse(body); continue; }
      if (body) problems.push(`${rel}: inline <script> body`);
      const s = /src=["']([^"']+)["']/.exec(attrs);
      if (!s) problems.push(`${rel}: <script> without src`);
      else if (/^(https?:)?\/\//.test(s[1])) problems.push(`${rel}: external script ${s[1]}`);
    }
    if (/<style\b/i.test(src)) problems.push(`${rel}: <style> element`);
    for (const m of src.matchAll(/<[a-z][^>]*>/gi)) {
      const tag = m[0];
      if (/\son[a-z]+\s*=/i.test(tag)) problems.push(`${rel}: inline handler in ${tag.slice(0, 60)}`);
      if (/\sstyle\s*=/i.test(tag)) problems.push(`${rel}: style attribute in ${tag.slice(0, 60)}`);
      if (/javascript:/i.test(tag)) problems.push(`${rel}: javascript: URL`);
      for (const a of tag.matchAll(/\s(src|href)=["']([^"']+)["']/gi)) {
        if (!/^(https?:)?\/\//i.test(a[2])) continue;
        const seoLink = /^<link\b/i.test(tag) && /\srel=["'](canonical|alternate)["']/i.test(tag);
        if (!seoLink) problems.push(`${rel}: external ${a[1]}=${a[2]}`);
      }
    }
  }
  assert.ok(html.length >= 2, 'scanned fewer than 2 HTML files');
  assert.deepEqual(problems, []);
  console.log(`csp-lint html: files=${html.length} violations=0`);
});

test('JS is CSP-clean', () => {
  const rules = [
    [/\beval\s*\(/, 'eval'], [/new\s+Function\s*\(/, 'new Function'], [/set(Timeout|Interval)\(\s*['"`]/, 'string timer'],
    [/document\.write/, 'document.write'], [/\.innerHTML\s*=/, 'innerHTML'], [/\.outerHTML\s*=/, 'outerHTML'],
    [/insertAdjacentHTML/, 'insertAdjacentHTML'], [/setAttribute\(\s*['"]style['"]/, 'style attribute'], [/setAttribute\(\s*['"]on[a-z]+['"]/, 'handler attribute'],
    [/import\s*\(\s*['"]https?:/, 'remote import'], [/from\s+['"]https?:/, 'remote import'], [/fetch\(\s*['"`]https?:/, 'remote fetch'],
  ];
  const problems = [];
  for (const f of js) {
    const src = readFileSync(f, 'utf8');
    for (const [re, what] of rules) if (re.test(src)) problems.push(`${relative(WEB, f)}: ${what}`);
  }
  assert.ok(js.length >= 10, `scanned too few JS files (${js.length})`);
  assert.deepEqual(problems, []);
  console.log(`csp-lint js: files=${js.length} violations=0`);
});

test('no analytics or third-party hosts referenced in shipped files', () => {
  const offenders = [];
  for (const f of [...html, ...js, ...files.filter((x) => x.endsWith('.css'))]) {
    const src = readFileSync(f, 'utf8');
    if (/googletagmanager|google-analytics|plausible\.io\/js|fonts\.googleapis|cdn\.jsdelivr|unpkg\.com|cdnjs/i.test(src)) offenders.push(relative(WEB, f));
  }
  assert.deepEqual(offenders, []);
});

test('every source file stays within the 600-line budget', () => {
  const over = files.filter((f) => /\.(m?js|css|html)$/.test(f)).map((f) => [relative(WEB, f), readFileSync(f, 'utf8').split('\n').length]).filter(([, n]) => n > 600);
  assert.deepEqual(over, []);
  console.log(`file-size: files=${files.length} over600=0`);
});

test('dev server sends the strict CSP and refuses traversal', async () => {
  const port = 18000 + Math.floor(Math.random() * 2000);
  const proc = spawn(process.execPath, [join(WEB, 'dev-server.mjs'), '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('dev server did not start')), 5000);
      proc.stdout.on('data', (d) => { if (String(d).includes('dev server')) { clearTimeout(t); resolve(); } });
      proc.on('exit', (c) => reject(new Error(`dev server exited ${c}`)));
    });
    const base = `http://127.0.0.1:${port}`;
    const studio = await fetch(`${base}/studio/`);
    assert.equal(studio.status, 200);
    const csp = studio.headers.get('content-security-policy') || '';
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /style-src 'self'(;|$)/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    assert.equal(studio.headers.get('x-content-type-options'), 'nosniff');
    const llms = await fetch(`${base}/llms.txt`);
    assert.equal(llms.status, 200);
    assert.match(await llms.text(), /^# Pliego/);
    const api = await fetch(`${base}/api/v1/catalog`);
    assert.equal(api.status, 404);
    assert.equal((await api.json()).error, 'api_not_running');
    assert.equal((await fetch(`${base}/%2e%2e/%2e%2e/AGENTS.md`)).status, 404);
    assert.equal((await fetch(`${base}/.gitignore`)).status, 404);
    const fold = await fetch(`${base}/studio/demo/page-turn.fold`);
    assert.match(fold.headers.get('content-type') || '', /application\/json/);
  } finally {
    proc.kill();
  }
});
