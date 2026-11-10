// Browser-only parity/policy evidence, never a performance or device certificate.
import * as engine from '/engine/index.js';
import { WasmBoundsTree } from '/engine/collision/wasm-bounds-tree.js';
import { boundsKernelMetadata } from '/engine/collision/wasm-bounds-code.js';
import { BookWorld } from '/reader/book-world.js';
import { engineOptions } from '/reader/physics.js';
const output = document.getElementById('result');
const assert = (value, message) => { if (!value) throw new Error(message); };
const byteCopy = a => new Uint8Array(a.buffer, a.byteOffset, a.byteLength).slice();
const sameBytes = (a, b, label) => {
  assert(a.byteLength === b.byteLength, label + ' size');
  const aa = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), bb = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < aa.length; i++) assert(aa[i] === bb[i], label + ' byte ' + i);
};
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
async function main() {
  const mode = location.pathname.startsWith('/strict/') ? 'strict' : 'allow';
  const config = await (await fetch('/config.json')).json();
  const report = { schema: 'pliego-wasm-browser-probe/0.1', recordedAt: new Date().toISOString(), mode,
    runtime: { userAgent: navigator.userAgent, nativeEndian: new Uint8Array(new Uint16Array([1]).buffer)[0] ? 'little' : 'big' },
    wasmKernel: boundsKernelMetadata, source: config.source, results: [],
    scope: 'Local research browser: compilation-policy check and same-browser JS/Wasm first-turn pose/velocity/diagnostic parity. Positive research policy explicitly permits Wasm; production policy, full input/paint performance, actual touch devices and material accuracy are not certified.' };
  try {
    if (mode === 'strict') {
      let blocked = false;
      try { new WasmBoundsTree(1); } catch (e) {
        blocked = (e.name === 'CompileError' || e.name === 'EvalError') && /Content Security Policy|unsafe-eval|Wasm code generation disallowed/i.test(e.message);
        if (!blocked) throw e;
      }
      assert(blocked, 'Strict policy unexpectedly allowed Wasm compilation');
      report.compilationBlockedAsExpected = true; report.status = 'EXPECTED_POLICY_BLOCK';
    } else {
      const fixture = await (await fetch('/fixture.fold')).arrayBuffer();
      assert(await hash(fixture) === config.source.fixtureSHA256, 'fixture fingerprint');
      const json = JSON.parse(new TextDecoder().decode(fixture));
      for (const physicalMembrane of [false, true]) {
        const options = { ...engineOptions(json), meshEdge: 12.5, substeps: 8, barrierContact: true, barrierIterations: 32,
          barrierLinearSolver: 'direct-local', consistentMembraneCurvature: true, edgeEdgeMollification: 'surface-guarded', physicalMembrane, plasticity: false };
        const a = new BookWorld(engine, json, { ...options, contactBroadPhase: 'bvh' });
        const b = new BookWorld(engine, json, { ...options, contactBroadPhase: 'wasm' });
        assert(b.world.coupledContact.potential.candidates.triangleTree.memory instanceof WebAssembly.Memory, 'Wasm tree actually selected');
        assert(a.navigate('forward') && b.navigate('forward'), 'exposed forward turn');
        const samples = [];
        for (let f = 0; f < 84; f++) {
          a.step(1 / 60); b.step(1 / 60);
          sameBytes(a.world.x, b.world.x, 'position frame ' + f); sameBytes(a.world.v, b.world.v, 'velocity frame ' + f);
          assert(JSON.stringify(a.world.stats().coupledContact) === JSON.stringify(b.world.stats().coupledContact), 'force/contact diagnostics frame ' + f);
          samples.push(byteCopy(a.world.x), byteCopy(a.world.v));
          output.textContent = `Running ${physicalMembrane ? 'uncapped' : 'capped'} first turn: ${f + 1}/84 frames; exact backend parity`;
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        sameBytes(a.lastRelease.positions, b.lastRelease.positions, 'pre-promotion release pose');
        assert(JSON.stringify(a.lastRelease.stats.coupledContact) === JSON.stringify(b.lastRelease.stats.coupledContact), 'pre-promotion release diagnostics');
        const coupled = b.lastRelease.stats.coupledContact;
        assert(coupled.unconverged === 0, 'every executed solver step converges');
        const combined = new Uint8Array(samples.reduce((n, x) => n + x.length, 0));
        let offset = 0; for (const x of samples) { combined.set(x, offset); offset += x.length; }
        report.results.push({ model: physicalMembrane ? 'uncapped' : 'capped', options, frames: 84, vertices: b.world.mesh.nV,
          exactPositionVelocityAndDiagnostics: true, sampledPositionVelocitySHA256: await hash(combined),
          releasePoseSHA256: await hash(byteCopy(b.lastRelease.positions)), solverSteps: coupled.steps, unconverged: coupled.unconverged });
        a.dispose(); b.dispose();
      }
      report.status = 'PASS';
    }
  } catch (e) { report.status = 'FAIL'; report.error = { name: e.name, message: String(e.message).replace(/https?:\/\/[^\s]+/g, '[local URL]') }; }
  const response = await fetch('/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
  assert(response.ok, 'source-integrity/report acceptance');
  output.textContent = report.status + '\n' + (report.mode === 'strict' ? 'Current script-src self compilation restriction reproduced.' :
    report.results.map(r => `${r.model}: ${r.frames} frames, ${r.vertices} vertices, ${r.solverSteps} solver steps, ${r.unconverged} force misses; exact x/v/diagnostics`).join('\n')) +
    '\nSource: ' + config.source.git + '\nResearch probe only; performance, production policy and actual-device gates remain separate.';
}
main().catch(e => { output.textContent = 'FAIL: ' + e.message; });
