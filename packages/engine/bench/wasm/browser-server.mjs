// Local-only CSP/parity research harness. No production header or app change.
// node browser-server.mjs [--port 8246] [--out /chosen/report-prefix]
// Default reports live in a fresh private temporary directory printed at start.
import { createServer } from 'node:http';
import { createReadStream, readFileSync, writeFileSync, realpathSync, statSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, relative, sep, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';

export function browserOutputPrefix(prefix) {
  return prefix === undefined || prefix === null ? join(mkdtempSync(join(tmpdir(), 'pliego-wasm-browser-')), 'probe') : resolve(prefix);
}
export function writeBrowserReport(prefix, mode, report) {
  if (!['strict', 'allow'].includes(mode)) throw new Error('unknown browser report mode');
  const path = prefix + '-' + mode + '.json';
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return path;
}

export function runBrowserServer() {
const arg = n => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
const root = fileURLToPath(new URL('../../../../', import.meta.url)), local = fileURLToPath(new URL('./', import.meta.url));
const port = Number(arg('--port') ?? 8246), out = browserOutputPrefix(arg('--out'));
const inside = relative(root, out); if (!inside || (!inside.startsWith('..' + sep) && !isAbsolute(inside))) throw new Error('--out must be outside the source checkout');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const hash = x => createHash('sha256').update(x).digest('hex');
const fixture = resolve(root, 'packages/engine/test/fixtures/kernel/codex-four-leaf.fold');
const files = git('ls-files', 'packages/engine/src/*.js', 'packages/engine/bench/wasm/*', 'apps/web/studio/src/book-world.js',
  'apps/web/studio/src/book-layout.js', 'apps/web/studio/src/physics.js', 'apps/web/dev-server.mjs', 'apps/api/security.py').split('\n').filter(Boolean).sort();
const digest = () => { const h = createHash('sha256'); for (const p of files) { h.update(p + '\0'); h.update(readFileSync(resolve(root, p))); } return h.digest('hex'); };
// Verify the relevant current application directive being reproduced by strict.
if (!readFileSync(resolve(root, 'apps/web/dev-server.mjs'), 'utf8').includes('"script-src \'self\'"') ||
  !readFileSync(resolve(root, 'apps/api/security.py'), 'utf8').includes('(\"script-src\", \"\'self\'\")')) throw new Error('Application CSP changed; review the policy probe');
const status = git('status', '--porcelain'), source = { git: git('rev-parse', 'HEAD'), dirty: !!status, files: files.length,
  aggregateSHA256: digest(), fixtureSHA256: hash(readFileSync(fixture)), browserHarnessSHA256: hash(readFileSync(resolve(local, 'browser-probe.js'))) };
const policy = allow => `default-src 'none'; script-src 'self'${allow ? " 'wasm-unsafe-eval'" : ''}; connect-src 'self'; style-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'`;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Content-Security-Policy', policy(path.startsWith('/allow/'))); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST' && path === '/report') {
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1e6) { res.writeHead(413).end(); return; } }
    try {
      const report = JSON.parse(body);
      if (!['strict', 'allow'].includes(report.mode) || report.source.git !== source.git || digest() !== source.aggregateSHA256 || git('rev-parse', 'HEAD') !== source.git || git('status', '--porcelain') !== status) throw new Error('source changed');
      report.sourceIntegrityVerified = true; report.policy = policy(report.mode === 'allow');
      writeBrowserReport(out, report.mode, report);
      console.log(`browser-probe: ${report.mode} ${report.status}; source unchanged; results=${report.results.length}`);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    } catch { res.writeHead(409).end('source/report mismatch'); }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  if (path === '/config.json') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ source })); return; }
  let file;
  if (path === '/strict/' || path === '/allow/') file = resolve(local, 'browser-probe.html');
  else if (path === '/probe.js') file = resolve(local, 'browser-probe.js');
  else if (path === '/fixture.fold') file = fixture;
  else if (/^\/reader\/(book-world|book-layout|physics)\.js$/.test(path)) file = resolve(root, 'apps/web/studio/src', path.slice('/reader/'.length));
  else if (path.startsWith('/engine/') && path.endsWith('.js')) {
    const base = realpathSync(resolve(root, 'packages/engine/src'));
    try { const candidate = realpathSync(resolve(base, decodeURIComponent(path.slice('/engine/'.length)))); if (candidate.startsWith(base + sep) && statSync(candidate).isFile()) file = candidate; } catch {}
  }
  if (!file) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.fold') ? 'application/json' : 'text/javascript');
  if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
});
server.listen(port, '127.0.0.1', () => console.log(`wasm-browser-server: loopback port=${port}; source=${source.git}; dirty=${source.dirty}; routes=/strict/ /allow/; source files=${files.length}; report prefix=${out}`));
return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runBrowserServer();
