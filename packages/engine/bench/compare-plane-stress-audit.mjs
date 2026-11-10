// Exact replay or same-source numerical-globalization ablation; no physics gate relaxation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),oi=args.indexOf('--out'),ablation=args.includes('--method-comparison'),loadComparison=args.includes('--load-comparison');
assert.ok(!(ablation&&loadComparison),'method and load comparison are mutually exclusive');
assert.ok(oi<0||oi+1<args.length,'--out needs a path');
const paths=args.filter((a,i)=>!['--method-comparison','--load-comparison'].includes(a)&&i!==oi&&!(oi>=0&&i===oi+1));
assert.equal(paths.length,2,'two plane-stress reports required');
assert.ok(paths.every(p=>!p.startsWith('--')),'unknown argument');
const bytes=paths.map(p=>readFileSync(p)),reports=bytes.map(b=>JSON.parse(b)),sha=b=>createHash('sha256').update(b).digest('hex');
for(const r of reports){
  assert.equal(r.schema,'pliego-plane-stress-audit/0.1');assert.equal(r.source.dirty,false);
  assert.equal(r.gates.sourceClean,true);assert.equal(r.gates.referenceValid,true);
  assert.equal(r.oracleSelfTest.result.passed,true);assert.ok(r.results.length>0);
  for(const c of r.results){
    assert.ok(Array.isArray(c.vertices)&&c.vertices.length>0&&Array.isArray(c.loads)&&c.loads.length>0,'nonempty geometry and load observations required');
    for(const l of c.loads){
      assert.equal(l.runtime.lineSearchMode,r.protocol.lineSearchMode,'actual solver mode must match protocol');
      const fixed=l.boundary.fixedDofs,n=2*c.vertices.length;
      assert.ok(Array.isArray(fixed)&&fixed.length>0&&new Set(fixed).size===fixed.length&&fixed.every(i=>Number.isInteger(i)&&i>=0&&i<n),'valid actual boundary mask required');
      const set=new Set(fixed),free=Array.from({length:n},(_v,i)=>i).filter(i=>!set.has(i));
      assert.deepEqual(l.boundary.freeDofs,free,'boundary free mask must complement its fixed mask');
      assert.deepEqual(l.runtime.fixedDofs,fixed.toSorted((a,b)=>a-b),'actual solver fixed mask must match boundary');
      assert.deepEqual(l.runtime.freeDofs,free,'actual solver free mask must match boundary');
      const forces=l.boundary.forces;
      assert.ok(Array.isArray(forces)&&forces.length===c.vertices.length&&forces.every(f=>Array.isArray(f)&&f.length===2&&f.every(Number.isFinite)),'finite actual nodal load vector required');
      const scale=Math.max(...forces.map(f=>Math.hypot(...f)));
      assert.equal(l.runtime.forceScale,scale,'actual force scale must match boundary load');
      assert.equal(l.runtime.absoluteForceTolerance,1e-7);assert.equal(l.runtime.relativeForceTolerance,1e-10);
      assert.equal(l.runtime.forceTolerance,Math.max(1e-7,1e-10*scale),'actual residual threshold must match declared force gate');
      assert.ok(typeof l.runtime.forceScaleDefinition==='string'&&l.runtime.forceScaleDefinition.length>0,'actual force-scale policy metadata required');
      assert.ok(typeof l.runtime.incrementAllowanceConvention==='string'&&l.runtime.incrementAllowanceConvention.length>0,'actual increment policy metadata required');
      assert.equal(l.runtime.initialPose,'zero displacement for each load','actual initialization policy must match protocol');
      assert.deepEqual(l.solverPolicy,r.protocol.solverControls,'per-load solver policy must match protocol');
      for(const [key,value]of Object.entries(l.solverPolicy))assert.equal(l.runtime[key],value,'actual solver '+key+' must match protocol');
    }
  }
}
const numerical=r=>{const c=structuredClone(r);delete c.recordedAt;return c;};
function common(r){
  const protocol=structuredClone(r.protocol);delete protocol.lineSearchMode;
  return {source:r.source,runtime:r.runtime,protocol,oracleSelfTest:r.oracleSelfTest,referenceCapture:r.referenceCapture,precisionFixture:r.precisionFixture,
    samplePoints:r.meshComparisons.points,results:r.results.map(c=>({
      cells:c.cells,pattern:c.pattern,grain:c.grain,boundary:c.boundary,vertices:c.vertices,triangles:c.triangles,material:c.material,
      options:c.options,mesh:c.mesh,meshSHA256:c.meshSHA256,fixtureSHA256:c.fixtureSHA256,reference:c.reference,
      loads:c.loads.map(l=>({eta:l.eta,boundary:l.boundary,reference:l.reference,solverPolicy:l.solverPolicy,loadRelativeAgreement:l.loadRelativeAgreement,
        forceTolerance:l.runtime.forceTolerance,forceScale:l.runtime.forceScale,absoluteForceTolerance:l.runtime.absoluteForceTolerance,
        relativeForceTolerance:l.runtime.relativeForceTolerance,maxIterations:l.runtime.maxIterations,maxBacktracks:l.runtime.maxBacktracks,
        armijo:l.runtime.armijo,relativePivotTolerance:l.runtime.relativePivotTolerance,linearRelativeTolerance:l.runtime.linearRelativeTolerance,
        actualFixedDofs:l.runtime.fixedDofs,actualFreeDofs:l.runtime.freeDofs,forceScaleDefinition:l.runtime.forceScaleDefinition,
        incrementAllowanceConvention:l.runtime.incrementAllowanceConvention,initialPose:l.runtime.initialPose}))
    }))};
}
function compareFourfold(base,candidate){
  const diagnosticDifferences=[],factor=4,diagnosticRoundingTolerance=64*Number.EPSILON;
  const finite=x=>typeof x==='number'&&Number.isFinite(x),hash=x=>assert.match(x,/^[0-9a-f]{64}$/);
  let scalingValuesChecked=0;
  function exact(a,b,f,path){
    if(Array.isArray(a)||Array.isArray(b)){
      assert.ok(Array.isArray(a)&&Array.isArray(b));assert.equal(a.length,b.length,path+' shape');
      for(let i=0;i<a.length;i++)exact(a[i],b[i],f,path+'['+i+']');return;
    }
    assert.ok(finite(a)&&finite(b),path+' finite');assert.equal(b,a*f,path+' must scale exactly by '+f);scalingValuesChecked++;
  }
  function diagnostic(a,b,f,scale,path){
    if(Array.isArray(a)||Array.isArray(b)){
      assert.ok(Array.isArray(a)&&Array.isArray(b));assert.equal(a.length,b.length,path+' shape');
      for(let i=0;i<a.length;i++)diagnostic(a[i],b[i],f,scale,path+'['+i+']');return;
    }
    assert.ok(finite(a)&&finite(b)&&finite(scale)&&scale>0,path+' finite diagnostic');
    const expected=a*f,difference=b-expected,normalized=Math.abs(difference)/scale;
    assert.ok(normalized<=diagnosticRoundingTolerance,path+' exceeds declared diagnostic rounding guard');
    if(difference!==0)diagnosticDifferences.push({path,base:a,candidate:b,expectedScaled:expected,factor:f,difference,scale,normalized,
      tolerance:diagnosticRoundingTolerance,scope:'reference diagnostic rounding only; exact fields/forces/reactions/energies are never relaxed; not an interval certificate'});
  }
  assert.equal(base.protocol.loadWindow,'base');assert.equal(candidate.protocol.loadWindow,'fourfold');
  assert.deepEqual(base.protocol.loadScales,[1e-4,5e-5,2.5e-5]);exact(base.protocol.loadScales,candidate.protocol.loadScales,factor,'protocol.loadScales');
  assert.equal(base.protocol.lineSearchMode,candidate.protocol.lineSearchMode,'load study cannot change numerical globalization');
  const a=structuredClone(common(base)),b=structuredClone(common(candidate));
  delete a.protocol.loadWindow;delete b.protocol.loadWindow;b.protocol.loadScales=a.protocol.loadScales;
  for(const key of ['inputSHA256','outputSHA256']){
    hash(base.referenceCapture[key]);hash(candidate.referenceCapture[key]);
    assert.notEqual(base.referenceCapture[key],candidate.referenceCapture[key],'different load captures must retain distinct '+key);
    delete a.referenceCapture[key];delete b.referenceCapture[key];
  }
  assert.equal(a.results.length,b.results.length);
  const forceKeys=['eta','traction','force','displacement','reaction','totalForce'];
  const energyKeys=['energy','quadraticEnergy','externalWork'];
  const diagnosticKeys=['residualInfinity','forceBalance','forceBalanceScale','forceBalanceScaled','momentBalance','momentBalanceScale','momentBalanceScaled',
    'energyWorkRelativeError','elementEnergyRelativeError','elementGradientRelativeError'];
  const referenceKeys=[...forceKeys,...energyKeys,...diagnosticKeys,'forceTolerance','nonAffineRelativeResidual','valid'].sort();
  for(let i=0;i<a.results.length;i++){
    const ca=a.results[i],cb=b.results[i],prefix='case['+i+']';
    assert.equal(ca.reference.valid,true);assert.equal(cb.reference.valid,true);
    for(const ref of [ca.reference,cb.reference]){
      hash(ref.inputSHA256);assert.equal(ref.tolerances.forceAbsoluteMicroN,1e-7);assert.equal(ref.tolerances.forceRelative,1e-10);
      assert.equal(ref.tolerances.balanceWorkEnergyRelative,1e-10);
      for(const key of ['matrixSHA256','reducedMatrixSHA256','factorSHA256'])hash(ref.matrix[key]);
    }
    assert.notEqual(ca.reference.inputSHA256,cb.reference.inputSHA256,prefix+' reference input hashes must retain changed load input');
    delete ca.reference.inputSHA256;delete cb.reference.inputSHA256;
    assert.deepEqual(ca.reference,cb.reference,prefix+' reference geometry/Q/normalized force/K/reduced K/factor metadata must remain exact');
    assert.equal(ca.loads.length,3);assert.equal(cb.loads.length,ca.loads.length);
    for(let j=0;j<ca.loads.length;j++){
      const x=ca.loads[j],y=cb.loads[j],path=prefix+'.load['+j+']';
      exact(x.eta,y.eta,factor,path+'.eta');assert.equal(x.eta,base.protocol.loadScales[j]);assert.equal(y.eta,candidate.protocol.loadScales[j]);
      for(const key of ['eta','traction','lineLoad','forces','totalForce'])exact(x.boundary[key],y.boundary[key],factor,path+'.boundary.'+key);
      const xr=x.reference,yr=y.reference;
      assert.deepEqual(Object.keys(xr).sort(),referenceKeys,path+' unreviewed base reference-load fields');
      assert.deepEqual(Object.keys(yr).sort(),referenceKeys,path+' unreviewed candidate reference-load fields');
      assert.equal(xr.valid,true);assert.equal(yr.valid,true);
      for(const key of forceKeys)exact(xr[key],yr[key],factor,path+'.reference.'+key);
      for(const key of energyKeys)exact(xr[key],yr[key],factor*factor,path+'.reference.'+key);
      for(const ref of [xr,yr]){
        const nodalScale=Math.max(...ref.force.map(f=>Math.hypot(...f)));
        assert.equal(ref.forceTolerance,Math.max(1e-7,1e-10*nodalScale),path+' reference force threshold');
        assert.ok(ref.residualInfinity>=0&&ref.residualInfinity<=ref.forceTolerance,path+' independent reference residual validity');
        for(const key of ['forceBalanceScaled','momentBalanceScaled','energyWorkRelativeError','elementEnergyRelativeError','elementGradientRelativeError'])
          assert.ok(finite(ref[key])&&ref[key]>=0&&ref[key]<=1e-10,path+' reference diagnostic gate '+key);
      }
      const forceScale=Math.max(1e-7,Math.hypot(...yr.totalForce)),momentScale=40*forceScale;
      for(const key of diagnosticKeys){
        const dimensional=['residualInfinity','forceBalance','forceBalanceScale'].includes(key),moment=['momentBalance','momentBalanceScale'].includes(key);
        diagnostic(xr[key],yr[key],dimensional||moment?factor:1,dimensional?forceScale:moment?momentScale:1,path+'.reference.'+key);
      }
      assert.equal(xr.nonAffineRelativeResidual,yr.nonAffineRelativeResidual,path+' reference affine-scope fit');
      // Canonicalize only fields checked above. Unknown boundary/policy metadata
      // stays in common() and must compare exactly. Runtime outcomes are not inputs.
      y.eta=x.eta;
      for(const key of ['eta','traction','lineLoad','forces','totalForce'])y.boundary[key]=structuredClone(x.boundary[key]);
      y.reference=structuredClone(x.reference);
      exact(x.forceScale,y.forceScale,factor,path+'.actualForceScale');
      y.forceScale=x.forceScale;y.forceTolerance=x.forceTolerance;
    }
  }
  assert.deepEqual(a,b,'only the named fourfold load window and its explicitly verified derived reference/force quantities may differ');
  return {factor,scalingValuesChecked,exactLinearScaling:true,diagnosticRoundingTolerance,referenceDiagnosticDifferences:diagnosticDifferences,
    referenceCaptures:[base.referenceCapture,candidate.referenceCapture],
    retainedOutcomes:[base,candidate].map(r=>({loadWindow:r.protocol.loadWindow,gates:r.gates,classification:r.classification,
      numericalClassification:r.numericalClassification,failedRuntimeLoads:r.results.flatMap(c=>c.loads).filter(l=>!l.runtime.converged).length})),
    scope:'controlled input/reference scaling only; nonlinear runtime outcomes and failed gates retained, not required to scale or improve; diagnostic guard is not a material or interval certificate'};
}
let loadProof;
if(loadComparison)loadProof=compareFourfold(reports[0],reports[1]);
else if(ablation){
  assert.equal(reports[0].protocol.lineSearchMode,'total-potential');assert.equal(reports[1].protocol.lineSearchMode,'energy-difference');
  assert.deepEqual(common(reports[0]),common(reports[1]),'source/runtime/reference/native inputs/material/forces/constraints/budgets/tolerances must agree; only numerical globalization mode differs');
}else assert.deepEqual(numerical(reports[0]),numerical(reports[1]),'whole report except recordedAt must replay, including failed convergence/refinement gates and all traces');
const result={schema:'pliego-plane-stress-comparison/0.1',recordedAt:new Date().toISOString(),comparisonSHA256:sha(readFileSync(new URL(import.meta.url))),
  inputSHA256:bytes.map(sha),source:reports[0].source,geometries:reports[0].results.length,loadCases:reports[0].results.reduce((n,r)=>n+r.loads.length,0),
  mode:loadComparison?'controlled-fourfold-load-window':ablation?'same-source-numerical-globalization':'strict-repeat',
  ...(loadComparison?{loadComparison:loadProof}:{}),
  allRequiredFieldsEqual:true,comparison:loadComparison?'same source/runtime/geometry/material/constraints/solver mode/policies/budgets/threshold constants; exactly fourfold dead loads and independent linear fields/reactions, sixteenfold reference energy/work; K and normalized reference metadata unchanged; runtime outcomes may differ and failed gates retained':ablation?'only numerical globalization selector differs; all source/runtime/oracle/mesh/material/boundary/load/actual constraint mask/budget/force scale and increment policy/force-and-accuracy-threshold inputs exact; convergence/results may differ':
    'whole reports except recordedAt; includes all source/runtime/inputs/reference/solutions/reactions/metrics/solver traces and failed or unmeasured gates',
  acceptance:'reproducibility or controlled numerical comparison only; failed gates remain failures; no physical-stock/time/device acceptance'};
const output=JSON.stringify(result,null,2)+'\n';if(oi>=0)writeFileSync(args[oi+1],output);else process.stdout.write(output);
console.error('plane-stress-compare: '+result.mode+' geometries='+result.geometries+' loadCases='+result.loadCases+' required fields exact');
