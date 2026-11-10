// Exact repeatability preserves controls, failures and new-model acceptance separately.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const args=process.argv.slice(2),oi=args.indexOf('--out');
assert.ok(oi<0||(oi===2&&args.length===4),'two reports followed by optional --out required');
const paths=oi<0?args:args.slice(0,oi);assert.equal(paths.length,2,'two orthotropic reports required');
const bytes=paths.map(p=>readFileSync(p)),reports=bytes.map(b=>JSON.parse(b));
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const r of reports){
  assert.equal(r.schema,'pliego-orthotropic-audit/0.1');assert.equal(r.source.dirty,false);assert.equal(r.controls.source.dirty,false);
  assert.ok(r.results.length>0&&r.controls.results.length>0&&r.references.length>0);
  assert.equal(r.controls.gates.oracleValid,true);assert.equal(r.oracleSelfTest.result.passed,true);
}
const comparable=r=>{const c=structuredClone(r);delete c.recordedAt;delete c.controls.recordedAt;return c;};
assert.deepEqual(comparable(reports[0]),comparable(reports[1]),'all non-recording fields of controls, new law, references, poses, tensors and failed/unmeasured gates must agree');
const result={schema:'pliego-orthotropic-audit-comparison/0.1',recordedAt:new Date().toISOString(),comparisonSHA256:sha(readFileSync(new URL(import.meta.url))),
  inputSHA256:bytes.map(sha),source:reports[0].source,controlCases:reports[0].controls.results.length,newCases:reports[0].results.length,
  allNonRecordingFieldsEqual:true,comparison:'whole reports except root recordedAt and controls.recordedAt; includes all source/runtime/protocol/reference/geometry/energy/gradient/tensor/objectivity fields and failed/unmeasured gates',
  acceptance:'deterministic same-model replay only; constitutive, solved-reference, stock and interaction gates remain separate'};
const output=JSON.stringify(result,null,2)+'\n';if(oi>=0)writeFileSync(args[oi+1],output);else process.stdout.write(output);
console.error('orthotropic-repeat: '+result.newCases+' new cases and '+result.controlCases+' controls; all non-recording fields exact');
