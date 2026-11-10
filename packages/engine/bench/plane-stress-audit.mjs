// Solved non-affine 2D membrane BVP; runtime law/operator vs independent linear CST.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,mkdtempSync,openSync,closeSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {makePatch} from './membrane-patch.mjs';
import {makeBoundary,solveStatic} from './plane-stress-runtime.mjs';
import {fitAffine,compareFields,compareMeshFields,sampleField} from './plane-stress-metrics.mjs';
import {validateRuntime} from './plane-stress-validation.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url)),bench=fileURLToPath(new URL('./',import.meta.url));
const PYTHON=process.env.PLIEGO_AUDIT_PYTHON||'python3';
const LOAD_WINDOWS={base:[1e-4,5e-5,2.5e-5],fourfold:[4e-4,2e-4,1e-4]};
const sha=x=>createHash('sha256').update(x).digest('hex'),norm=a=>Math.hypot(...a.flat());
const SOLVER={maxIterations:100,maxBacktracks:30,armijo:1e-4,relativePivotTolerance:1e-14};
const THRESHOLDS={referenceBalance:1e-10,boundaryForceAgreement:1e-12,field:.01,maximumNodal:.01,energy:.01,reaction:.01,
  finiteStrain:.001,genuineNonAffinity:1e-3,affineControl:1e-10,mesh:.01,topology:.01};
function source(){
  const files=[],visit=(dir,prefix='')=>{
    for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
      if(e.isDirectory())visit(join(dir,e.name),prefix+e.name+'/');
      else if(e.name.endsWith('.js'))files.push({path:prefix+e.name,sha256:sha(readFileSync(join(dir,e.name)))});
    }
  };visit(join(root,'packages/engine/src'));
  const tools=['plane-stress-audit.mjs','compare-plane-stress-audit.mjs','plane-stress-reference.py','test_plane_stress_reference.py','plane-stress-precision.py','test_plane_stress_precision.py','plane-stress-runtime.mjs','plane-stress-metrics.mjs','plane-stress-validation.mjs','membrane-patch.mjs'];
  const testRoot=join(root,'packages/engine/test');
  return {git:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    status:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),
    engineFiles:files,tools:tools.map(path=>({path,sha256:sha(readFileSync(join(bench,path)))})),
    tests:readdirSync(testRoot).filter(p=>p.endsWith('.test.js')).sort().map(path=>({path,sha256:sha(readFileSync(join(testRoot,path)))})),
    fixtureBuilderSHA256:sha(readFileSync(join(root,'packages/engine/test/helpers/docbuilder.js')))};
}
function oracle(args,input){
  const dir=input===undefined?null:mkdtempSync(join(tmpdir(),'pliego-plane-fe-'));let fd;
  try{
    if(dir){const path=join(dir,'input.json');writeFileSync(path,JSON.stringify(input));fd=openSync(path,'r');}
    return execFileSync(PYTHON,[join(bench,'plane-stress-reference.py'),...args],{stdio:[fd===undefined?'ignore':fd,'pipe','pipe'],
      encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  }finally{if(fd!==undefined)closeSync(fd);if(dir)rmSync(dir,{recursive:true,force:true});}
}
const scaledError=(a,b,floor=Number.MIN_VALUE)=>Math.abs(a-b)/Math.max(Math.abs(b),floor);
function forceAgreement(actual,reference){
  return norm(actual.map((row,i)=>row.map((v,j)=>v-reference[i][j])))/Math.max(norm(reference),1e-7);
}
function balance(vertices,displacement,forces,reaction){
  const force=[0,0];let moment=0;
  for(let i=0;i<vertices.length;i++){
    const f=[forces[i][0]+reaction[i][0],forces[i][1]+reaction[i][1]];
    force[0]+=f[0];force[1]+=f[1];
    moment+=(vertices[i][0]+displacement[i][0])*f[1]-(vertices[i][1]+displacement[i][1])*f[0];
  }
  const applied=forces.reduce((n,f)=>[n[0]+f[0],n[1]+f[1]],[0,0]),scale=Math.max(1e-7,Math.hypot(...applied));
  return {force,forceScale:scale,forceScaled:Math.hypot(...force)/scale,moment,momentScale:40*scale,momentScaled:Math.abs(moment)/(40*scale),
    convention:'runtime physical support gradient-minus-dead-load at constrained DOFs only; free reactions zero; moment uses current positions'};
}
function meanRightExtension(vertices,triangles,displacement){
  const edges=new Map();for(const t of triangles)for(let k=0;k<3;k++){
    const a=t[k],b=t[(k+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(',');
    const e=edges.get(key);if(e)e.count++;else edges.set(key,{a,b,count:1});
  }
  let value=0,length=0;
  for(const e of edges.values())if(e.count===1&&vertices[e.a][0]===40&&vertices[e.b][0]===40){
    const l=Math.hypot(vertices[e.a][0]-vertices[e.b][0],vertices[e.a][1]-vertices[e.b][1]);
    value+=l*(displacement[e.a][0]+displacement[e.b][0])/2;length+=l;
  }
  assert.ok(Math.abs(length-40)<=1e-10);return value/length;
}
function referenceScope(patch,bc,ref){
  const affine=fitAffine(patch.vertices,ref.displacement);
  return bc.boundary==='clamped-left'?affine.relativeResidual>THRESHOLDS.genuineNonAffinity:affine.relativeResidual<=THRESHOLDS.affineControl;
}
function compareLoad(patch,bc,ref,runtime,validation){
  const valid=validation.valid&&Number.isFinite(runtime.energy)&&runtime.reaction&&runtime.fixedExact&&runtime.planarExact&&
    runtime.steps===0&&runtime.frames===0&&runtime.time===0&&runtime.nonMembraneEnergy===0&&runtime.nonMembraneGradientMax===0;
  if(!valid)return {valid:false,gates:{referenceValid:ref.valid,measurementValid:false,nonAffineScope:referenceScope(patch,bc,ref),runtimeConverged:false,sameMeshAccuracy:false},classification:'measurement-invalid'};
  const field=compareFields(patch,runtime.displacement,ref.displacement,{eta:ref.eta});
  const maximumReferenceDisplacement=Math.max(...ref.displacement.map(u=>Math.hypot(...u)));
  const maximumNodalRelative=field.maximumNodalError/Math.max(maximumReferenceDisplacement,field.displacementFloor);
  const fixed=new Set(bc.fixedDofs),actualReaction=runtime.reaction.flat().filter((_v,i)=>fixed.has(i)),expectedReaction=ref.reaction.flat().filter((_v,i)=>fixed.has(i));
  const reactionDifference=norm(actualReaction.map((v,i)=>v-expectedReaction[i])),reactionDenominator=Math.max(norm(expectedReaction),1e-7);
  const reactionError=reactionDifference/reactionDenominator,energyError=scaledError(runtime.energy,ref.energy,1e-30);
  const equilibrium=balance(patch.vertices,runtime.displacement,bc.forces,runtime.reaction);
  const affine=fitAffine(patch.vertices,runtime.displacement),referenceAffine=fitAffine(patch.vertices,ref.displacement);
  const nonAffineScope=bc.boundary==='clamped-left'?referenceAffine.relativeResidual>THRESHOLDS.genuineNonAffinity&&(!runtime.converged||affine.relativeResidual>THRESHOLDS.genuineNonAffinity):
    referenceAffine.relativeResidual<=THRESHOLDS.affineControl;
  return {valid:true,field,maximumNodalRelative,maximumReferenceDisplacement,energyRelativeError:energyError,
    reactionRelativeError:reactionError,reactionAbsoluteL2:reactionDifference,reactionDenominator,equilibrium,affineFit:affine,referenceAffineFit:referenceAffine,
    meanRightExtensionMm:meanRightExtension(patch.vertices,patch.triangles,runtime.displacement),
    referenceMeanRightExtensionMm:meanRightExtension(patch.vertices,patch.triangles,ref.displacement),
    gates:{referenceValid:ref.valid,measurementValid:true,runtimeConverged:validation.converged,forceAndMoment:equilibrium.forceScaled<=THRESHOLDS.referenceBalance&&equilibrium.momentScaled<=THRESHOLDS.referenceBalance,
      nonAffineScope,field1Percent:field.relativeL2<=THRESHOLDS.field,maximumNodal1Percent:maximumNodalRelative<=THRESHOLDS.maximumNodal,
      energy1Percent:energyError<=THRESHOLDS.energy,reaction1Percent:reactionError<=THRESHOLDS.reaction,
      sameMeshAccuracy:runtime.converged&&ref.valid&&field.relativeL2<=THRESHOLDS.field&&maximumNodalRelative<=THRESHOLDS.maximumNodal&&energyError<=THRESHOLDS.energy&&reactionError<=THRESHOLDS.reaction},
    classification:!ref.valid?'reference-invalid':runtime.converged?'valid-discrete-comparison':'finite-field-diagnostics-with-unconverged-residual'};
}
function normalizedHalving(patch,loads){
  const out=[];
  for(let i=1;i<loads.length;i++){
    const a=loads[i-1],b=loads[i];
    if(!a.validation?.converged||!b.validation?.converged){out.push({fromEta:a.eta,toEta:b.eta,valid:false,pass:false});continue;}
    const ua=a.runtime.displacement.map(r=>r.map(v=>v/a.eta)),ub=b.runtime.displacement.map(r=>r.map(v=>v/b.eta));
    const field=compareFields(patch,ua,ub,{eta:1}),ea=a.runtime.energy/a.eta**2,eb=b.runtime.energy/b.eta**2;
    const ra=a.runtime.reaction.flat().map(v=>v/a.eta),rb=b.runtime.reaction.flat().map(v=>v/b.eta);
    const energyChange=scaledError(ea,eb),reactionChange=norm(ra.map((v,j)=>v-rb[j]))/Math.max(norm(rb),1e-7);
    out.push({fromEta:a.eta,toEta:b.eta,valid:true,normalizedDisplacementChange:field.relativeL2,
      normalizedEnergyChange:energyChange,normalizedReactionChange:reactionChange,
      pass:field.relativeL2<=THRESHOLDS.finiteStrain&&energyChange<=THRESHOLDS.finiteStrain});
  }
  return out;
}
function commonGrid(){return Array.from({length:33},(_,j)=>Array.from({length:33},(_,i)=>[40*i/32,40*j/32])).flat();}
function meshComparisons(rows,levels){
  const comparisons=[],points=commonGrid(),finest=levels.at(-1),coarser=levels.at(-2),last=r=>r.loads.at(-1);
  for(const a of rows)for(const b of rows){
    if(a.grain!==b.grain||a.boundary!==b.boundary)continue;
    let kind;
    if(a.pattern===b.pattern&&a.cells===coarser&&b.cells===finest)kind='mesh-refinement';
    if(a.cells===finest&&b.cells===finest&&a.pattern<b.pattern)kind='topology';
    if(!kind)continue;
    if(!last(a)?.validation.converged||!last(b)?.validation.converged){comparisons.push({kind,from:[a.pattern,a.cells],to:[b.pattern,b.cells],grain:a.grain,boundary:a.boundary,valid:false,pass:false});continue;}
    const meshA={vertices:a.vertices,triangles:a.triangles},meshB={vertices:b.vertices,triangles:b.triangles},eta=last(a).eta;
    const runtime=compareMeshFields(meshA,last(a).runtime.displacement,meshB,last(b).runtime.displacement,points,{eta});
    const reference=compareMeshFields(meshA,last(a).reference.displacement,meshB,last(b).reference.displacement,points,{eta});
    const energyChange=scaledError(last(a).runtime.energy,last(b).runtime.energy),referenceEnergyChange=scaledError(last(a).reference.energy,last(b).reference.energy);
    const extensionChange=scaledError(last(a).comparison.meanRightExtensionMm,last(b).comparison.meanRightExtensionMm,eta*40*1e-12);
    const referenceExtensionChange=scaledError(last(a).comparison.referenceMeanRightExtensionMm,last(b).comparison.referenceMeanRightExtensionMm,eta*40*1e-12);
    const threshold=kind==='mesh-refinement'?THRESHOLDS.mesh:THRESHOLDS.topology;
    comparisons.push({kind,from:[a.pattern,a.cells],to:[b.pattern,b.cells],grain:a.grain,boundary:a.boundary,eta,valid:true,
      runtime,reference,energyChange,referenceEnergyChange,extensionChange,referenceExtensionChange,threshold,
      pass:Math.max(runtime.relativeRms,reference.relativeRms,energyChange,referenceEnergyChange,extensionChange,referenceExtensionChange)<=threshold});
  }
  return {points,comparisons,scope:'33x33 fixed UV grid, deterministic barycentric interpolation; sampled displacement RMS, elastic energy and mean loaded-edge extension; no maximum-stress convergence claim'};
}
export function runPlaneStressAudit({allowDirty=false,smoke=false,maxCells=8,lineSearchMode='total-potential',loadWindow='base'}={}){
  assert.ok([8,16,32].includes(maxCells),'maxCells must be 8,16 or32');
  assert.ok(['total-potential','energy-difference'].includes(lineSearchMode),'unknown lineSearchMode');
  assert.ok(Object.hasOwn(LOAD_WINDOWS,loadWindow),'unknown loadWindow');const ETAS=LOAD_WINDOWS[loadWindow];
  const begin=source();assert.ok(allowDirty||!begin.status,'clean checkout required; --allow-dirty is development-only');
  const proofRaw=oracle(['--self-test']),proof=JSON.parse(proofRaw);assert.equal(proof.passed,true);assert.ok(proof.testCases>0);
  const levels=smoke?[2]:[2,4,8,16,32].filter(n=>n<=maxCells),patterns=smoke?['forward','perturbed']:['forward','alternating','perturbed'],grains=smoke?[0,30]:[0,30,45,90];
  const cases=[],patches=[],topology=new Map();
  for(const pattern of patterns)for(const cells of levels)for(const grain of grains)for(const boundary of ['clamped-left','poisson-compatible']){
    if(boundary==='poisson-compatible'&&grain!==0&&grain!==90)continue;
    const patch=makePatch({cells,pattern,grain,membraneModel:'orthotropic-stvk',membraneNu12:.293});
    const key=pattern+':'+cells,native=JSON.stringify(patch.info.nativeByteFingerprints);
    if(topology.has(key))assert.equal(native,topology.get(key),'grain changed native mesh');else topology.set(key,native);
    patches.push(patch);cases.push({material:patch.material,angleDegrees:grain,vertices:patch.vertices,triangles:patch.triangles,loadScales:ETAS,boundary});
  }
  const request={cases},referenceRaw=oracle([],request),reference=JSON.parse(referenceRaw).cases;assert.equal(reference.length,cases.length);
  const rows=[];
  for(let i=0;i<cases.length;i++){
    const patch=patches[i],ref=reference[i],meta=cases[i],loads=[];
    assert.equal(ref.vertices,patch.vertices.length);assert.equal(ref.triangles,patch.triangles.length);assert.equal(ref.allVerticesReferenced,true);
    assert.deepEqual(ref.material,patch.material);assert.equal(ref.loads.length,ETAS.length);
    assert.ok(Math.abs(ref.area-patch.area)<=1e-10*patch.area);
    assert.equal(ref.valid,true,'independent reference validity must pass before judging runtime');
    for(let j=0;j<ETAS.length;j++){
      const eta=ETAS[j],bc=makeBoundary(patch,eta,meta.boundary),expected=ref.loads[j];assert.equal(expected.eta,eta);
      assert.deepEqual(bc.fixedDofs,ref.fixedDofs);assert.deepEqual(bc.freeDofs,ref.freeDofs);
      const loadError=forceAgreement(bc.forces,expected.force);assert.ok(loadError<=THRESHOLDS.boundaryForceAgreement,'independently derived boundary load mismatch');
      let runtime,comparison,error,validation;
      try{runtime=solveStatic(patch,{forces:bc.forces,fixedDofs:bc.fixedDofs,...SOLVER,lineSearchMode});
        validation=validateRuntime(patch,bc,runtime,{solver:SOLVER,lineSearchMode});comparison=compareLoad(patch,bc,expected,runtime,validation);}
      catch(cause){error={name:cause.name,message:cause.message};runtime={converged:false,status:'measurement-exception',error,lineSearchMode};validation={valid:false,converged:false,errors:[cause.message]};
        comparison={valid:false,gates:{measurementValid:false,nonAffineScope:referenceScope(patch,bc,expected),runtimeConverged:false,sameMeshAccuracy:false},classification:'measurement-exception'};}
      loads.push({eta,boundary:bc,reference:expected,runtime,comparison,validation,error,solverPolicy:SOLVER,loadRelativeAgreement:loadError});
      console.error('plane-stress-progress: '+meta.boundary+' '+patch.info.pattern+' cells='+patch.info.cells+' grain='+patch.info.grain+' eta='+eta+' '+runtime.status+' residual='+runtime.residualInfinity+'/'+runtime.forceTolerance);
    }
    const halving=normalizedHalving(patch,loads),last=loads.at(-1);
    rows.push({cells:patch.info.cells,pattern:patch.info.pattern,grain:patch.info.grain,boundary:meta.boundary,
      vertices:patch.vertices,triangles:patch.triangles,material:patch.material,options:patch.options,mesh:patch.info,
      meshSHA256:patch.meshSHA256,fixtureSHA256:patch.fixtureSHA256,reference:{...ref,loads:undefined},loads,amplitudeHalving:halving,
      gates:{referenceValid:ref.valid,measurementValid:loads.every(l=>l.validation.valid),allRuntimeConverged:loads.every(l=>l.validation.converged),
        genuineScope:loads.every(l=>l.comparison.gates.nonAffineScope===true),
        forceAndMoment:loads.every(l=>l.comparison.gates.forceAndMoment===true),
        finestSameMeshAccuracy:last.comparison.gates.sameMeshAccuracy===true,
        smallStrainSeparated:halving.length>0&&halving.at(-1).pass,physicalStockCalibration:'not measured',timeAccuracy:'not measured',interactionPerformance:'not measured'}});
  }
  const mesh=meshComparisons(rows,levels);
  // Retain one field for direct visualization/reconstruction; all nodal fields
  // and references are already in rows. Sampling does not feed the solution.
  const selected=rows.find(r=>r.boundary==='clamped-left'&&r.pattern==='perturbed'&&r.grain===30&&r.cells===levels.at(-1));
  const precisionPatch=patches.find(p=>p.info.pattern==='forward'&&p.info.grain===0&&p.info.cells===levels.at(-1));
  const precisionFixture={case:{cells:levels.at(-1),pattern:'forward',grain:0,boundary:'clamped-left'},
    triangles:Array.from({length:precisionPatch.world.mesh.nT},(_,i)=>Array.from(precisionPatch.world.mesh.tris.subarray(3*i,3*i+3))),
    elements:precisionPatch.world.orthotropicMembrane.elements.map(e=>({alpha:Array.from(e.alpha),beta:Array.from(e.beta),Q:Array.from(e.Q),volume:e.volume})),
    scope:'actual immutable runtime coefficients in actual cyclic triangle order for one declared geometry; not an independent constitutive reference'};
  const visualization=selected?.loads.at(-1).validation.converged?{case:{cells:selected.cells,pattern:selected.pattern,grain:selected.grain,boundary:selected.boundary,eta:ETAS.at(-1)},
    points:mesh.points,runtime:sampleField(selected.vertices,selected.triangles,selected.loads.at(-1).runtime.displacement,mesh.points),
    reference:sampleField(selected.vertices,selected.triangles,selected.loads.at(-1).reference.displacement,mesh.points)}:null;
  assert.deepEqual(source(),begin,'source changed during static audit; discard observations');
  const allReference=rows.every(r=>r.gates.referenceValid),allScope=rows.every(r=>r.gates.genuineScope),allEquilibrium=rows.every(r=>r.gates.forceAndMoment),smallStrain=rows.every(r=>r.gates.smallStrainSeparated);
  const allConverged=rows.every(r=>r.gates.allRuntimeConverged),sameMesh=rows.every(r=>r.gates.finestSameMeshAccuracy),meshPass=mesh.comparisons.length>0&&mesh.comparisons.every(c=>c.pass);
  const allMeasurements=rows.every(r=>r.gates.measurementValid),completeMatrix=!smoke&&rows.length===3*levels.length*6;
  const numericalClassification=!allReference?'reference-invalid':!allScope?'scope-invalid':!allMeasurements?'measurement-invalid':!allConverged?'runtime-nonconvergence':!allEquilibrium?'force-or-moment-imbalance':!smallStrain?'finite-strain-not-separated':!sameMesh?'same-mesh-comparison-failed':!meshPass?'discretization-not-converged':'synthetic-static-BVP-pass';
  return {schema:'pliego-plane-stress-audit/0.1',recordedAt:new Date().toISOString(),source:{...begin,status:undefined,dirty:!!begin.status},
    runtime:{node:process.version,python:execFileSync(PYTHON,['--version'],{encoding:'utf8'}).trim(),arch:process.arch,platform:process.platform},
    protocol:{scope:'Synthetic solved 2D static membrane BVP, actual runtime energy/gradient/GN blocks vs independent assembled/solved linear CST. Hard benchmark Dirichlet constraints, not authored-join support.',
      initialPose:'zero displacement independently for every load; no oracle displacement initialization or continuation',
      plane:'sheet [u,v] maps to world [u,0,-v]; restrict 3D GN to x/z before solving; no mass/bending/epsilon regularization, timestep or sleep',
      boundaries:'full left u/v clamp plus right horizontal reference-edge dead traction; aligned 0/90 Poisson-compatible roller control separately labeled',
      material:'synthetic E1=5.5e9,E2=2.5e9 microN/mm^2,t=.1mm,G12=.387sqrt(E1E2), explicit nu12=.293; stock Poisson convention unresolved',
      levels,patterns,grains,loadScales:ETAS,loadWindow,thresholds:THRESHOLDS,solverControls:SOLVER,smoke,maxCells,lineSearchMode,
      loadWindowScope:'base failures remain visible; fourfold is a separately labeled load-amplitude study of the finite-strain/absolute-position-precision window, with identical material and numerical/accuracy thresholds',
      forceTolerance:'max(1e-7 microN,1e-10*maximum nodal Euclidean applied load); exact free gradient residual; fixed reactions only, current moment for runtime/reference moment for linear oracle',
      nonFiniteEncoding:'invalid nonfinite numbers retained as {nonFinite:label}, never silently accepted as zero/null'},
    oracleSelfTest:{result:proof,outputSHA256:sha(proofRaw)},referenceCapture:{inputSHA256:sha(JSON.stringify(request)),outputSHA256:sha(referenceRaw),geometries:cases.length},
    results:rows,meshComparisons:mesh,visualization,precisionFixture,
    gates:{sourceClean:!begin.status,completeMatrix,referenceValid:allReference,measurementValid:allMeasurements,
      allRuntimeConverged:allConverged,genuineNonAffineScope:allScope,forceAndMoment:allEquilibrium,
      sameMeshAccuracy:sameMesh,smallStrainSeparated:smallStrain,meshAndTopology:meshPass,
      physicalStockCalibration:'not measured',timeAccuracy:'not measured',interactionPerformance:'not measured',newModelBooklet:'not measured'},
    numericalClassification,evidenceStatus:begin.status?'development-only':!completeMatrix?'incomplete-protocol':'clean-source-complete',
    classification:(begin.status?'development-only/':!completeMatrix?'incomplete-protocol/':'')+numericalClassification,
    acceptance:'Solved synthetic in-plane model and static numerical solution only. Same-mesh oracle agreement does not imply mesh convergence, calibrated paper, dynamic buckling/time accuracy, new-law joins/hand/booklets or an 8ms device result.'};
}
function encode(value){return JSON.stringify(value,(_key,v)=>typeof v==='number'&&!Number.isFinite(v)?{nonFinite:Number.isNaN(v)?'NaN':v>0?'Infinity':'-Infinity'}:v,2)+'\n';}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),oi=args.indexOf('--out'),mi=args.indexOf('--max-cells'),li=args.indexOf('--line-search'),wi=args.indexOf('--load-window'),path=oi>=0?resolve(args[oi+1]||''):null;
  assert.ok(args.every((v,i)=>['--out','--max-cells','--line-search','--load-window','--allow-dirty','--smoke'].includes(v)||(oi>=0&&i===oi+1)||(mi>=0&&i===mi+1)||(li>=0&&i===li+1)||(wi>=0&&i===wi+1)),'unknown argument');
  if(path)assert.ok(!path.startsWith(root),'write outputs outside checkout');
  const report=runPlaneStressAudit({allowDirty:args.includes('--allow-dirty'),smoke:args.includes('--smoke'),maxCells:mi>=0?Number(args[mi+1]):8,lineSearchMode:li>=0?args[li+1]:'total-potential',loadWindow:wi>=0?args[wi+1]:'base'});
  if(path)writeFileSync(path,encode(report),{flag:'wx',mode:0o600});else process.stdout.write(encode(report));
  console.error('plane-stress-audit: geometries='+report.results.length+' loadCases='+report.results.reduce((n,r)=>n+r.loads.length,0)+' '+report.classification);
}
