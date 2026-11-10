// Actual World transient diagnosis, independent free-CST modal reference.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,mkdtempSync,openSync,closeSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {makePatch} from './membrane-patch.mjs';
import {createModalWorld,runModalContext} from './membrane-modal-runtime.mjs';
import {validateObservation} from './membrane-modal-validation.mjs';
import {attachModalSolveObserver} from './membrane-modal-solve-observer.mjs';
import {modalScales,modalTruth,measureModalFields,spectralInitialReference,compareModalStates,compareAmplitudeNormalizedStates} from './membrane-modal-metrics.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url)),bench=fileURLToPath(new URL('./',import.meta.url));
const PYTHON=process.env.PLIEGO_AUDIT_PYTHON||'python3',sha=v=>createHash('sha256').update(v).digest('hex');
const PROTOCOLS={
  diagnostic:{z0:.08,levels:[1,2,4,8],amplitudes:[.004],budgets:[1,4,16],seeds:[false,true],scope:'one small-amplitude numerical diagnosis; no finite-strain or continuous-time acceptance'},
  window:{z0:.04,levels:[1,2,4,8,16],amplitudes:[.08,.04,.02,.01],budgets:[16,32],seeds:[false,true],scope:'declared amplitude/time/solve window; unresolved literal force gates remain failures'},
};
const LIMITS={mass:1e-12,oracleResponse:1e-10,discreteField:.001,discreteVelocity:.001,discreteEnergy:.005,
  continuousField:.01,continuousVelocity:.01,continuousEnergy:.05,phaseCycles:.01,solveIsolation:1e-4,amplitudeIsolation:.001};
function source(){
  const engine=[],visit=(dir,prefix='')=>{for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    if(e.isDirectory())visit(join(dir,e.name),prefix+e.name+'/');else if(e.name.endsWith('.js'))engine.push({path:prefix+e.name,sha256:sha(readFileSync(join(dir,e.name)))});
  }};visit(join(root,'packages/engine/src'));
  const tools=readdirSync(bench).filter(p=>p.startsWith('membrane-modal-')||p.startsWith('test_membrane_modal_')&&p.endsWith('.py')||['compare-membrane-modal-audit.mjs','membrane-increment-precision.py','membrane-increment-probes.mjs','membrane-patch.mjs','plane-stress-reference.py','test_plane_stress_reference.py','plane-stress-precision.py','test_plane_stress_precision.py'].includes(p)).sort();
  const tests=join(root,'packages/engine/test');
  return {git:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),status:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),
    engineFiles:engine,tools:tools.map(path=>({path,sha256:sha(readFileSync(join(bench,path)))})),
    tests:readdirSync(tests).filter(p=>p.endsWith('.test.js')).sort().map(path=>({path,sha256:sha(readFileSync(join(tests,path)))})),
    fixtureBuilderSHA256:sha(readFileSync(join(tests,'helpers/docbuilder.js')))};
}
function oracle(args,input){
  const dir=input===undefined?null:mkdtempSync(join(tmpdir(),'pliego-modal-'));let fd;
  try{if(dir){const p=join(dir,'input.json');writeFileSync(p,JSON.stringify(input));fd=openSync(p,'r');}
    return execFileSync(PYTHON,[join(bench,'membrane-modal-reference.py'),...args],{stdio:[fd===undefined?'ignore':fd,'pipe','pipe'],encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  }finally{if(fd!==undefined)closeSync(fd);if(dir)rmSync(dir,{recursive:true,force:true});}
}
const coreReference=r=>{const copy=structuredClone(r);delete copy.responses;delete copy.inputSHA256;return copy;};
function encodeStateLE(observation){
  return Object.fromEntries(['x','xs','xt','v'].map(key=>{
    const bytes=Buffer.alloc(8*observation[key].length);observation[key].forEach((v,i)=>bytes.writeDoubleLE(v,8*i));return [key,bytes.toString('base64')];
  }));
}
function responseProof(reference){
  let maximum=0,values=0;
  for(const response of reference.responses){
    const s={omega:reference.mode.omega,amplitude:response.amplitude,modalMass:reference.mode.modalMass};
    for(const sample of response.samples){
      const truth=modalTruth({...s,h:response.h,step:sample.step,time:sample.time});
      for(const kind of ['continuous','backwardEuler'])for(const [key,scale]of [['coordinate',s.amplitude],['velocity',s.amplitude*s.omega],['energy',.5*s.modalMass*(s.amplitude*s.omega)**2]]){
        maximum=Math.max(maximum,Math.abs(truth[kind][key]-sample[kind][key])/scale);values++;
      }
    }
  }
  return {maximumNormalizedDifference:maximum,valuesChecked:values,threshold:LIMITS.oracleResponse,pass:values>0&&maximum<=LIMITS.oracleResponse};
}
function trajectory(patch,reference,{amplitude,substeps,steps,budget,seed,level,instrument=true,lineSearchArithmetic}){
  const context=createModalWorld(patch,{phi:reference.mode.phi,omega:reference.mode.omega,amplitude,substeps,newtonIterations:budget,previousPoseStart:seed,...(lineSearchArithmetic===undefined?{}:{lineSearchArithmetic})});
  const config={vertices:patch.vertices,mass:context.masses,phi:context.phi,omega:context.omega,amplitude};
  const scales=modalScales(config),trace=[],snapshots={},poseHistory=createHash('sha256');
  const oracleModalMassRelativeDifference=Math.abs(scales.modalMass-reference.mode.modalMass)/reference.mode.modalMass;
  assert.ok(oracleModalMassRelativeDifference<=LIMITS.mass,'independent modal normalization must match native mass before trajectory judgment');
  let previous=null,initialReference=null,initial=null,last=null,phase=null,previousPhase=null,allValid=true,allForce=true,firstFailure=null,worstRatio=-1;
  const maxima={discreteDisplacement:0,discreteVelocity:0,discreteState:0,discreteEnergy:0,continuousDisplacement:0,continuousVelocity:0,continuousState:0,continuousEnergy:0,
    idealDiscreteState:0,idealContinuousState:0,phaseCycles:0,displacementLeakage:0,velocityLeakage:0,materialStrain:0,clockRelative:0};
  let failedSteps=0,phaseObservable=true,forceMaximum=0;
  const checkpointSteps=new Set(Array.from({length:17},(_,i)=>Math.round(steps*i/16)));
  const linearTrace=[],linearSnapshots={};
  let worstLinear=-1,worstRounded=-1;
  const solveObserver=instrument?attachModalSolveObserver(context,{retain:'none',onIteration:record=>{
    const event={iteration:record.iteration,substepsRun:record.substepsRun,source:record.source,valid:record.valid,missing:record.missing,
      nominalRelativeResidual:record.nominal?.relativeResidual??null,nominalResidualInfinity:record.nominal?.residualInfinity??null,
      roundedRelativeResidual:record.rounded?.relativeResidual??null,roundedResidualInfinity:record.rounded?.residualInfinity??null,
      roundingDifferenceInfinity:record.roundingDifferenceInfinity??null,pcgIterations:record.pcgIterations,acceptedAlpha:record.acceptedAlpha,
      lineSearch:record.lineSearch?{accepted:record.lineSearch.accepted,rejected:record.lineSearch.rejected,acceptedBacktracks:record.lineSearch.acceptedBacktracks}:null};
    if(record.increment){
      event.increment=structuredClone(record.increment);event.lineSearch=structuredClone(record.lineSearch);
      if(record.lineSearch?.accepted&&!linearSnapshots.firstIncrementAccepted)linearSnapshots.firstIncrementAccepted=record;
      if(record.lineSearch?.stationaryNoop&&!linearSnapshots.firstStationaryNoop)linearSnapshots.firstStationaryNoop=record;
      if(record.lineSearch?.precisionLimited&&!linearSnapshots.firstPrecisionLimited)linearSnapshots.firstPrecisionLimited=record;
    }
    linearTrace.push(event);
    if(!record.valid&&!linearSnapshots.firstMissing)linearSnapshots.firstMissing=record;
    if(record.nominal?.relativeResidual>worstLinear){worstLinear=record.nominal.relativeResidual;linearSnapshots.worstNominal=record;}
    if(record.rounded?.residualInfinity>worstRounded){worstRounded=record.rounded.residualInfinity;linearSnapshots.worstRounded=record;}
    if(record.lineSearch?.rejected&&!linearSnapshots.firstRejected)linearSnapshots.firstRejected=record;
  }}):null;
  let runtime;
  try{runtime=runModalContext(context,{steps,retain:'initial-final',onObservation:observation=>{
    const validation=validateObservation(context,observation,{world:context.world,previous,referenceMass:reference.mass});
    allValid&&=validation.valid;
    let measured;
    try{
      if(observation.initial){initial=observation;initialReference=spectralInitialReference({...config,spectrum:reference.spectrum},observation);}
      assert.ok(observation.metric&&Number.isFinite(observation.metric.maximumStretch)&&Number.isFinite(observation.metric.minimumStretch),'finite actual metric required for accuracy reductions');
      measured=measureModalFields(config,observation,initialReference);
    }catch(cause){
      allValid=false;allForce=false;
      const failure={observation,validation,metricsError:{name:cause.name,message:cause.message},stateFloat64LE:encodeStateLE(observation)};
      if(!snapshots['first-invalid-measurement'])snapshots['first-invalid-measurement']=failure;
      if(checkpointSteps.has(observation.step))snapshots['checkpoint-'+observation.step]=failure;
      if(!observation.initial){failedSteps++;if(firstFailure===null){firstFailure=observation.step;snapshots['first-force-failure']=failure;}}
      poseHistory.update(JSON.stringify(observation.rawSHA256));trace.push({step:observation.step,time:observation.time,rawSHA256:observation.rawSHA256,
        residualInfinity:observation.residualInfinity,forceTolerance:observation.forceTolerance,literalForceGate:observation.literalForceGate,
        validation:{valid:false,converged:false,errors:[...validation.errors,cause.message]},metricsError:failure.metricsError,solver:observation.solver});
      previous=observation;last=observation;return;
    }
    const rounded=measured.roundedInitial;
    const save=role=>{snapshots[role]={observation,validation,metrics:measured,stateFloat64LE:encodeStateLE(observation)};};
    if(checkpointSteps.has(observation.step))save('checkpoint-'+observation.step);
    if(observation.initial)save('initial');
    else{
      const passed=validation.valid&&validation.converged&&observation.literalForceGate===true;allForce&&=passed;
      if(!passed){failedSteps++;if(firstFailure===null){firstFailure=observation.step;save('first-force-failure');}}
      const ratio=observation.residualInfinity/observation.forceTolerance;
      if(ratio>worstRatio){worstRatio=ratio;save('worst-force');}forceMaximum=Math.max(forceMaximum,observation.residualInfinity);
    }
    if(!validation.valid&&!snapshots['first-invalid-measurement'])save('first-invalid-measurement');
    for(const [prefix,key]of [['discrete','backwardEuler'],['continuous','continuous']]){
      for(const [name,field]of [['Displacement','displacement'],['Velocity','velocity'],['State','state'],['Energy','energy']]){
        const value=rounded[key][field],label=prefix+name;
        if(value>maxima[label]){maxima[label]=value;if(name==='State')save('worst-'+prefix+'-state');}
      }
    }
    maxima.idealDiscreteState=Math.max(maxima.idealDiscreteState,measured.errors.backwardEuler.state);
    maxima.idealContinuousState=Math.max(maxima.idealContinuousState,measured.errors.continuous.state);
    maxima.displacementLeakage=Math.max(maxima.displacementLeakage,measured.displacementLeakage);
    maxima.velocityLeakage=Math.max(maxima.velocityLeakage,measured.velocityLeakage);
    maxima.materialStrain=Math.max(maxima.materialStrain,Math.abs(observation.metric.maximumStretch-1),Math.abs(observation.metric.minimumStretch-1));
    if(measured.errors.continuous.phaseObservable){
      phase=phase===null?measured.actualPhase:phase+Math.atan2(Math.sin(measured.actualPhase-previousPhase),Math.cos(measured.actualPhase-previousPhase));
      previousPhase=measured.actualPhase;maxima.phaseCycles=Math.max(maxima.phaseCycles,Math.abs(phase-reference.mode.omega*observation.time)/(2*Math.PI));
    }else phaseObservable=false;
    const expectedTime=observation.step*observation.h,clockScale=Math.max(steps*observation.h,observation.h);
    maxima.clockRelative=Math.max(maxima.clockRelative,Math.abs(observation.time-expectedTime)/clockScale);
    poseHistory.update(JSON.stringify(observation.rawSHA256));
    trace.push({step:observation.step,time:observation.time,rawSHA256:observation.rawSHA256,
      residualInfinity:observation.residualInfinity,forceTolerance:observation.forceTolerance,literalForceGate:observation.literalForceGate,
      validation:{valid:validation.valid,converged:validation.converged,errors:validation.errors},
      idealErrors:measured.errors,roundedInitialErrors:{continuous:rounded.continuous,backwardEuler:rounded.backwardEuler},
      coordinate:measured.coordinate,modalVelocity:measured.modalVelocity,unwrappedPhase:phase,mechanicalEnergy:measured.energy,
      metric:{minimumStretch:observation.metric.minimumStretch,maximumStretch:observation.metric.maximumStretch,
        minimumAreaRatio:observation.metric.minimumAreaRatio,maximumAreaRatio:observation.metric.maximumAreaRatio},asleep:observation.asleep,
      solver:{factorizations:observation.solver.factorizations,lastPublicPcgIterations:observation.solver.lastPublicPcgIterations,
        lineSearchBacktracks:observation.solver.lineSearchBacktracks,lineSearchRejected:observation.solver.lineSearchRejected,
        ...(observation.solver.lineSearchArithmetic?{lineSearchArithmetic:observation.solver.lineSearchArithmetic,increment:observation.solver.increment}:{})}});
    previous=observation;last=observation;
  }});}finally{solveObserver?.detach();}
  snapshots.final={observation:last,stateFloat64LE:encodeStateLE(last)};
  const clockPass=maxima.clockRelative<=64*Number.EPSILON*Math.max(1,steps);
  const measurement=allValid&&runtime.gates.measurementValid&&runtime.gates.noSleep&&runtime.gates.completeRequestedSteps&&clockPass;
  const discrete=measurement&&maxima.discreteDisplacement<=LIMITS.discreteField&&maxima.discreteVelocity<=LIMITS.discreteVelocity&&maxima.discreteEnergy<=LIMITS.discreteEnergy;
  const continuous=measurement&&maxima.continuousDisplacement<=LIMITS.continuousField&&maxima.continuousVelocity<=LIMITS.continuousVelocity&&maxima.continuousEnergy<=LIMITS.continuousEnergy&&phaseObservable&&maxima.phaseCycles<=LIMITS.phaseCycles;
  const linearDiagnostics=instrument&&solveObserver.counts.missing===0&&solveObserver.counts.callbackErrors===0&&solveObserver.counts.begins===steps*budget&&solveObserver.counts.finishes===steps*budget&&linearTrace.length===steps*budget;
  return {level,budget,seed,amplitude,substeps,steps,h:context.world.dt,z:context.omega*context.world.dt,options:context.options,
    ...(lineSearchArithmetic===undefined?{}:{lineSearchArithmetic}),
    fixedForceScale:context.forceScale,forceTolerance:context.forceTolerance,modalMass:context.modalMass,
    oracleModalMass:reference.mode.modalMass,modalMassRelativeDifference:Math.abs(context.modalMass-reference.mode.modalMass)/reference.mode.modalMass,oracleModalMassRelativeDifference,
    runtime:{...runtime,observations:undefined,initial:undefined,final:undefined},initialReference,scales:{...scales,worldPhi:undefined},
    snapshots,trace,poseHistorySHA256:poseHistory.digest('hex'),observedStates:trace.length,firstFailedStep:firstFailure,failedSteps,worstResidualRatio:worstRatio,forceMaximum,maxima,
    solveObservation:{enabled:instrument,counts:solveObserver?{...solveObserver.counts}:null,callbackErrors:solveObserver?.callbackErrors??[],trace:linearTrace,snapshots:linearSnapshots,
      invariantRecordMetadata:'lineSearch rejection trial count is not exposed; source/domain/equation definitions are fixed by the observer and retained in full worst/first event snapshots; all per-event changing quantities above are retained',
      scope:'transparent wrappers around actual EnergySearch originals; nominal packed solution and actual rounded direction independently checked with actual pre-search GN operator; no repeated solver or changed physics'},
    snapshotPolicy:'all 17 predeclared horizon checkpoints plus initial/final, first invalid, first/worst force failure, and worst discrete/continuous full-state errors; every step has scalar metrics, complete force outcome and raw pose/velocity/predictor hashes; snapshots include LEbinary64 base64 preserving signed zeros lost in ordinary JSON numbers',
    gates:{measurementValid:measurement,literalForceEverySubstep:allForce,phaseObservable,discreteAgreement:discrete,continuousAgreement:continuous,
      solveAndDiscrete:measurement&&allForce&&discrete,solveAndContinuous:measurement&&allForce&&continuous,
      finiteStrainIsolation:'requires paired amplitudes',perNewtonLinearDiagnostics:instrument?linearDiagnostics:'not measured',timeAccuracyAcceptance:false},
    classification:!measurement?'measurement-invalid':!allForce?'incremental-force-nonconvergence':!discrete?'discrete-law-mismatch':!continuous?'continuous-time-error':'trajectory-gates-pass-acceptance-still-requires-isolation'};
}
function pairedControls(rows,patch,reference){
  const budget=[],amplitude=[];
  for(const a of rows)for(const b of rows){
    if(a.level!==b.level||a.seed!==b.seed)continue;
    const pointsA=a.snapshots,pointsB=b.snapshots;
    if(a.amplitude===b.amplitude&&a.budget===4&&b.budget===16||a.amplitude===b.amplitude&&a.budget===16&&b.budget===32){
      let maximum=0,count=0;
      for(const key of Object.keys(pointsA).filter(k=>k.startsWith('checkpoint-'))){
        if(!pointsB[key])continue;count++;
        const value=compareModalStates({vertices:patch.vertices,mass:reference.mass,phi:reference.mode.phi,omega:reference.mode.omega,amplitude:a.amplitude},pointsA[key].observation,pointsB[key].observation);
        maximum=Math.max(maximum,value.state);
      }
      budget.push({level:a.level,seed:a.seed,amplitude:a.amplitude,from:a.budget,to:b.budget,checkpoints:count,maximumSampledStateChange:maximum,
        scope:'17 fixed horizon checkpoint samples only; not an all-step state-change bound',
        literalForceBoth:a.gates.literalForceEverySubstep&&b.gates.literalForceEverySubstep,
        pass:a.gates.measurementValid&&b.gates.measurementValid&&a.gates.literalForceEverySubstep&&b.gates.literalForceEverySubstep&&count===17&&maximum<=LIMITS.solveIsolation});
    }
    if(a.budget===b.budget&&a.amplitude===2*b.amplitude){
      let maximum=0,count=0;
      for(const key of Object.keys(pointsA).filter(k=>k.startsWith('checkpoint-'))){
        if(!pointsB[key])continue;count++;
        const ua=pointsA[key].observation,ub=pointsB[key].observation;
        maximum=Math.max(maximum,compareAmplitudeNormalizedStates({vertices:patch.vertices,mass:reference.mass,phi:reference.mode.phi,omega:reference.mode.omega,amplitude:1},ua,ub,a.amplitude,b.amplitude).state);
      }
      amplitude.push({level:a.level,seed:a.seed,budget:a.budget,from:a.amplitude,to:b.amplitude,checkpoints:count,maximumSampledNormalizedStateChange:maximum,
        literalForceBoth:a.gates.literalForceEverySubstep&&b.gates.literalForceEverySubstep,
        pass:a.gates.measurementValid&&b.gates.measurementValid&&a.gates.literalForceEverySubstep&&b.gates.literalForceEverySubstep&&count===17&&maximum<=LIMITS.amplitudeIsolation});
    }
  }
  return {budget,amplitude,scope:'paired checkpoint diagnostics supplement literal force gates; they cannot turn two unconverged trajectories into a solved limit'};
}

export function runModalAudit({allowDirty=false,stage='diagnostic',matrix='smoke',instrument=true,lineSearchArithmetic}={}){
  assert.ok(Object.hasOwn(PROTOCOLS,stage));assert.ok(['smoke','full'].includes(matrix));
  assert.ok(lineSearchArithmetic===undefined||['total-energy','membrane-inertia-increment'].includes(lineSearchArithmetic),'unknown line-search arithmetic');
  const start=source();assert.ok(allowDirty||!start.status,'clean source required; --allow-dirty is development only');
  const selfRaw=oracle(['--self-test']),self=JSON.parse(selfRaw);assert.equal(self.passed,true);assert.ok(self.testsRun>0);
  const p=PROTOCOLS[stage],geometries=matrix==='smoke'?[{cells:2,pattern:'forward',grain:0}]:[2,4].flatMap(cells=>['forward','alternating','perturbed'].flatMap(pattern=>[0,45].map(grain=>({cells,pattern,grain}))));
  const patches=geometries.map(g=>makePatch({...g,membraneModel:'orthotropic-stvk',membraneNu12:.293}));
  const cases=patches.map(patch=>({material:patch.material,arealDensity:patch.world.materials[0].rhoA,angleDegrees:patch.info.grain,vertices:patch.vertices,triangles:patch.triangles}));
  const firstRaw=oracle([],{cases}),first=JSON.parse(firstRaw).cases;
  const plans=first.map(r=>{assert.equal(r.valid,true);const S0=Math.ceil(r.mode.omega/(60*p.z0)),h0=1/(60*S0),N0=Math.ceil(2*Math.PI/(r.mode.omega*h0));
    assert.ok(Number.isSafeInteger(S0)&&S0>0&&N0>0);return {S0,h0,N0,horizon:N0*h0};});
  const requests=cases.map((c,i)=>({...c,responses:p.amplitudes.flatMap(amplitude=>p.levels.map(level=>({amplitude,h:1/(60*plans[i].S0*level),steps:plans[i].N0*level})))}));
  const finalRaw=oracle([],{cases:requests}),references=JSON.parse(finalRaw).cases,results=[];
  for(let i=0;i<patches.length;i++){
    const patch=patches[i],ref=references[i],plan=plans[i];assert.deepEqual(coreReference(ref),coreReference(first[i]));
    assert.equal(ref.vertices,patch.vertices.length);assert.equal(ref.triangles,patch.triangles.length);
    const proof=responseProof(ref);assert.equal(proof.pass,true,'independent scalar reference vs reducer must agree before observing World');
    const rows=[];
    for(const amplitude of p.amplitudes)for(const level of p.levels)for(const budget of p.budgets)for(const seed of p.seeds){
      const row=trajectory(patch,ref,{amplitude,level,budget,seed,substeps:plan.S0*level,steps:plan.N0*level,instrument,lineSearchArithmetic});rows.push(row);
      console.error('membrane-modal-progress: '+patch.info.pattern+' cells='+patch.info.cells+' grain='+patch.info.grain+' A='+amplitude+' level='+level+' I='+budget+' previous='+seed+' '+row.classification+' failedForce='+row.failedSteps+'/'+row.steps);
    }
    const mesh=patch.world.mesh,referenceCoefficients={triangles:Array.from({length:mesh.nT},(_,i)=>Array.from(mesh.tris.subarray(3*i,3*i+3))),
      elements:patch.world.orthotropicMembrane.elements.map(e=>({alpha:Array.from(e.alpha),beta:Array.from(e.beta),Q:Array.from(e.Q),volume:e.volume})),
      scope:'actual immutable runtime coefficients and native cyclic connectivity; independent UV/Q reference remains separate'};
    results.push({geometry:geometries[i],vertices:patch.vertices,triangles:patch.triangles,material:patch.material,mesh:patch.info,fixtureSHA256:patch.fixtureSHA256,meshSHA256:patch.meshSHA256,referenceCoefficients,
      reference:ref,scalarResponseProof:proof,plan,trajectories:rows,pairedControls:pairedControls(rows,patch,ref)});
  }
  assert.deepEqual(source(),start,'source changed during actual-World modal study; discard observations');
  const rows=results.flatMap(r=>r.trajectories),measurement=rows.every(r=>r.gates.measurementValid),force=rows.every(r=>r.gates.literalForceEverySubstep);
  return {schema:'pliego-membrane-modal-audit/0.1',recordedAt:new Date().toISOString(),source:{...start,status:undefined,dirty:!!start.status},
    runtime:{node:process.version,python:execFileSync(PYTHON,['--version'],{encoding:'utf8'}).trim(),arch:process.arch,platform:process.platform,
      byteOrder:new Uint8Array(new Uint16Array([1]).buffer)[0]===1?'LE':'BE'},
    protocol:{stage,matrix,instrument,...p,limits:LIMITS,geometries,...(lineSearchArithmetic===undefined?{}:{lineSearchArithmetic}),initialization:'one actual A*dimensionless independentphi perturbation of native x; zero velocity; no oracle prediction, pins, sleep override or E/t/mass rescaling',
      force:'literal max coordinate abs(gU+M/h²*(x-xt)) <= max(1e-7 microN,1e-10*FIXED initial A*omega²*max_i(nativeMass_i*norm(phi_i))); mass source independently checked, no ULP acceptance allowance',
      truth:'continuous linear mode and exact discrete BE, plus full independent K/M spectral propagation of actual rounded u0; they are distinct truths',
      acceptance:'diagnostic implementation and time/solve/precision separation; no whole time-accuracy acceptance until literal solves, amplitude isolation, all-step budget isolation, first-order trend and full matrix pass',
      perNewtonLinearDiagnostics:instrument?'bench-only proven transparent EnergySearch wrappers observe true nominal and rounded GN equations plus counter-derived alpha':'not exposed by basic public-step observer; explicitly missing'},
    oracleSelfTest:{result:self,outputSHA256:sha(selfRaw)},referenceCapture:{initialInputSHA256:sha(JSON.stringify({cases})),initialOutputSHA256:sha(firstRaw),responseInputSHA256:sha(JSON.stringify({cases:requests})),responseOutputSHA256:sha(finalRaw)},
    results,gates:{sourceClean:!start.status,completeDeclaredMatrix:rows.length===geometries.length*p.amplitudes.length*p.levels.length*p.budgets.length*p.seeds.length,
      oracleValid:references.every(r=>r.valid),measurementValid:measurement,literalForceEverySubstep:force,
      discreteAgreement:rows.every(r=>r.gates.discreteAgreement),continuousAgreement:rows.every(r=>r.gates.continuousAgreement),
      finiteStrainIsolation:stage==='diagnostic'?'not measured by single amplitude':'paired checkpoint diagnostics only; all-step isolation pending',
      perNewtonLinearDiagnostics:instrument?rows.every(r=>r.gates.perNewtonLinearDiagnostics===true):'not measured',
      actualTimeAccuracyAcceptance:false,physicalStockCalibration:'not measured',newModelBooklet:'not measured',interactionPerformance:'not measured'},
    classification:(start.status?'development-only/':'')+(!measurement?'measurement-invalid':!force?'incremental-force-nonconvergence':'diagnostic-complete-time-acceptance-open')};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),oi=args.indexOf('--out'),si=args.indexOf('--stage'),mi=args.indexOf('--matrix'),ai=args.indexOf('--line-search-arithmetic'),path=oi>=0?resolve(args[oi+1]||''):null;
  assert.ok(ai<0||['total-energy','membrane-inertia-increment'].includes(args[ai+1]),'--line-search-arithmetic needs a supported value');
  assert.ok(args.every((a,i)=>['--out','--stage','--matrix','--line-search-arithmetic','--allow-dirty','--no-solve-observer'].includes(a)||(oi>=0&&i===oi+1)||(si>=0&&i===si+1)||(mi>=0&&i===mi+1)||(ai>=0&&i===ai+1)),'unknown argument');
  if(path)assert.ok(!path.startsWith(root),'write observations outside checkout');
  const report=runModalAudit({allowDirty:args.includes('--allow-dirty'),stage:si>=0?args[si+1]:'diagnostic',matrix:mi>=0?args[mi+1]:'smoke',instrument:!args.includes('--no-solve-observer'),lineSearchArithmetic:ai>=0?args[ai+1]:undefined});
  const bytes=JSON.stringify(report,(_key,v)=>typeof v==='number'&&!Number.isFinite(v)?{nonFinite:Number.isNaN(v)?'NaN':v>0?'Infinity':'-Infinity'}:v)+'\n';
  if(path)writeFileSync(path,bytes,{flag:'wx',mode:0o600});else process.stdout.write(bytes);
  console.error('membrane-modal-audit: '+report.results.length+' geometries '+report.results.reduce((n,r)=>n+r.trajectories.length,0)+' trajectories '+report.classification);
}
