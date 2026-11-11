// The fixed 24-trajectory state-ABI experiment. No widened geometry/amplitude matrix.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {makePatch} from './membrane-patch.mjs';
import {loadStateModalInputs,STATE_MODAL_INPUT_PATH} from './membrane-state-modal-inputs.mjs';
import {reserveStateModalOutput} from './membrane-state-modal-output.mjs';
export {reserveStateModalOutput} from './membrane-state-modal-output.mjs';
export {STATE_MODAL_ARCHIVE_GIT} from './membrane-state-modal-inputs.mjs';
import {runModalAudit} from './membrane-modal-audit.mjs';
import {compareModalStates,spectralInitialReference as publicInitialReference} from './membrane-modal-metrics.mjs';
import {createStateModalWorld,runStateModalContext,encodeStateModalVectors} from './membrane-state-modal-runtime.mjs';
import {validateStateObservation} from './membrane-state-modal-validation.mjs';
import {measureStateModalFields,measurePublicStateModalFields,spectralStateInitialReference,compareStateModalStates,modalScales} from './membrane-state-modal-metrics.mjs';
import {attachStateModalSolveObserver} from './membrane-state-modal-solve-observer.mjs';
import {EXACT_CURVATURE_IDENTITY} from '../src/xpbd/membrane-curvature.js';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const sha=data=>createHash('sha256').update(data).digest('hex');
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clone=value=>structuredClone(value);
const ARCHIVE='docs/research/evidence/membrane-reference-2026-11-10/candidate.json.gz';
const OBSERVED='docs/research/evidence/membrane-reference-2026-11-10/observed.json';
export const STATE_MODAL_PROTOCOL=Object.freeze({stage:'diagnostic',matrix:'smoke',amplitude:.004,z0:.08,
  levels:Object.freeze([1,2,4,8]),budgets:Object.freeze([1,4,16]),seeds:Object.freeze([false,true]),
  S0:22422,N0:79,trajectories:24,poststeps:7110,newtonEvents:49770});
export const STATE_MODAL_LIMITS=Object.freeze({mass:1e-12,discreteField:.001,discreteVelocity:.001,discreteEnergy:.005,
  continuousField:.01,continuousVelocity:.01,continuousEnergy:.05,phaseCycles:.01,solveIsolation:1e-4});

/** Includes every new/old producer, helper, oracle and test, not only imported files. */
export function stateModalSource(){
  const paths=[];
  const visit=(folder,prefix,accept)=>{for(const e of readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    if(e.isDirectory())visit(join(folder,e.name),prefix+e.name+'/',accept);
    else if(accept(e.name))paths.push(prefix+e.name);
  }};
  visit(join(root,'packages/engine/src'),'packages/engine/src/',n=>n.endsWith('.js'));
  visit(join(root,'packages/engine/bench'),'packages/engine/bench/',n=>/\.(mjs|py)$/.test(n));
  visit(join(root,'packages/engine/test'),'packages/engine/test/',n=>n.endsWith('.js'));
  paths.push(ARCHIVE,OBSERVED,STATE_MODAL_INPUT_PATH);
  return {git:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    status:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),
    files:paths.sort().map(path=>{const b=readFileSync(join(root,path));return {path,bytes:b.length,sha256:sha(b)};})};
}
export function assertStateModalSource(before){assert.deepEqual(stateModalSource(),before,'source changed during state matrix; discard capture');}
function raw(values){const b=Buffer.alloc(8*values.length);Array.from(values).forEach((v,i)=>b.writeDoubleLE(v,8*i));return b;}
function decode(encoded,hash){const b=Buffer.from(encoded,'base64');assert.equal(b.toString('base64'),encoded);assert.equal(sha(b),hash);assert.equal(b.length%8,0);return Array.from({length:b.length/8},(_,i)=>b.readDoubleLE(8*i));}
function equalWords(a,b,label){assert.ok(raw(a).equals(raw(b)),label);}
/** Small committed input fixture; original archive identity is checked by loader. */
export function loadStateModalPlan(){return loadStateModalInputs();}

function stateHistory(o,context){
  const a=o.authoritative,fields={};
  for(const key of ['x','xs','xt','v'])fields[key]=clone(o[key]);
  for(const key of ['u','us','ut','x0','initialX','initialU','initialV'])fields[key]=clone(a[key]);
  return {step:o.step,time:o.time,h:o.h,targetValid:o.targetValid,execution:clone(o.execution),...fields,mass:context.masses.slice(),
    publicElasticGradient:clone(o.elasticGradient),publicInertiaGradient:clone(o.inertiaGradient),publicResidual:clone(o.residual),
    authoritativeElasticGradient:clone(a.elasticGradient),authoritativeInertiaGradient:clone(a.inertiaGradient),authoritativeResidual:clone(a.residual),
    stateFloat64LE:clone(o.stateFloat64LE),stateSHA256:clone(o.stateSHA256),forceFloat64LE:clone(o.forceFloat64LE),forceSHA256:clone(o.forceSHA256),
    forceBindingScope:clone(o.forceBindingScope??'initial tuples are raw diagnostics only; completed targets certified separately')};
}

function metricSummary(m){return {coordinate:m.coordinate,modalVelocity:m.modalVelocity,modalAmplitude:m.modalAmplitude,energy:m.energy,
  displacementLeakage:m.displacementLeakage,velocityLeakage:m.velocityLeakage,actualPhase:m.actualPhase,errors:clone(m.errors),roundedInitial:clone(m.roundedInitial)};}
function linearSummary(r){const result={iteration:r.iteration,substepsRun:r.substepsRun,source:r.source,valid:r.valid,missing:clone(r.missing),pcgIterations:r.pcgIterations,
  acceptedAlpha:r.acceptedAlpha,lineSearch:clone(r.lineSearch),increment:clone(r.increment)};
  for(const kind of ['nominal','realized'])if(r[kind])result[kind]=Object.fromEntries(Object.entries(r[kind]).filter(([_k,v])=>!Array.isArray(v)&&!ArrayBuffer.isView(v)));
  return result;
}
const initialMaximum=()=>({discreteDisplacement:0,discreteVelocity:0,discreteState:0,discreteEnergy:0,continuousDisplacement:0,continuousVelocity:0,continuousState:0,continuousEnergy:0,phaseCycles:0,materialStrain:0,clockRelative:0});
function updateMaximum(maximum,m,o,steps,phase){
  for(const [prefix,key]of [['discrete','backwardEuler'],['continuous','continuous']])for(const [suffix,field]of [['Displacement','displacement'],['Velocity','velocity'],['State','state'],['Energy','energy']])maximum[prefix+suffix]=Math.max(maximum[prefix+suffix],m.roundedInitial[key][field]);
  maximum.materialStrain=finite(o?.minimumStretch)&&finite(o?.maximumStretch)?Math.max(maximum.materialStrain,Math.abs(o.minimumStretch-1),Math.abs(o.maximumStretch-1)):Infinity;
  maximum.clockRelative=Math.max(maximum.clockRelative,Math.abs(m.time-m.step*m.h)/Math.max(steps*m.h,m.h));
  if(phase!==null)maximum.phaseCycles=Math.max(maximum.phaseCycles,Math.abs(phase-m.omega*m.time)/(2*Math.PI));
}

/** Small tests may call this helper; accepted matrices require the enclosing clean-source guard. */
/** Named PCG stop candidates; omission is the historical relative rule. */
export const STATE_MODAL_PCG_STOPS=Object.freeze({'half-force-tolerance':Object.freeze({rule:'absolute-residual-infinity-norm',factorOfForceTolerance:.5,
  scope:'PCG converges only when the free linear residual infinity norm is at most half the fixed force tolerance; every other PCG constant unchanged'})});
export function runStateModalTrajectory(patch,reference,row,{instrument=true,restoreContinuation=true,membraneCurvature='gauss-newton',pcgStop}={}){
  assert.ok(pcgStop===undefined||Object.hasOwn(STATE_MODAL_PCG_STOPS,pcgStop),'unknown named PCG stop');
  const stop=pcgStop===undefined?{}:{pcgAbsoluteTolerance:STATE_MODAL_PCG_STOPS[pcgStop].factorOfForceTolerance*row.forceTolerance};
  const context=createStateModalWorld(patch,{phi:reference.mode.phi,omega:reference.mode.omega,amplitude:row.amplitude,
    substeps:row.substeps,newtonIterations:row.budget,previousPoseStart:row.seed,...(membraneCurvature==='exact-hessian'?{membraneCurvature}:{}),...stop}),w=context.world;
  const expected=row.initial?.observation;
  if(expected){for(const key of ['x','xs','xt','v'])equalWords(w[key],decode(row.initial.stateFloat64LE[key],expected.rawSHA256[key]),'actual archived initial '+key+' differs');
    equalWords(w.mass,row.runtime.massProof.native,'actual archived mass differs');assert.equal(context.forceScale,row.fixedForceScale);assert.equal(context.forceTolerance,row.forceTolerance);assert.equal(context.modalMass,row.modalMass);
  }
  assert.equal(w.dt,row.h);assert.equal(context.parameters.newtonIterations,row.budget);assert.equal(context.parameters.previousPoseStart,row.seed);
  const config={vertices:patch.vertices,mass:context.masses,phi:context.phi,omega:context.omega,amplitude:row.amplitude},scales=modalScales(config);
  const massDifference=Math.abs(context.modalMass-reference.mode.modalMass)/reference.mode.modalMass;assert.ok(massDifference<=STATE_MODAL_LIMITS.mass);
  const history=[],trace=[],snapshots={},linearTrace=[],linearSnapshots={},checkpointSteps=new Set(Array.from({length:17},(_,i)=>Math.round(row.steps*i/16)));
  let previous=null,initialReference=null,publicReference=null,last=null,checkpoint=null,phase={authoritative:null,public:null},previousPhase={authoritative:null,public:null},phaseObservable={authoritative:true,public:true},allValid=true;
  let publicFailed=0,authorityFailed=0,firstPublicFailure=null,firstAuthorityFailure=null,worstPublic=-1,worstAuthority=-1,closestPublic=Infinity,closestAuthority=Infinity;
  let worstNominal=-1,worstRealized=-1;const maxima={authoritative:initialMaximum(),public:initialMaximum()};
  const observer=instrument?attachStateModalSolveObserver(context,{retain:'none',onIteration:r=>{
    linearTrace.push(linearSummary(r));
    const save=role=>{linearSnapshots[role]=clone(r);};
    for(const [flag,role]of [['accepted','first-accepted'],['stationaryNoop','first-stationary'],['precisionLimited','first-precision-limited'],['rejected','first-rejected']])if(r.lineSearch?.[flag]&&!linearSnapshots[role])save(role);
    if(!r.valid&&!linearSnapshots['first-invalid'])save('first-invalid');
    if(r.nominal?.relativeResidual>worstNominal){worstNominal=r.nominal.relativeResidual;save('worst-nominal');}
    if(r.realized?.residualInfinity>worstRealized){worstRealized=r.realized.residualInfinity;save('worst-realized');}
  }}):null;
  let runtime;
  try{runtime=runStateModalContext(context,{steps:row.steps,retain:'initial-final',onObservation:o=>{
    let validation;try{validation=validateStateObservation(o,{context,previous,world:w});}catch(cause){validation={valid:false,converged:false,publicConverged:false,authoritativeConverged:false,errors:['validator exception: '+cause.message]};}
    allValid&&=validation.valid&&(o.initial||validation.boundaryCertified===true);
    history.push(stateHistory(o,context));
    let measured=null,projected=null,metricsError=null;
    try{if(o.initial){initialReference=spectralStateInitialReference({...config,spectrum:reference.spectrum},o);publicReference=publicInitialReference({...config,spectrum:reference.spectrum},o);}
      measured=measureStateModalFields(config,o,initialReference);projected=measurePublicStateModalFields(config,o,publicReference);
    }catch(cause){metricsError={name:cause.name,message:cause.message};allValid=false;}
    const record={observation:clone(o),validation:clone(validation),metrics:measured,publicMetrics:projected,metricsError};
    const save=role=>{snapshots[role]=record;};
    if(o.initial)save('initial');if(checkpointSteps.has(o.step))save('checkpoint-'+o.step);
    if(!validation.valid&&!snapshots['first-invalid'])save('first-invalid');
    if(metricsError&&!snapshots['first-metrics-error'])save('first-metrics-error');
    if(!o.initial){
      const p=validation.valid&&validation.publicConverged===true&&o.literalForceGate===true,a=validation.valid&&validation.authoritativeConverged===true&&o.authoritative.converged===true;
      if(!p){publicFailed++;if(firstPublicFailure===null){firstPublicFailure=o.step;save('first-public-failure');}}
      if(!a){authorityFailed++;if(firstAuthorityFailure===null){firstAuthorityFailure=o.step;save('first-authoritative-failure');}}
      const pr=finite(o.residualInfinity)?o.residualInfinity/context.forceTolerance:Infinity,ar=finite(o.authoritative.residualInfinity)?o.authoritative.residualInfinity/context.forceTolerance:Infinity;
      if(pr>worstPublic){worstPublic=pr;save('worst-public-force');}if(ar>worstAuthority){worstAuthority=ar;save('worst-authoritative-force');}
      if(p&&1-pr<closestPublic){closestPublic=1-pr;save('closest-public-pass');}if(a&&1-ar<closestAuthority){closestAuthority=1-ar;save('closest-authoritative-pass');}
      if(a&&!p&&!snapshots['first-latent-pass-public-fail'])save('first-latent-pass-public-fail');
      const old=row.trace?.[o.step];if(old){if(p&&!old.literalForceGate&&!snapshots['first-public-gain'])save('first-public-gain');if(!p&&old.literalForceGate&&!snapshots['first-public-loss'])save('first-public-loss');}
    }
    if(measured&&projected){
      for(const [kind,m,metric]of [['authoritative',measured,o.authoritative.metric],['public',projected,o.metric]]){
        if(m.errors.continuous.phaseObservable){phase[kind]=phase[kind]===null?m.actualPhase:phase[kind]+Math.atan2(Math.sin(m.actualPhase-previousPhase[kind]),Math.cos(m.actualPhase-previousPhase[kind]));previousPhase[kind]=m.actualPhase;}else phaseObservable[kind]=false;
        const extended={...m,time:o.time,step:o.step,h:o.h,omega:context.omega};updateMaximum(maxima[kind],extended,metric,row.steps,phase[kind]);
      }
    }
    trace.push({step:o.step,time:o.time,h:o.h,targetValid:o.targetValid,elasticEnergy:o.elasticEnergy,inertiaEnergy:o.inertiaEnergy,rawImplicitEnergy:o.rawImplicitEnergy,authoritativeElasticEnergy:o.authoritative.elasticEnergy,authoritativeInertiaEnergy:o.authoritative.inertiaEnergy,authoritativeRawImplicitEnergy:o.authoritative.rawImplicitEnergy??o.authoritative.incrementalEnergy,residualInfinity:o.residualInfinity,forceTolerance:o.forceTolerance,literalForceGate:o.literalForceGate,
      authoritativeResidualInfinity:o.authoritative.residualInfinity,authoritativeConverged:o.authoritative.converged,rawSHA256:clone(o.rawSHA256),stateSHA256:clone(o.stateSHA256),
      validation:{valid:validation.valid,converged:validation.converged,publicConverged:validation.publicConverged,authoritativeConverged:validation.authoritativeConverged,boundaryCertified:validation.boundaryCertified,actualGradientChecked:validation.actualGradientChecked,liveWorldChecked:validation.liveWorldChecked,losslessBindingsVerified:validation.losslessBindingsVerified,forceBindingsVerified:validation.forceBindingsVerified,errors:clone(validation.errors)},
      authoritativeMetrics:measured?metricSummary(measured):null,publicMetrics:projected?metricSummary(projected):null,metricsError,unwrappedAuthoritativePhase:phase.authoritative,unwrappedPublicPhase:phase.public,solver:clone(o.solver),execution:clone(o.execution)});
    if(restoreContinuation&&o.step===row.steps-1&&!o.initial&&validation.valid)checkpoint=w.snapshot();
    previous=o;last=record;
  }});}finally{observer?.detach();}
  snapshots.final=last;
  const continuation={requested:restoreContinuation,checkpointStep:row.steps-1,attemptedPublicCalls:0,replayedPublicCalls:0,declaredNewtonBudget:row.budget,extraControlNotJudgedTrajectory:true,pass:false,error:null};
  if(restoreContinuation&&checkpoint&&runtime.completedSteps===row.steps&&runtime.status==='completed'){
    try{const end=w.snapshot();w.restore(checkpoint);continuation.attemptedPublicCalls=1;const returned=w.step(w.dt);continuation.replayedPublicCalls=1;assert.equal(returned,1);assert.deepEqual(w.snapshot(),end);continuation.pass=true;}
    catch(cause){continuation.error={name:cause.name,message:cause.message};continuation.failureState={...encodeStateModalVectors({u:w._u,us:w._us,ut:w._ut,x:w.x,xs:w.xs,xt:w.xt,v:w.v}),time:w.time,framesRun:w.framesRun,substepsRun:w.substepsRun,targetValid:w._referenceTargetValid,stepActive:w._referenceStepActive,newtonActive:w._referenceNewtonActive,scope:'raw internal failure buffers; no completed-target certificate'};}
  }
  const clockPass=maxima.authoritative.clockRelative<=64*Number.EPSILON*Math.max(1,row.steps)&&maxima.public.clockRelative<=64*Number.EPSILON*Math.max(1,row.steps);
  const measurement=clockPass&&runtime.status==='completed'&&allValid&&runtime.gates.measurementValid&&runtime.gates.noSleep&&runtime.gates.completeRequestedSteps&&runtime.gates.exactActualSubstepCounters;
  const physicalAgreement=kind=>({discrete:measurement&&maxima[kind].discreteDisplacement<=.001&&maxima[kind].discreteVelocity<=.001&&maxima[kind].discreteEnergy<=.005,
    continuous:measurement&&phaseObservable[kind]&&maxima[kind].phaseCycles<=.01&&maxima[kind].continuousDisplacement<=.01&&maxima[kind].continuousVelocity<=.01&&maxima[kind].continuousEnergy<=.05});
  const linear=instrument&&observer.counts.missing===0&&observer.counts.callbackErrors===0&&observer.counts.begins===row.steps*row.budget&&observer.counts.finishes===row.steps*row.budget&&linearTrace.length===row.steps*row.budget;
  const publicAll=measurement&&publicFailed===0,authorityAll=measurement&&authorityFailed===0;
  return {level:row.level,budget:row.budget,seed:row.seed,amplitude:row.amplitude,substeps:row.substeps,steps:row.steps,h:w.dt,options:clone(context.options),
    fixedForceScale:context.forceScale,forceTolerance:context.forceTolerance,modalMass:context.modalMass,oracleModalMass:reference.mode.modalMass,modalMassRelativeDifference:massDifference,
    scales:{...scales,worldPhi:undefined},initialReference,publicInitialReference:publicReference,referenceCoefficients:clone(context.referenceCoefficients),referenceWords:encodeStateModalVectors({reference:context.referenceWords}),
    runtime:{...runtime,observations:undefined,initial:undefined,final:undefined,checkpoints:undefined},trace,history,snapshots,maxima,phaseObservable,
    failedSteps:publicFailed,authoritativeFailedSteps:authorityFailed,firstFailedStep:firstPublicFailure,firstAuthoritativeFailedStep:firstAuthorityFailure,
    poseHistorySHA256:sha(JSON.stringify(history.map(s=>s.stateSHA256))),continuation,
    solveObservation:{enabled:instrument,counts:observer?clone(observer.counts):null,callbackErrors:clone(observer?.callbackErrors??[]),trace:linearTrace,snapshots:linearSnapshots,
      scope:'all actual Newton decision scalars; selected full copied endpoints only; observer retain:none and streaming copied synchronous callback; no real-Armijo certification of unsampled events'},
    snapshotPolicy:'every step retains all current native arrays,all state+force LE/SHA and certified public+authority force tuples;17 horizon snapshots plus initial/final/first/worst/closest passes/changed public outcomes; selected Newton full records; no hidden truncation',
    gates:{measurementValid:measurement,clockAccumulation:clockPass,literalForceEverySubstep:publicAll,authoritativeForceEverySubstep:authorityAll,perNewtonLinearDiagnostics:instrument?linear:'not measured',boundaryRestoreContinuation:restoreContinuation?continuation.pass:'not measured',
      physicalCSTAgreement:{authoritative:physicalAgreement('authoritative'),public:physicalAgreement('public')},selectedNativeCIntegratorIsolation:'not measured',amplitudeIsolation:'not measured',timeAccuracyAcceptance:false},
    classification:!measurement?'measurement-invalid':!publicAll?'public-incremental-force-nonconvergence':!authorityAll?'authoritative-incremental-force-nonconvergence':'force-gates-pass-time-acceptance-open'};
}

function minimalState(h){const get=key=>decode(h.stateFloat64LE[key],h.stateSHA256[key]);return {x:get('x'),v:get('v'),authoritative:{u:get('u'),v:get('v')}};}
export function stateModalPairedControls(rows,config){
  const budgets=[],levels=[];
  for(const a of rows)for(const b of rows){
    const budget=a.level===b.level&&a.seed===b.seed&&((a.budget===1&&b.budget===4)||(a.budget===4&&b.budget===16));
    const level=b.level===2*a.level&&a.budget===b.budget&&a.seed===b.seed;
    if(!budget&&!level)continue;
    let authoritative=0,projected=0,count=0,maxClock=0;const errors=[];
    for(let k=0;k<a.history.length;k++){
      const l=level?k*2:k,pa=a.history[k],pb=b.history[l];if(!pb)continue;
      assert.equal(k*a.h,l*b.h,'paired states must have identical nominal physical time');
      try{const sa=minimalState(pa),sb=minimalState(pb);authoritative=Math.max(authoritative,compareStateModalStates(config,sa,sb).state);projected=Math.max(projected,compareModalStates(config,sa,sb).state);maxClock=Math.max(maxClock,Math.abs(pa.time-pb.time));count++;}catch(cause){errors.push({coarseStep:k,refinedStep:l,name:cause.name,message:cause.message});}
    }
    const result={seed:a.seed,fromLevel:a.level,toLevel:b.level,fromBudget:a.budget,toBudget:b.budget,matchedStates:count,
      completeCommonStates:errors.length===0&&count===a.steps+1,errors,maximumAuthoritativeStateChange:authoritative,maximumPublicStateChange:projected,maximumActualClockDifference:maxClock,
      bothPublicForceGates:a.gates.literalForceEverySubstep&&b.gates.literalForceEverySubstep,bothAuthorityForceGates:a.gates.authoritativeForceEverySubstep&&b.gates.authoritativeForceEverySubstep,
      scope:budget?'every matched native step, not17sample bound':'common coarse index k and refined index2k; exact nominal h identity, actual clock drift retained; no nearest-time alignment'};
    if(budget){result.authoritativeIsolationPass=result.completeCommonStates&&result.bothAuthorityForceGates&&authoritative<=1e-4;result.publicIsolationPass=result.completeCommonStates&&result.bothPublicForceGates&&projected<=1e-4;budgets.push(result);}else levels.push(result);
  }
  return {budget:budgets,commonTimeLevels:levels,amplitude:{measured:false,reason:'only declared A=.004; no finite-strain/amplitude isolation'},scope:'full-state diagnostics cannot waive either force gate or establish selected-native-C/time/material/booklet acceptance'};
}

export function runStateModalAudit({instrument=true,membraneCurvature='gauss-newton',pcgStop,...unknown}={}){
  assert.equal(Object.keys(unknown).length,0,'unknown state audit options; no dirty/full/window override');assert.equal(typeof instrument,'boolean');
  assert.ok(['gauss-newton','exact-hessian'].includes(membraneCurvature),'named membraneCurvature required');const exact=membraneCurvature==='exact-hessian';
  assert.ok(pcgStop===undefined||Object.hasOwn(STATE_MODAL_PCG_STOPS,pcgStop),'unknown named PCG stop');
  const before=stateModalSource();assert.equal(before.status,'','clean source required; no accepted dirty override');
  const baseline=loadStateModalPlan(),patch=makePatch({...baseline.geometry,membraneModel:'orthotropic-stvk',membraneNu12:.293});
  assert.deepEqual(patch.material,baseline.material);assert.equal(patch.fixtureSHA256,baseline.fixtureSHA256);assert.equal(patch.meshSHA256,baseline.meshSHA256);
  const rows=[];for(const row of baseline.rows){const result=runStateModalTrajectory(patch,baseline.reference,row,{instrument,membraneCurvature,...(pcgStop===undefined?{}:{pcgStop})});
    equalWords(decode(result.referenceWords.stateFloat64LE.reference,result.referenceWords.stateSHA256.reference),baseline.referenceWords,'selected reference words changed');rows.push(result);
    console.error('state-modal-progress: level='+row.level+' I='+row.budget+' previous='+row.seed+' public='+result.failedSteps+'/'+row.steps+' authoritative='+result.authoritativeFailedSteps+'/'+row.steps);
  }
  const config={vertices:patch.vertices,mass:rows[0].runtime.massProof.native,phi:baseline.reference.mode.phi,omega:baseline.reference.mode.omega,amplitude:.004};
  const paired=stateModalPairedControls(rows,config);assertStateModalSource(before);
  return {schema:'pliego-membrane-state-modal-audit/1',recordedAt:new Date().toISOString(),source:{...before,status:undefined,dirty:false},
    runtime:{node:process.version,arch:process.arch,platform:process.platform},protocol:{...STATE_MODAL_PROTOCOL,instrument,stateCoordinates:'reference-displacement',membraneReference:'uv-displacement',membraneArithmetic:'double-double',lineSearchArithmetic:'membrane-inertia-increment',limits:STATE_MODAL_LIMITS,
      ...(exact?{membraneCurvature,membraneCurvatureIdentity:{...EXACT_CURVATURE_IDENTITY},membraneCurvatureScope:'named exact-curvature candidate; Gauss–Newton baseline is the same protocol with this field omitted'}:{}),
      ...(pcgStop===undefined?{}:{pcgStop:{name:pcgStop,...STATE_MODAL_PCG_STOPS[pcgStop]}}),
      initialization:'actual old native x/v converted once; constructor zero buffers retained; extra unstepped context explicitly recorded; no targets supplied by oracle',
      referenceMeaning:'immutable independent exact-UV physical CST continuous/BE spectrum with real M/h²; not exact selected-law/native-C propagation',
      perNewtonLinearDiagnostics:instrument?'transparent copied streaming callback; all changing decision scalars and selected full endpoints':'not measured',
      extraControls:'one separately labelled final-substep snapshot continuation per completed trajectory; these calls are not judged trajectory steps',
      acceptance:'both original force gates and all failures retained; no complete time/selected-integrator/material/booklet/device or8ms acceptance'},
    executionTotals:{judgedRequestedPublicCalls:7110,judgedCompletedPublicCalls:rows.reduce((s,r)=>s+r.runtime.completedSteps,0),retainedInitialAndJudgedStates:rows.reduce((s,r)=>s+r.history.length,0),judgedDeclaredNewtonIterations:49770,restoreControlAttemptedPublicCalls:rows.reduce((s,r)=>s+r.continuation.attemptedPublicCalls,0),restoreControlCompletedPublicCalls:rows.reduce((s,r)=>s+r.continuation.replayedPublicCalls,0),restoreControlDeclaredNewtonIterations:rows.reduce((s,r)=>s+r.continuation.attemptedPublicCalls*r.budget,0),scope:'judged matrix and extra replay calls separate; declared iterations are requested budgets, not inferred execution counts after exceptions'},
    referenceCapture:baseline.provenance,oracleSelfTest:{...baseline.oracleSelfTest,origin:'immutable archived unchanged-source reference; not rerun by candidate'},
    results:[{geometry:baseline.geometry,vertices:patch.vertices,triangles:patch.triangles,material:patch.material,mesh:patch.info,fixtureSHA256:patch.fixtureSHA256,meshSHA256:patch.meshSHA256,
      reference:baseline.reference,referenceCoefficients:baseline.referenceCoefficients,scalarResponseProof:baseline.scalarResponseProof,plan:baseline.plan,trajectories:rows,pairedControls:paired}],
    gates:{sourceClean:true,completeDeclaredMatrix:rows.length===24,oracleValid:baseline.reference.valid===true,
      completeRequestedPoststeps:rows.reduce((s,r)=>s+r.runtime.completedSteps,0)===7110,
      measurementValid:rows.every(r=>r.gates.measurementValid),literalForceEverySubstep:rows.every(r=>r.gates.literalForceEverySubstep),authoritativeForceEverySubstep:rows.every(r=>r.gates.authoritativeForceEverySubstep),
      perNewtonLinearDiagnostics:instrument?rows.every(r=>r.gates.perNewtonLinearDiagnostics===true):'not measured',boundaryRestoreContinuation:rows.every(r=>r.gates.boundaryRestoreContinuation===true),
      actualTimeAccuracyAcceptance:false,selectedNativeCIntegratorIsolation:'not measured',physicalStockCalibration:'not measured',newModelBooklet:'not measured',interactionPerformance:'not measured'},
    scope:'one fixed24matrix; every raw step retained, each control run separate; source repeat/plain parity and baseline migration require dedicated comparison; truth samples cannot certify all49770 Newton events'};
}

export function runStateModalAbsoluteBaseline(){
  const before=stateModalSource();assert.equal(before.status,'','clean source required; no accepted dirty override');
  const legacy=runModalAudit({stage:'diagnostic',matrix:'smoke',instrument:true,lineSearchArithmetic:'membrane-inertia-increment',membraneArithmetic:'double-double',membraneReference:'uv-displacement'});
  assertStateModalSource(before);
  return {schema:'pliego-membrane-state-modal-baseline/1',recordedAt:new Date().toISOString(),source:{...before,status:undefined,dirty:false},legacy,
    scope:'separate current-source absolute-UV24matrix; historical report embedded unchanged; complete archived d739 replay requires baseline-migration comparison'};
}
export function writeStateModalReport(output,report){const sink=reserveStateModalOutput(output);try{sink.write(report);}finally{sink.close();}}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),baseline=args.includes('--baseline-absolute'),plain=args.includes('--no-solve-observer'),oi=args.indexOf('--out'),ci=args.indexOf('--membrane-curvature'),si=args.indexOf('--pcg-stop');
  assert.ok(oi>=0&&args[oi+1]&&!args[oi+1].startsWith('--'),'--out fresh durable path required');
  assert.ok(ci<0||args[ci+1]==='exact-hessian','--membrane-curvature names only the exact-hessian candidate; omission is Gauss–Newton');
  assert.ok(si<0||Object.hasOwn(STATE_MODAL_PCG_STOPS,args[si+1]),'--pcg-stop names one declared candidate stop; omission is the historical relative rule');
  assert.ok(args.every((a,i)=>['--out','--baseline-absolute','--no-solve-observer','--membrane-curvature','--pcg-stop'].includes(a)||i===oi+1||(ci>=0&&i===ci+1)||(si>=0&&i===si+1)),'unknown option; fixed24scope only');
  for(const flag of ['--out','--baseline-absolute','--no-solve-observer','--membrane-curvature','--pcg-stop'])assert.ok(args.filter(a=>a===flag).length<=1,'duplicate option: '+flag);
  assert.ok(!baseline||si<0,'absolute baseline has no PCG stop candidate');
  assert.ok(!baseline||!plain,'absolute baseline must retain original instrumentation protocol');assert.ok(!baseline||ci<0,'absolute baseline has no curvature candidate');
  const membraneCurvature=ci>=0?'exact-hessian':'gauss-newton';
  const pcgStop=si>=0?{pcgStop:args[si+1]}:{};
  const sink=reserveStateModalOutput(args[oi+1]);try{const report=baseline?runStateModalAbsoluteBaseline():runStateModalAudit({instrument:!plain,membraneCurvature,...pcgStop});sink.write(report);}finally{sink.close();}
  console.error('state-modal-audit: '+(baseline?'current absolute baseline':'state '+membraneCurvature)+' fixed24; raw failed outcomes retained; untimed research');
}
