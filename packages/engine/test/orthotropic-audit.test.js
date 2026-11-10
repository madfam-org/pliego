import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../../',import.meta.url)),bench=join(root,'packages/engine/bench');
const sha=b=>createHash('sha256').update(b).digest('hex');
function runtimeFiles(){
  const out=[];
  function visit(dir,prefix=''){for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    if(e.isDirectory())visit(join(dir,e.name),prefix+e.name+'/');
    else if(e.name.endsWith('.js'))out.push({path:prefix+e.name,sha256:sha(readFileSync(join(dir,e.name)))});
  }}
  visit(join(root,'packages/engine/src'));return out;
}

test('independent Green-strain oracle validates finite affine/non-affine derivatives and rigid covariance',()=>{
  const proof=JSON.parse(execFileSync('python3',[join(bench,'orthotropic-reference.py'),'--self-test'],{
    encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
  assert.equal(proof.passed,true);assert.equal(proof.testCases,7);
  assert.ok(proof.checks.affineCases>=108 && proof.checks.coordinateFiniteDifferences>=324);
  console.log('orthotropic-audit-oracle: '+proof.testCases+' tests; finite 3D affine/non-affine/rotation/derivative/domain/linear-limit controls');
});

test('orthotropic repeat and reviewed old-law comparator reject changed results, source and failed gates',()=>{
  const dir=mkdtempSync(join(tmpdir(),'pliego-orthotropic-compare-'));
  try {
    // Small mock results exercise exclusions; they are not numerical acceptance evidence.
    const source=JSON.parse(readFileSync(join(root,'docs/research/evidence/paper-2026-11-10/membrane-run.json'))).source;
    const old={schema:'pliego-membrane-audit/0.1',recordedAt:'old',source,
      runtime:{unit:'mock'},results:[{tensor:1,energy:2}],references:[{valid:true}],
      gates:{oracleValid:true,sourceClean:true,symmetricConstitutiveAccuracy:false}};
    const current=runtimeFiles(),head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    const helper=sha(readFileSync(join(bench,'membrane-patch.mjs')));
    const controls=structuredClone(old);controls.recordedAt='fresh';controls.source.git=head;
    controls.source.engineFiles=current;controls.source.helperSHA256=helper;
    const composite={schema:'pliego-orthotropic-audit/0.1',recordedAt:'root',source:{dirty:false,git:head,engineFiles:current,patchHelperSHA256:helper},
      controls,oracleSelfTest:{result:{passed:true}},references:[{valid:true}],results:[{energy:3,tensor:4}],
      gates:{constitutiveAccuracy:true,physicalStockCalibration:'not measured'}};
    const op=join(dir,'old.json'),np=join(dir,'new.json'),rp=join(dir,'repeat.json'),out=join(dir,'compare.json');
    writeFileSync(op,JSON.stringify(old));writeFileSync(np,JSON.stringify(composite));
    const call=(name,a,b)=>spawnSync(process.execPath,[join(bench,name),a,b,'--out',out],{encoding:'utf8'});
    assert.equal(call('compare-membrane-model-controls.mjs',op,np).status,0);
    for(const mutate of [
      r=>{r.controls.results[0].energy+=1;},r=>{r.controls.gates.symmetricConstitutiveAccuracy=true;},
      r=>{r.controls.references[0].valid=false;},r=>{r.controls.source.referenceSHA256='bad';},
      r=>{r.controls.source.engineFiles[0].sha256='bad';},r=>{r.controls.source.helperSHA256='bad';},
    ]){const r=structuredClone(composite);mutate(r);writeFileSync(np,JSON.stringify(r));assert.notEqual(call('compare-membrane-model-controls.mjs',op,np).status,0);}
    writeFileSync(np,JSON.stringify(composite));
    const repeat=structuredClone(composite);repeat.recordedAt='other';repeat.controls.recordedAt='other-controls';
    writeFileSync(rp,JSON.stringify(repeat));assert.equal(call('compare-orthotropic-audit.mjs',np,rp).status,0);
    for(const mutate of [r=>{r.results[0].tensor+=1;},r=>{r.controls.results[0].energy+=1;},
      r=>{r.gates.physicalStockCalibration='pass';},r=>{r.source.dirty=true;}]){
      const r=structuredClone(repeat);mutate(r);writeFileSync(rp,JSON.stringify(r));assert.notEqual(call('compare-orthotropic-audit.mjs',np,rp).status,0);
    }
    console.log('orthotropic-audit-comparators: reviewed legacy metadata migration and exact new-law replay; ten changed-result/source/gate refusals');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
