#!/usr/bin/env node
// Pliego web — tiny local static server for development (Node built-ins only).
//
//   node apps/web/dev-server.mjs [--port 8090] [--engine <dir>]
//   PLIEGO_ENGINE_DIR=<dir> node apps/web/dev-server.mjs
//
// Serves apps/web at /, the engine source directory at /engine/ (default: packages/engine/src of
// this checkout when it exists), and answers /api/* with 404 JSON so the studio exercises its
// "API not running" fallbacks. Every response carries the production-grade CSP, so the pages are
// tested under the real policy. Local development only: binds to 127.0.0.1.

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const PORT = Number(arg('--port') || process.env.PORT || 8090);
const ENGINE_DIR = resolve(arg('--engine') || process.env.PLIEGO_ENGINE_DIR || join(HERE, '..', '..', 'packages', 'engine', 'src'));

export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.fold': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

const HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-cache',
};

/** Resolve a URL path inside `root`; null when it escapes the root or does not exist. */
function inside(root, rel) {
  const p = normalize(join(root, decodeURIComponent(rel)));
  if (p !== root && !p.startsWith(root + sep)) return null;
  if (!existsSync(p)) return null;
  const st = statSync(p);
  if (st.isDirectory()) { const idx = join(p, 'index.html'); return existsSync(idx) ? idx : null; }
  return p;
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const path = url.pathname;
  if (req.method !== 'GET' && req.method !== 'HEAD' && !path.startsWith('/api/')) { res.writeHead(405, HEADERS).end(); return; }
  if (path.startsWith('/api/')) {
    res.writeHead(404, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'api_not_running', detail: 'The dev server serves static files only.' }));
    return;
  }
  if (path === '/studio') { res.writeHead(301, { ...HEADERS, Location: '/studio/' }).end(); return; }
  const file = path.startsWith('/engine/') ? (existsSync(ENGINE_DIR) ? inside(ENGINE_DIR, path.slice('/engine/'.length)) : null) : inside(HERE, path.slice(1));
  const dotted = path.split('/').some((seg) => seg.startsWith('.'));   // never serve dot-dirs (.engine-tmp, .shots)
  if (!file || dotted) {
    res.writeHead(404, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }
  res.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`pliego web dev server: http://127.0.0.1:${PORT}/ (studio: /studio/) engine=${existsSync(ENGINE_DIR) ? ENGINE_DIR : 'absent → studio uses its stub'}`);
});
