// Preserve verified scalar-kernel samples while removing local source paths.
// Mutates callFrame labels only; sample IDs and timing weights are untouched.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
export function sanitizePaperProfile(profile, rootURL, kernel = null) {
  const wasmNodes = profile.nodes.filter(n => (n.callFrame.url || '').startsWith('wasm://'));
  const modules = [...new Set(wasmNodes.map(n => n.callFrame.url))];
  if (kernel) {
    assert.match(kernel.binarySHA256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isInteger(kernel.refitIndex) && kernel.refitIndex >= 0 && Number.isInteger(kernel.queryIndex) && kernel.queryIndex >= 0 && kernel.refitIndex !== kernel.queryIndex, 'invalid verified ABI');
  }
  if (modules.length) { assert.ok(kernel, 'unexpected Wasm frames without verified kernel context'); assert.equal(modules.length, 1, 'multiple Wasm module traces cannot be attributed automatically'); }
  const stats = { moduleGroups: modules.length, kernelFramesMapped: 0, boundaryFramesMapped: 0, boundaryFramesUnattributed: 0,
    binarySHA256: kernel?.binarySHA256 ?? null, refitIndex: kernel?.refitIndex ?? null, queryIndex: kernel?.queryIndex ?? null,
    traceGroupSHA256: modules.length ? createHash('sha256').update(modules[0]).digest('hex') : null,
    rule: kernel ? 'verified runtime engine tree and exported function indices, sole observed Wasm module URL; known ABI boundary signatures only; no kernel sample does not mean zero kernel cost' : 'no Wasm attribution requested; external/runtime names scrubbed; sample weights preserved' };
  const signatures = new Set(['js-to-wasm::', 'js-to-wasm:idiidddddd:i']);
  for (const n of profile.nodes) {
    const f = n.callFrame, url = f.url || '', fn = f.functionName || '';
    if (url.startsWith('wasm://')) {
      const index = /^wasm-function\[(\d+)\]$/.exec(fn);
      assert.ok(index, 'unrecognized Wasm frame name');
      const id = Number(index[1]);
      assert.ok(id === kernel.refitIndex || id === kernel.queryIndex, 'unknown kernel function index');
      f.functionName = id === kernel.refitIndex ? 'refit' : 'query';
      f.url = '/pliego/verified-wasm/pliego-bounds.wasm'; f.lineNumber = -1; f.columnNumber = -1;
      stats.kernelFramesMapped++;
    } else if (modules.length === 1 && signatures.has(fn)) {
      f.functionName = 'boundary'; f.url = '/pliego/verified-wasm/pliego-bounds.wasm'; f.lineNumber = -1; f.columnNumber = -1;
      stats.boundaryFramesMapped++;
    } else if (url.startsWith(rootURL)) f.url = '/pliego/' + url.slice(rootURL.length);
    else {
      if (fn.startsWith('js-to-wasm:')) stats.boundaryFramesUnattributed++;
      f.url = ''; f.lineNumber = -1; f.columnNumber = -1;
      if (!['(root)', '(program)', '(idle)', '(garbage collector)'].includes(fn)) f.functionName = '(runtime)';
    }
  }
  return stats;
}
