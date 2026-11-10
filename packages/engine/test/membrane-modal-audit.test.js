import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const bench=fileURLToPath(new URL('../bench/',import.meta.url));
test('independent modal oracle verifies actual free spectra, mass, BE and finite precision diagnostics',()=>{
  for(const [name,expected]of [['membrane-modal-reference.py',8],['membrane-modal-precision.py',6]]){
    const proof=JSON.parse(execFileSync('python3',[join(bench,name),'--self-test'],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
    assert.equal(proof.passed,true);assert.equal(proof.testsRun,expected);
    console.log('membrane-modal-oracle: '+name+' '+proof.testsRun+' independent tests passed');
  }
});
test('modal report comparator preserves failed gates and refuses hidden instrumentation physics changes',()=>{
  const dir=mkdtempSync(join(tmpdir(),'pliego-modal-comparator-'));
  try{
    // These mocks exercise comparator exclusions only, never numerical acceptance.
    const r={schema:'pliego-membrane-modal-audit/0.1',recordedAt:'first',source:{dirty:false,git:'a'.repeat(40)},
      protocol:{instrument:false,perNewtonLinearDiagnostics:'missing',limits:{continuousField:.01}},oracleSelfTest:{result:{passed:true}},
      gates:{sourceClean:true,oracleValid:true,completeDeclaredMatrix:true,literalForceEverySubstep:false,actualTimeAccuracyAcceptance:false,perNewtonLinearDiagnostics:'missing'},
      results:[{reference:{mode:{omega:1}},trajectories:[{forceTolerance:1e-7,trace:[{literalForceGate:false,rawSHA256:{x:'abc'}}],
        solveObservation:{enabled:false},gates:{literalForceEverySubstep:false,perNewtonLinearDiagnostics:'missing'}}]}]};
    const a=join(dir,'a.json'),b=join(dir,'b.json'),out=join(dir,'out.json');writeFileSync(a,JSON.stringify(r));
    const s=structuredClone(r);s.recordedAt='second';writeFileSync(b,JSON.stringify(s));
    const run=mode=>spawnSync(process.execPath,[join(bench,'compare-membrane-modal-audit.mjs'),a,b,...(mode?['--observer-comparison']:[]),'--out',out],{encoding:'utf8'});
    assert.equal(run(false).status,0);assert.equal(JSON.parse(readFileSync(out)).allRequiredFieldsExactlyEqual,true);
    s.protocol.instrument=true;s.protocol.perNewtonLinearDiagnostics='measured';s.gates.perNewtonLinearDiagnostics=true;
    s.results[0].trajectories[0].solveObservation={enabled:true,records:[{actual:1}]};s.results[0].trajectories[0].gates.perNewtonLinearDiagnostics=true;
    writeFileSync(b,JSON.stringify(s));assert.equal(run(true).status,0);
    for(const mutate of [
      x=>{x.source.git='b'.repeat(40);},x=>{x.results[0].reference.mode.omega=2;},
      x=>{x.results[0].trajectories[0].forceTolerance*=2;},x=>{x.results[0].trajectories[0].trace[0].literalForceGate=true;},
      x=>{x.results[0].trajectories[0].trace[0].rawSHA256.x='changed';},x=>{x.gates.actualTimeAccuracyAcceptance=true;},
      x=>{x.protocol.limits.continuousField=.02;},x=>{x.source.dirty=true;},
    ]){const changed=structuredClone(s);mutate(changed);writeFileSync(b,JSON.stringify(changed));assert.notEqual(run(true).status,0);}
    console.log('membrane-modal-comparator: exact replay and transparent measurement ablation; 8 changed-source/reference/residual/trajectory/gate refusals');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
