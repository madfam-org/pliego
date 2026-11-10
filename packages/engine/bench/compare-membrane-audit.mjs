// Audit reproducibility preserves failed engineering gates; recording time only differs.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const args=process.argv.slice(2), oi=args.indexOf('--out');
assert.ok(oi<0 || (oi===2 && args.length===4),'two reports followed by optional --out required');
const paths=oi<0?args:args.slice(0,oi);
assert.equal(paths.length,2,'two membrane audit reports required');
const bytes=paths.map(p=>readFileSync(p)), reports=bytes.map(b=>JSON.parse(b));
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const r of reports) {
  assert.equal(r.schema,'pliego-membrane-audit/0.1');assert.equal(r.source.dirty,false);
  assert.ok(r.results.length>0 && r.references.length>0);
  assert.equal(r.gates.oracleValid,true);assert.equal(r.gates.sourceClean,true);
}
const comparable=r=>{const c=structuredClone(r);delete c.recordedAt;return c;};
assert.deepEqual(comparable(reports[0]),comparable(reports[1]),'every source/runtime/protocol/reference/mesh/energy/gradient/tensor/diagnostic/gate field must replay exactly');
const result={schema:'pliego-membrane-audit-comparison/0.1',recordedAt:new Date().toISOString(),
  comparisonSHA256:sha(readFileSync(new URL(import.meta.url))),inputSHA256:bytes.map(sha),
  source:reports[0].source,cases:reports[0].results.length,allNonRecordingFieldsEqual:true,
  comparison:'whole reports except recordedAt; source/runtime/protocol/reference/mesh/energy/gradient/tensor/diagnostic/failed engineering gates remain exact',
  acceptance:'repeatability only; engineering accuracy failures and unmeasured physical-stock/device gates retained'};
const output=JSON.stringify(result,null,2)+'\n';
if(oi>=0)writeFileSync(args[oi+1],output);else process.stdout.write(output);
console.error('membrane-audit-repeat: cases='+result.cases+'; all non-recording fields equal; failed gates retained');
