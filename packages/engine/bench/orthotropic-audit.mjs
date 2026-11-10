// Objective triangle model vs unchanged scalar-spring controls and two independent references.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, openSync, closeSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runAudit } from './membrane-audit.mjs';
import { makePatch, measureAffine, affineDisplacement } from './membrane-patch.mjs';
import { MODES, extractTensor, tensorErrors, relativeDifference, norm } from './membrane-tensor.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url)),bench=fileURLToPath(new URL('./',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex'),digest=p=>sha(readFileSync(join(bench,p)));
const PYTHON=process.env.PLIEGO_AUDIT_PYTHON||'python3',H=[1e-4,5e-5,2.5e-5];
const REFERENCE_TOLERANCE=1e-7,OBJECTIVITY_TOLERANCE=1e-10;
function source() {
  const engineFiles=[];
  function visit(dir,prefix='') {
    for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)) {
      if(entry.isDirectory())visit(join(dir,entry.name),prefix+entry.name+'/');
      else if(entry.name.endsWith('.js'))engineFiles.push({path:prefix+entry.name,sha256:sha(readFileSync(join(dir,entry.name)))});
    }
  }
  visit(join(root,'packages/engine/src'));
  return {engineFiles,git:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    status:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),
    harnessSHA256:digest('orthotropic-audit.mjs'),patchHelperSHA256:digest('membrane-patch.mjs'),
    linearHarnessSHA256:digest('membrane-audit.mjs'),tensorToolsSHA256:digest('membrane-tensor.mjs'),
    greenReferenceSHA256:digest('orthotropic-reference.py'),greenTestsSHA256:digest('test_orthotropic_reference.py')};
}
function oracle(args,input) {
  const dir=input===undefined?null:mkdtempSync(join(tmpdir(),'pliego-green-input-'));let fd;
  try {
    if(dir){const p=join(dir,'input.json');writeFileSync(p,JSON.stringify(input));fd=openSync(p,'r');}
    return execFileSync(PYTHON,[join(bench,'orthotropic-reference.py'),...args],{
      stdio:[fd===undefined?'ignore':fd,'pipe','pipe'],encoding:'utf8',maxBuffer:32*1024*1024,
      env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  } finally {if(fd!==undefined)closeSync(fd);if(dir)rmSync(dir,{recursive:true,force:true});}
}
function positions(patch,strain) {
  return affineDisplacement(patch,strain).map(([du,dv],i)=>[patch.vertices[i][0]+du,0,-(patch.vertices[i][1]+dv)]);
}
function input(patch,pose) {
  return {material:patch.material,angleDegrees:patch.info.grain,vertices:patch.vertices,triangles:patch.triangles,positions:pose};
}
function gradientError(a,b) {return norm(a.map((r,i)=>r.map((v,j)=>v-b[i][j])))/Math.max(norm(a),norm(b),Number.MIN_VALUE);}
function sampleGreenReferences(patch) {
  const descriptions=[],cases=[];
  for(const h of H)for(const [key,direction] of MODES)for(const [sign,factor] of [['positive',1],['negative',-1]]){
    const strain=direction.map(v=>v*h*factor);descriptions.push({h,key,sign});cases.push(input(patch,positions(patch,strain)));
  }
  const request={cases},raw=oracle([],request),data=JSON.parse(raw).cases;
  assert.equal(data.length,54);
  const byName=new Map();
  for(let i=0;i<data.length;i++){
    const d=data[i],meta=descriptions[i];
    assert.equal(d.vertices,patch.vertices.length);assert.equal(d.referencedVertices,d.vertices);assert.equal(d.triangles,patch.triangles.length);
    assert.ok(Math.abs(d.area-patch.area)<=1e-10*patch.area);
    byName.set(meta.h+':'+meta.key+':'+meta.sign,d);
  }
  return {byName,summary:{meshSHA256:patch.meshSHA256,grain:patch.info.grain,cases:data.length,
    inputSHA256:sha(JSON.stringify(request)),outputSHA256:sha(raw),domain:data[0].domain,convention:data[0].convention}};
}
function newCase(patch,control,target,reference) {
  assert.equal(patch.meshSHA256,control.meshSHA256);
  assert.deepEqual(patch.material,control.material);
  assert.deepEqual(patch.info.nativeByteFingerprints,control.mesh.nativeByteFingerprints);
  const amplitudes=[],volume=patch.area*patch.material.thickness;
  let maximumGreenEnergyError=0,maximumGreenGradientError=0,maximumMetricError=0;
  for(let index=0;index<H.length;index++) {
    const h=H[index],zero=measureAffine(patch,[0,0,0]),modes={},energies={zero:zero.energy};
    // Green metric arithmetic can leave roundoff at rest; retain it with a
    // dimensionless bound, rather than snapping a physical energy/gradient.
    const restScaledEnergy=zero.energy/(volume*norm(target));
    assert.ok(restScaledEnergy<=1e-24,'nonzero research rest strain beyond roundoff domain');
    for(const [key,direction]of MODES){
      modes[key]={};energies[key]={};
      for(const [sign,factor]of [['positive',1],['negative',-1]]) {
        const strain=direction.map(v=>v*h*factor),observed=measureAffine(patch,strain);
        const before=control.amplitudes[index].modes[key][sign],expected=reference.byName.get(h+':'+key+':'+sign);
        const displacementSHA256=sha(JSON.stringify(affineDisplacement(patch,strain)));
        assert.equal(displacementSHA256,before.appliedDisplacementSHA256,'linear reference input must match exact actual applied field');
        assert.equal(observed.nonMembraneEnergy,0);assert.equal(observed.steps,0);assert.equal(observed.time,0);
        const actual3D=observed.gradient.map(([gu,gv])=>[gu,0,-gv]);
        const metric=patch.world.orthotropicMembrane.diagnostics(patch.world.x);
        assert.equal(metric.finite,true);
        const metricError=Math.max(...[
          [metric.minimumStretch,expected.minPrincipalStretch],[metric.maximumStretch,expected.maxPrincipalStretch],
          [metric.minimumAreaRatio,expected.minAreaRatio],[metric.maximumAreaRatio,expected.maxAreaRatio],
        ].map(([actual,target])=>Math.abs(actual-target)/Math.max(1,Math.abs(target))));
        maximumMetricError=Math.max(maximumMetricError,metricError);
        const greenEnergyError=Math.abs(observed.energy-expected.energy)/Math.max(Math.abs(expected.energy),Number.MIN_VALUE);
        const greenGradientError=gradientError(actual3D,expected.gradient);
        maximumGreenEnergyError=Math.max(maximumGreenEnergyError,greenEnergyError);
        maximumGreenGradientError=Math.max(maximumGreenGradientError,greenGradientError);
        modes[key][sign]={energy:observed.energy,linearCSTReferenceEnergy:before.referenceEnergy,greenReferenceEnergy:expected.energy,
          relativeLinearEnergyError:Math.abs(observed.energy-before.referenceEnergy)/Math.abs(before.referenceEnergy),
          relativeGreenEnergyError:greenEnergyError,relativeGreenGradientError:greenGradientError,metricError,runtimeMetric:metric,
          appliedDisplacementSHA256:displacementSHA256,generalizedGradient:observed.generalizedGradient,
          interiorResidual:observed.interiorResidual,statsEnergyDelta:observed.statsEnergyDelta,
          minimumPrincipalStretch:expected.minPrincipalStretch,maximumPrincipalStretch:expected.maxPrincipalStretch};
        energies[key][sign]=observed.energy;
      }
    }
    const tensor=extractTensor(energies,volume,h);
    amplitudes.push({h,zeroEnergy:zero.energy,restScaledEnergy,modes,tensor,tensorErrors:tensorErrors(tensor,target)});
  }
  const halving=amplitudes.slice(1).map((a,i)=>({fromH:amplitudes[i].h,toH:a.h,
    relativeFrobeniusChange:relativeDifference(a.tensor,amplitudes[i].tensor),
    maximumEntryChangeNormalizedToQ:Math.max(...a.tensor.flatMap((r,j)=>r.map((v,k)=>Math.abs(v-amplitudes[i].tensor[j][k])/Math.sqrt(target[j][j]*target[k][k]))))}));
  const finest=amplitudes.at(-1);
  const maxSignedEnergyError=Math.max(...Object.values(finest.modes).flatMap(m=>[m.positive.relativeLinearEnergyError,m.negative.relativeLinearEnergyError]));
  return {policy:'orthotropic-stvk',options:patch.options,fixtureSHA256:patch.fixtureSHA256,meshSHA256:patch.meshSHA256,mesh:patch.info,material:patch.material,
    amplitudes,strainHalving:halving,maximumGreenEnergyError,maximumGreenGradientError,maximumMetricError,maximumSignedLinearEnergyError:maxSignedEnergyError,
    gates:{measurementValid:true,finiteGreenReference:maximumGreenEnergyError<=REFERENCE_TOLERANCE&&maximumGreenGradientError<=REFERENCE_TOLERANCE,metricReference:maximumMetricError<=1e-10,
      strainExtraction:halving.every(h=>h.relativeFrobeniusChange<=1e-4&&h.maximumEntryChangeNormalizedToQ<=1e-4),
      tensorFrobenius1Percent:finest.tensorErrors.relativeFrobenius<=.01,tensorEntries1Percent:finest.tensorErrors.maximumNormalizedEntryError<=.01,
      signedEnergy1Percent:maxSignedEnergyError<=.01,physicalStockCalibration:'not measured',interactionPerformance:'not measured'}};
}
function meshComparisons(rows) {
  const out=[],tensor=r=>r.amplitudes.at(-1).tensor;
  for(const a of rows)for(const b of rows)if(a.mesh.grain===b.mesh.grain) {
    if(a.mesh.pattern===b.mesh.pattern&&a.mesh.cells===8&&b.mesh.cells===16)out.push({kind:'mesh-refinement',grain:a.mesh.grain,pattern:a.mesh.pattern,fromCells:8,toCells:16,threshold:.005,relativeTensorChange:relativeDifference(tensor(a),tensor(b))});
    if(a.mesh.cells===16&&b.mesh.cells===16&&a.mesh.pattern<b.mesh.pattern)out.push({kind:'topology',grain:a.mesh.grain,cells:16,patterns:[a.mesh.pattern,b.mesh.pattern],threshold:.01,relativeTensorChange:relativeDifference(tensor(a),tensor(b))});
  }
  for(const item of out)item.pass=item.relativeTensorChange<=item.threshold;
  return out;
}
function rotationMatrix(axis,angle) {
  const n=Math.hypot(...axis),[x,y,z]=axis.map(v=>v/n),c=Math.cos(angle),s=Math.sin(angle),d=1-c;
  return [[c+x*x*d,x*y*d-z*s,x*z*d+y*s],[y*x*d+z*s,c+y*y*d,y*z*d-x*s],[z*x*d-y*s,z*y*d+x*s,c+z*z*d]];
}
function rotate(vector,r) {return r.map(row=>row.reduce((n,v,j)=>n+v*vector[j],0));}
function finiteRotations() {
  const inputs=[],descriptions=[],patches=[];
  for(const grain of [0,30,45,90])for(const strain of [[0,0,0],[.02,-.01,.015],[-.03,.01,-.02]]) {
    const patch=makePatch({cells:4,pattern:'perturbed',grain,membraneModel:'orthotropic-stvk',membraneNu12:.293});
    const original=positions(patch,strain),base=patch.world.orthotropicMembrane;
    const baseGradient=new Float64Array(patch.world.x.length);base.addGradient(original.flat(),baseGradient);
    const energy=base.energy(original.flat()),energyScale=patch.area*patch.material.thickness*norm([[patch.material.E1,patch.material.E2,patch.material.G12]]);
    const forceScale=energyScale/40;
    for(const degrees of [0,90,180]) {
      const r=rotationMatrix([1,2,3],degrees*Math.PI/180),pose=original.map(p=>rotate(p,r).map((v,i)=>v+[17,-11,6][i]));
      inputs.push(input(patch,pose));descriptions.push({grain,strain,degrees,r,pose,energy,energyScale,forceScale,baseGradient:Array.from(baseGradient)});patches.push(patch);
    }
  }
  const request={cases:inputs},raw=oracle([],request),reference=JSON.parse(raw).cases,results=[];
  assert.equal(reference.length,descriptions.length);
  for(let i=0;i<descriptions.length;i++) {
    const d=descriptions[i],law=patches[i].world.orthotropicMembrane,x=d.pose.flat(),g=new Float64Array(x.length),e=law.energy(x);law.addGradient(x,g);
    const gd=d.pose.map((_p,v)=>Array.from(g.subarray(3*v,3*v+3)));
    const rotated=d.pose.map((_p,v)=>rotate(d.baseGradient.slice(3*v,3*v+3),d.r));
    const energyDenominator=Math.max(Math.abs(d.energy),d.energyScale*1e-12),gradientDenominator=Math.max(norm(rotated),d.forceScale);
    const rotationEnergyError=Math.abs(e-d.energy)/energyDenominator;
    const rotationGradientError=norm(gd.map((r,j)=>r.map((v,k)=>v-rotated[j][k])))/gradientDenominator;
    const oracleEnergyError=Math.abs(e-reference[i].energy)/Math.max(Math.abs(reference[i].energy),d.energyScale*1e-12);
    const oracleGradientError=norm(gd.map((r,j)=>r.map((v,k)=>v-reference[i].gradient[j][k])))/Math.max(norm(reference[i].gradient),d.forceScale);
    results.push({grain:d.grain,strain:d.strain,rotationDegrees:d.degrees,rotationAxis:[1,2,3],translationMm:[17,-11,6],
      energy:e,referenceEnergy:reference[i].energy,rotationEnergyError,rotationGradientError,oracleEnergyError,oracleGradientError,
      energyNormalization:energyDenominator,gradientNormalization:gradientDenominator,geometry:law.diagnostics(x),
      metricOracleError:Math.max(...[[law.diagnostics(x).minimumStretch,reference[i].minPrincipalStretch],
        [law.diagnostics(x).maximumStretch,reference[i].maxPrincipalStretch],
        [law.diagnostics(x).minimumAreaRatio,reference[i].minAreaRatio],
        [law.diagnostics(x).maximumAreaRatio,reference[i].maxAreaRatio]].map(([actual,target])=>Math.abs(actual-target)/Math.max(1,Math.abs(target)))),
      pass:Math.max(rotationEnergyError,rotationGradientError,oracleEnergyError,oracleGradientError)<=OBJECTIVITY_TOLERANCE});
  }
  return {inputSHA256:sha(JSON.stringify(request)),outputSHA256:sha(raw),cases:results.length,results,
    scope:'Selected membrane law only; finite 3D rotations reuse original UV/material reference. Exact derivatives and full World dynamics require their separate tests.'};
}
export function runOrthotropicAudit({allowDirty=false,smoke=false}={}) {
  const begin=source();assert.ok(allowDirty||!begin.status,'clean checkout required; --allow-dirty is development only');
  const selfTestRaw=oracle(['--self-test']),selfTest=JSON.parse(selfTestRaw);assert.equal(selfTest.passed,true);
  const controls=runAudit({allowDirty,smoke}),results=[],references=[];
  for(const control of controls.results.filter(r=>r.policy==='uncapped-symmetric')){
    const patch=makePatch({cells:control.mesh.cells,pattern:control.mesh.pattern,grain:control.mesh.grain,
      membraneModel:'orthotropic-stvk',membraneNu12:.293});
    const linear=controls.references.find(r=>r.meshSHA256===patch.meshSHA256&&r.angleDegrees===patch.info.grain);
    assert.ok(linear,'exact-mesh linear reference required');
    const green=sampleGreenReferences(patch);references.push(green.summary);
    results.push(newCase(patch,control,linear.engineeringQGlobal,green));
  }
  const comparisons=meshComparisons(results),rotations=finiteRotations();
  assert.deepEqual(source(),begin,'source changed during orthotropic audit; discard results');
  return {schema:'pliego-orthotropic-audit/0.1',recordedAt:new Date().toISOString(),source:{...begin,status:undefined,dirty:!!begin.status},
    runtime:controls.runtime,protocol:{scope:'Research law accuracy/finite-objectivity audit; no World stepping, performance, solved-boundary-value or stock calibration acceptance',
      explicitResearchContract:'physicalMembrane:true, membraneCompression:1, explicit per-sheet nu12 convention, Gauss-Newton curvature and no legacy projections; default edge controls unchanged',
      metricReferenceTolerance:1e-10,finiteGreenAgreementTolerance:REFERENCE_TOLERANCE,objectivityTolerance:OBJECTIVITY_TOLERANCE,
      normalization:'Linear CST 1% tensor/energy and h/mesh/topology thresholds unchanged. Finite-Green near-rest comparison uses 1e-7 relative energy/gradient to accommodate metric subtraction roundoff; raw maxima retained. Rotation gradient errors use max(full-gradient norm, A*t*material modulus norm /40mm); zero-energy rotation uses A*t*modulus norm *1e-12 floor. No physical parameter is rescaled.',
      referenceReuse:'Exact native mesh/material and applied-displacement SHA256 must match fresh controls before reusing their independently evaluated linear CST energies/Q. Every new-model pose is independently evaluated by the finite Green oracle.',
      smoke},oracleSelfTest:{result:selfTest,outputSHA256:sha(selfTestRaw)},controls,references,results,meshComparisons:comparisons,finiteRotations:rotations,
    gates:{sourceClean:!begin.status,completeMatrix:!smoke&&results.length===36&&controls.results.length===108,
      allFiniteGreenReference:results.every(r=>r.gates.finiteGreenReference),allMetricReference:results.every(r=>r.gates.metricReference)&&rotations.results.every(r=>r.metricOracleError<=1e-10),allStrainExtraction:results.every(r=>r.gates.strainExtraction),
      constitutiveAccuracy:results.every(r=>r.gates.tensorFrobenius1Percent&&r.gates.tensorEntries1Percent&&r.gates.signedEnergy1Percent),
      meshAndTopology:comparisons.length>0&&comparisons.every(c=>c.pass),finiteObjectivity:rotations.results.every(r=>r.pass),
      physicalStockCalibration:'not measured',interactionPerformance:'not measured',nonAffineSolvedReference:'not measured'},
    acceptance:'Synthetic constitutive and objectivity evidence only. Does not close non-affine FE, time integration, contact/strain limits, bending/locking, measured stocks or fixed-booklet/device acceptance.'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),oi=args.indexOf('--out'),path=oi>=0?resolve(args[oi+1]||''):null;
  assert.ok(args.every((v,i)=>['--out','--allow-dirty','--smoke'].includes(v)||(oi>=0&&i===oi+1)),'unknown argument');
  if(path){assert.ok(!path.startsWith(root),'write report outside checkout');assert.ok(!existsSync(path),'refuse existing report');}
  const report=runOrthotropicAudit({allowDirty:args.includes('--allow-dirty'),smoke:args.includes('--smoke')});
  const output=JSON.stringify(report,null,2)+'\n';if(path)writeFileSync(path,output);else process.stdout.write(output);
  console.error('orthotropic-audit: controls='+report.controls.results.length+' new cases='+report.results.length+' constitutive='+report.gates.constitutiveAccuracy+' finite-objectivity='+report.gates.finiteObjectivity);
}
