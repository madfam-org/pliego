import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const bench=fileURLToPath(new URL('../bench/',import.meta.url));
test('independent assembled CST reference self-verifies actual solves, loads, reactions and non-affinity',()=>{
  const proof=JSON.parse(execFileSync('python3',[join(bench,'plane-stress-reference.py'),'--self-test'],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
  assert.equal(proof.passed,true);assert.equal(proof.testCases,8);
  console.log('plane-stress-reference: 8 self-tests passed; assembled/solved BVP, aligned affine control, genuine non-affinity, force/moment/work/residual/domain controls');
});
test('independent Decimal precision diagnostic self-verifies its reconstruction and uncertainty witnesses',()=>{
  const proof=JSON.parse(execFileSync('python3',[join(bench,'plane-stress-precision.py'),'--self-test'],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
  assert.equal(proof.passed,true);assert.ok(proof.testCases>0);
  console.log('plane-stress-precision: '+proof.testCases+' independent Decimal reconstruction/coefficient/position/decision self-tests passed');
});
test('static audit comparators retain failed gates and refuse changed physics inputs or replay results',()=>{
  const dir=mkdtempSync(join(tmpdir(),'pliego-static-comparator-'));
  try{
    // Mock data test comparator exceptions only, never numerical acceptance.
    const r={schema:'pliego-plane-stress-audit/0.1',recordedAt:'first',source:{dirty:false,git:'a'.repeat(40)},runtime:{version:'mock'},
      protocol:{lineSearchMode:'total-potential',thresholds:{field:.01},solverControls:{maxIterations:100}},
      oracleSelfTest:{result:{passed:true}},referenceCapture:{inputSHA256:'x',outputSHA256:'y'},meshComparisons:{points:[[0,0]]},
      precisionFixture:{triangle:[0,1,2],alpha:[-1,1,0]},
      results:[{cells:2,pattern:'forward',grain:0,boundary:'clamped-left',vertices:[[0,0]],triangles:[[0,1,2]],material:{E1:5.5e9},
        options:{},mesh:{},meshSHA256:'m',fixtureSHA256:'f',reference:{valid:true},loads:[{eta:1e-4,boundary:{forces:[[1,0]],fixedDofs:[0,1],freeDofs:[]},
          reference:{energy:1},solverPolicy:{maxIterations:100},loadRelativeAgreement:0,
          runtime:{lineSearchMode:'total-potential',energy:1,forceTolerance:1e-7,forceScale:1,maxIterations:100,
            absoluteForceTolerance:1e-7,relativeForceTolerance:1e-10,fixedDofs:[0,1],freeDofs:[],
            forceScaleDefinition:'maximum nodal Euclidean applied force, microN',incrementAllowanceConvention:'mock numerical policy, not a physics result',
            initialPose:'zero displacement for each load'}}]}],
      gates:{sourceClean:true,referenceValid:true,allRuntimeConverged:false,meshAndTopology:false}};
    const a=join(dir,'a.json'),b=join(dir,'b.json'),out=join(dir,'comparison.json');
    writeFileSync(a,JSON.stringify(r));const s=structuredClone(r);s.recordedAt='other';writeFileSync(b,JSON.stringify(s));
    const run=mode=>spawnSync(process.execPath,[join(bench,'compare-plane-stress-audit.mjs'),a,b,...(mode?['--method-comparison']:[]),'--out',out],{encoding:'utf8'});
    assert.equal(run(false).status,0);assert.equal(JSON.parse(readFileSync(out)).allRequiredFieldsEqual,true);
    const t=structuredClone(s);t.protocol.lineSearchMode='energy-difference';t.results[0].loads[0].runtime.lineSearchMode='energy-difference';
    t.results[0].loads[0].runtime.energy=2;t.gates.allRuntimeConverged=true;writeFileSync(b,JSON.stringify(t));assert.equal(run(true).status,0);
    for(const change of [
      x=>{x.results[0].loads[0].boundary.forces[0][0]+=1;},x=>{x.results[0].loads[0].boundary.fixedDofs=[2];},
      x=>{x.results[0].material.E1+=1;},x=>{x.protocol.thresholds.field=.02;},x=>{x.results[0].loads[0].runtime.maxIterations=200;},
      x=>{x.source.git='b'.repeat(40);},x=>{x.results[0].loads[0].reference.energy=2;},
      x=>{x.results[0].loads[0].runtime.fixedDofs=[0];},x=>{x.results[0].loads[0].runtime.freeDofs=[1];},
      x=>{x.results[0].loads[0].runtime.forceScaleDefinition='changed force scale policy';},
      x=>{x.results[0].loads[0].runtime.incrementAllowanceConvention='changed increment allowance policy';},
      x=>{x.results[0].loads[0].runtime.forceTolerance=1e-6;},
      x=>{x.results[0].loads[0].runtime.initialPose='oracle warm start';},
      x=>{x.precisionFixture.alpha[0]+=1;},
    ]){const c=structuredClone(t);change(c);writeFileSync(b,JSON.stringify(c));assert.notEqual(run(true).status,0);}
    for(const change of [x=>{x.gates.meshAndTopology=true;},x=>{x.results[0].loads[0].runtime.energy+=1;},x=>{x.source.dirty=true;}]){
      const c=structuredClone(s);change(c);writeFileSync(b,JSON.stringify(c));assert.notEqual(run(false).status,0);
    }
    console.log('plane-stress-comparator: exact repeat and same-source mode ablation; 17 changed-input/actual-mask/numerical-policy/precision-fixture/result/failure-gate refusals');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('fourfold load comparison certifies exact linear scaling and retains failed nonlinear outcomes',()=>{
  const dir=mkdtempSync(join(tmpdir(),'pliego-load-comparator-'));
  try{
    const material={E1:5.5e9,E2:2.5e9,nu12:.293,G12:.387*Math.sqrt(5.5e9*2.5e9),thickness:.1};
    const vertices=[[0,0],[40,0],[40,40],[0,40]],triangles=[[0,1,2],[0,2,3]],etas=[1e-4,5e-5,2.5e-5];
    const request=loadScales=>({material,angleDegrees:0,vertices,triangles,loadScales,boundary:'clamped-left'});
    const refs=JSON.parse(execFileSync('python3',[join(bench,'plane-stress-reference.py')],{
      input:JSON.stringify({cases:[request(etas),request(etas.map(v=>4*v))]}),encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}})).cases;
    const report=(reference,window)=>({schema:'pliego-plane-stress-audit/0.1',recordedAt:window,
      source:{dirty:false,git:'a'.repeat(40)},runtime:{version:'mock'},
      protocol:{lineSearchMode:'energy-difference',loadWindow:window,loadScales:window==='base'?etas:etas.map(v=>4*v),
        thresholds:{field:.01},solverControls:{maxIterations:100}},
      oracleSelfTest:{result:{passed:true}},referenceCapture:{inputSHA256:(window==='base'?'a':'b').repeat(64),outputSHA256:(window==='base'?'c':'d').repeat(64),geometries:1},
      precisionFixture:{triangle:triangles[0],alpha:[-1/40,1/40,0]},
      meshComparisons:{points:[[0,0]]},gates:{sourceClean:true,referenceValid:true,allRuntimeConverged:window!=='base',meshAndTopology:false},
      classification:window==='base'?'runtime-nonconvergence':'discretization-not-converged',
      results:[{cells:1,pattern:'forward',grain:0,boundary:'clamped-left',vertices,triangles,material,options:{},mesh:{},meshSHA256:'mesh',fixtureSHA256:'fixture',
        reference:{...reference,loads:undefined},loads:reference.loads.map(ref=>({eta:ref.eta,
          boundary:{eta:ref.eta,traction:ref.traction,lineLoad:ref.traction*material.thickness,forces:ref.force,totalForce:ref.totalForce,
            fixedDofs:reference.fixedDofs,freeDofs:reference.freeDofs,loadedSegments:reference.rightBoundarySegments},
          reference:ref,solverPolicy:{maxIterations:100},loadRelativeAgreement:0,
          runtime:{lineSearchMode:'energy-difference',converged:window!=='base',energy:window==='base'?1:3,forceTolerance:ref.forceTolerance,
            forceScale:Math.max(...ref.force.map(f=>Math.hypot(...f))),maxIterations:100,absoluteForceTolerance:1e-7,relativeForceTolerance:1e-10,
            fixedDofs:reference.fixedDofs,freeDofs:reference.freeDofs,forceScaleDefinition:'maximum nodal Euclidean applied force, microN',
            incrementAllowanceConvention:'mock policy; not a numerical acceptance result',initialPose:'zero displacement for each load'}}))}]});
    const base=report(refs[0],'base'),fourfold=report(refs[1],'fourfold');
    const a=join(dir,'a.json'),b=join(dir,'b.json'),out=join(dir,'comparison.json');
    writeFileSync(a,JSON.stringify(base));writeFileSync(b,JSON.stringify(fourfold));
    const run=extra=>spawnSync(process.execPath,[join(bench,'compare-plane-stress-audit.mjs'),a,b,'--load-comparison',...(extra||[]),'--out',out],{encoding:'utf8'});
    const positive=run();assert.equal(positive.status,0,positive.stderr);
    const result=JSON.parse(readFileSync(out));assert.equal(result.mode,'controlled-fourfold-load-window');assert.equal(result.loadComparison.factor,4);
    assert.equal(result.loadComparison.exactLinearScaling,true);assert.ok(result.loadComparison.scalingValuesChecked>0);
    assert.equal(result.loadComparison.retainedOutcomes[0].failedRuntimeLoads,3);assert.equal(result.loadComparison.retainedOutcomes[1].failedRuntimeLoads,0);
    assert.equal(result.loadComparison.retainedOutcomes[0].gates.meshAndTopology,false);
    assert.equal(result.loadComparison.referenceCaptures[0].inputSHA256,base.referenceCapture.inputSHA256);
    const tiny=structuredClone(fourfold);tiny.results[0].loads[0].reference.energyWorkRelativeError+=1e-16;
    writeFileSync(b,JSON.stringify(tiny));const rounding=run();assert.equal(rounding.status,0,rounding.stderr);
    assert.equal(JSON.parse(readFileSync(out)).loadComparison.referenceDiagnosticDifferences.length,1);
    const mutations=[
      r=>{r.source.git='b'.repeat(40);},r=>{r.runtime.version='changed';},r=>{r.results[0].material.E1+=1;},
      r=>{r.results[0].grain=90;},r=>{r.protocol.thresholds.field=.02;},r=>{r.protocol.solverControls.maxIterations=200;},
      r=>{r.protocol.lineSearchMode='total-potential';},r=>{r.protocol.loadScales[0]*=.5;},
      r=>{r.results[0].loads[0].boundary.fixedDofs=[0];},r=>{r.results[0].loads[0].runtime.freeDofs=[1];},
      r=>{r.results[0].reference.matrix.matrixSHA256='b'.repeat(64);},
      r=>{r.results[0].reference.matrix.reducedMatrixSHA256='b'.repeat(64);},
      r=>{r.results[0].reference.matrix.factorSHA256='b'.repeat(64);},
      r=>{r.results[0].reference.normalizedForce[1][0]+=1;},
      r=>{r.results[0].loads[0].eta*=.5;},r=>{r.results[0].loads[0].boundary.forces[1][0]+=.5;},
      r=>{r.results[0].loads[0].reference.displacement[1][0]+=1e-12;},
      r=>{r.results[0].loads[0].reference.reaction[0][0]+=1e-6;},
      r=>{r.results[0].loads[0].reference.energy+=1e-6;},
      r=>{r.results[0].loads[0].reference.externalWork+=1e-6;},
      r=>{r.results[0].loads[0].runtime.forceTolerance*=2;},
      r=>{r.results[0].loads[0].runtime.relativeForceTolerance=1e-8;},
      r=>{r.results[0].loads[0].reference.energyWorkRelativeError+=1e-8;},
      r=>{r.results[0].loads[0].reference.unreviewedInput=1;},
      r=>{r.precisionFixture.alpha[0]+=1;},
    ];
    for(const [index,change]of mutations.entries()){
      const candidate=structuredClone(fourfold);change(candidate);assert.notDeepEqual(candidate,fourfold,'mutation '+index+' must change binary64 data');
      writeFileSync(b,JSON.stringify(candidate));assert.notEqual(run().status,0,'mutation '+index+' must be refused');
    }
    writeFileSync(b,JSON.stringify(fourfold));assert.notEqual(run(['--method-comparison']).status,0);
    console.log('plane-stress-load-comparator: actual independent linear reference scaling exact; nonlinear/failure outcomes retained; one tiny diagnostic change explicitly recorded; '+(mutations.length+1)+' source/material/mask/K/load/force-policy/unknown-input mutations refused');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
