import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const bench=fileURLToPath(new URL('../bench/',import.meta.url));

test('independent CST oracle validates affine reactions, shear, rotation, domain and coordinate derivatives',()=>{
  const proof=JSON.parse(execFileSync('python3',[join(bench,'membrane-reference.py'),'--self-test'],{
    encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},
  }));
  assert.equal(proof.passed,true);assert.equal(proof.testCases,6);
  assert.equal(proof.checks.affineCases,144);assert.equal(proof.checks.coordinateFiniteDifferences,18);
  assert.ok(proof.checks.maxAnalyticScaledError<=1e-10 && proof.checks.maxDerivativeScaledError<=1e-9);
  assert.ok(proof.checks.invalidCasesRejected>=20);
  console.log('membrane-audit-oracle: '+proof.checks.affineCases+' affine references, 18 derivatives, complete domain/CLI/rigid/shear tests');
});

test('membrane audit repeat checker retains failed accuracy and rejects energy, tensor, reference, source and gate changes',()=>{
  const dir=mkdtempSync(join(tmpdir(),'pliego-membrane-repeat-'));
  try {
    const a={schema:'pliego-membrane-audit/0.1',recordedAt:'first',source:{dirty:false,git:'a'.repeat(40)},
      references:[{oracleValid:true,energy:1}],results:[{tensor:[[1,2],[2,3]],energy:2}],
      gates:{oracleValid:true,sourceClean:true,symmetricConstitutiveAccuracy:false}};
    const b=structuredClone(a);b.recordedAt='second';
    const ap=join(dir,'a.json'),bp=join(dir,'b.json'),out=join(dir,'comparison.json');
    writeFileSync(ap,JSON.stringify(a));writeFileSync(bp,JSON.stringify(b));
    const run=()=>spawnSync(process.execPath,[join(bench,'compare-membrane-audit.mjs'),ap,bp,'--out',out],{encoding:'utf8'});
    assert.equal(run().status,0);
    assert.equal(JSON.parse(readFileSync(out)).allNonRecordingFieldsEqual,true);
    for(const change of [
      r=>{r.results[0].energy+=1e-9;},r=>{r.results[0].tensor[0][1]+=1e-9;},
      r=>{r.references[0].energy+=1e-9;},r=>{r.source.git='b'.repeat(40);},
      r=>{r.gates.symmetricConstitutiveAccuracy=true;},r=>{r.source.dirty=true;},
    ]) {
      const c=structuredClone(b);change(c);writeFileSync(bp,JSON.stringify(c));assert.notEqual(run().status,0);
    }
    const unknown=spawnSync(process.execPath,[join(bench,'membrane-audit.mjs'),'--unknown'],{encoding:'utf8'});
    assert.notEqual(unknown.status,0);assert.match(unknown.stderr,/unknown argument/);
    console.log('membrane-audit-repeat: strict whole-report determinism and six changed-field refusals; failed material gate retained; unknown CLI refused');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
