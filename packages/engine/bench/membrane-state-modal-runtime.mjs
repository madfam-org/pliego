// Authority-aware observation of actual public World steps. No substitute solver.
import {createHash} from 'node:crypto';
import {World} from '../src/index.js';
import {gradient} from '../src/xpbd/implicit.js';
import {implicitEnergy} from '../src/xpbd/energy-search.js';
import {REFERENCE_STATE_IDENTITY} from '../src/xpbd/reference-state.js';
import {createModalWorld,captureModalReference} from './membrane-modal-runtime.mjs';
import * as D from '../src/xpbd/double-double.js';
import * as K from '../src/constants.js';

const MODE='reference-displacement',ABS='absolute-position',UV='uv-displacement',DD='double-double',INC='membrane-inertia-increment';
const finite=x=>typeof x==='number'&&Number.isFinite(x),arr=x=>Array.from(x??[]);
const same=(a,b)=>a?.length===b?.length&&arr(a).every((v,i)=>Object.is(v,b[i]));
const max=a=>Math.max(0,...arr(a).map(Math.abs)),zero=a=>arr(a).every(v=>v===0);
const NATIVE_LITTLE_ENDIAN=new Uint8Array(new Uint16Array([1]).buffer)[0]===1;
const demand=(ok,message)=>{if(!ok)throw new Error('membrane-state-modal-runtime: '+message);};
export function encodeStateModalVectors(fields){
  const stateFloat64LE={},stateSHA256={};
  for(const [key,values]of Object.entries(fields)){
    const b=Buffer.alloc(8*values.length);
    if(values instanceof Float64Array){const view=new DataView(values.buffer,values.byteOffset,values.byteLength);for(let i=0;i<values.length;i++)b.writeBigUInt64LE(view.getBigUint64(8*i,NATIVE_LITTLE_ENDIAN),8*i);}
    else arr(values).forEach((v,i)=>b.writeDoubleLE(v,8*i));
    stateFloat64LE[key]=b.toString('base64');stateSHA256[key]=createHash('sha256').update(b).digest('hex');
  }
  return {stateFloat64LE,stateSHA256};
}
function controlledExecutionErrors(context){
  const w=context.world,errors=[];
  for(const key of ['newtonIterations','previousPoseStart','substeps'])if(!Object.is(w.opts[key],context.options[key]))errors.push('live controlled solver option changed: '+key);
  if(!Object.is(w.dt,1/(60*context.options.substeps)))errors.push('live controlled timestep changed');
  return errors;
}
function referenceNative(w){
  const values=new Float64Array(22*w.orthotropicMembrane.elements.length);let offset=0;
  for(const e of w.orthotropicMembrane.elements)for(const part of [e.reference.u,e.reference.v,e.reference.x0,Float64Array.of(e.reference.c,e.reference.s),e.Q,Float64Array.of(e.volume)]){
    new Uint8Array(values.buffer,8*offset,8*part.length).set(new Uint8Array(part.buffer,part.byteOffset,part.byteLength));offset+=part.length;
  }
  return values;
}
const referenceWords=w=>arr(referenceNative(w));
function currentStateBinding(w){
  return encodeStateModalVectors({x:w.x,xs:w.xs,xt:w.xt,v:w.v,u:w._u,us:w._us,ut:w._ut,x0:w.X0,mass:w.mass,h:[w.dt],initialX:w._referenceInitialX,initialU:w._referenceInitialU,initialV:w._referenceInitialV,reference:referenceNative(w)});
}

/** First preserve the actual historical native initialization, then convert once.
 * The extra absolute context is unstepped and supplies no predictor/oracle state.
 */
export function createStateModalWorld(patch,{stateCoordinates=MODE,membraneCurvature='gauss-newton',...parameters}={}){
  demand(stateCoordinates===MODE,'only explicitly named reference-displacement state supported');
  demand(['gauss-newton','exact-hessian'].includes(membraneCurvature),'named membraneCurvature required');
  // Exact curvature is a named candidate operator only; omission keeps the historical options/parameters bytes.
  const exact=membraneCurvature==='exact-hessian';
  const required={lineSearchArithmetic:INC,membraneArithmetic:DD,membraneReference:UV};
  for(const [key,value]of Object.entries(required))demand(parameters[key]===undefined||parameters[key]===value,'incompatible '+key);
  const old=createModalWorld(patch,{...parameters,...required}),actualX=old.world.x.slice(),actualV=old.world.v.slice();
  const originalXs=old.world.xs.slice(),originalXt=old.world.xt.slice();
  const options={...old.options,stateCoordinates:MODE,...(exact?{membraneCurvature}:{})},world=new World(patch.doc,options);
  world.setInitialReferencePose(actualX,actualV);
  demand(same(world.x,actualX)&&same(world.v,actualV)&&same(world.xs,originalXs)&&same(world.xt,originalXt),'conversion changed actual initialization/constructor buffers');
  demand(same(world.mass,old.world.mass)&&same(world.X0,old.world.X0)&&world.dt===old.world.dt,'native reference/mass/timestep changed');
  const a=world.authoritativeState(),words=referenceWords(world);
  demand(same(a.coefficients,words),'actual native reference words changed');
  const binding=encodeStateModalVectors({x:world.x,xs:world.xs,xt:world.xt,v:world.v,u:a.u,us:a.us,ut:a.ut,x0:a.x0,mass:world.mass,h:[world.dt],initialX:a.initialX,initialU:a.initialU,initialV:a.initialV,reference:words});
  return {...old,world,options,parameters:{...old.parameters,stateCoordinates:MODE,...(exact?{membraneCurvature}:{})},stateCoordinates:MODE,...(exact?{membraneCurvature}:{}),
    referenceCoefficients:captureModalReference({world}),referenceWords:words,initialBinding:binding,
    initialization:{unsteppedHistoricalContextConstructed:true,physicalSolvesExecuted:0,
      actualInitialX:arr(actualX),actualInitialV:arr(actualV),constructorXs:arr(originalXs),constructorXt:arr(originalXt),
      policy:'actual native old-factory x/v copied once; exact one-word conversion and projection Object.is; no ideal modal reset or target supplied'}};
}

function shadowWorld(w){
  const s=Object.create(w);
  for(const key of ['thetaPred','hingeGrad','edgeDir','edgeComp','edgeK'])s[key]=w[key].slice();
  s.orthotropicMembrane=Object.create(w.orthotropicMembrane);
  s.orthotropicMembrane.work=structuredClone(w.orthotropicMembrane.work);
  s.orthotropicMembrane.block=w.orthotropicMembrane.block.slice();
  return s;
}
function inertiaEnergy(x,xt,mass,h){
  let value=0;const reciprocal=1/(h*h);
  for(let v=0;v<mass.length;v++)for(let c=0;c<3;c++)value+=.5*mass[v]*reciprocal*(x[3*v+c]-xt[3*v+c])**2;
  return value;
}
function reductions(context,u,v,elasticEnergy){
  const {masses,phi,modalMass}=context,displacement=masses.map((_m,i)=>[u[3*i],-u[3*i+2]]),velocityUV=masses.map((_m,i)=>[v[3*i],-v[3*i+2]]);
  let q=0,qdot=0,kineticEnergy=0,leak=0;
  const linearMomentum=[0,0,0];
  for(let i=0;i<masses.length;i++){
    q+=masses[i]*(phi[i][0]*displacement[i][0]+phi[i][1]*displacement[i][1]);
    qdot+=masses[i]*(phi[i][0]*velocityUV[i][0]+phi[i][1]*velocityUV[i][1]);
    kineticEnergy+=.5*masses[i]*(v[3*i]**2+v[3*i+1]**2+v[3*i+2]**2);
    for(let c=0;c<3;c++)linearMomentum[c]+=masses[i]*v[3*i+c];
  }
  q/=modalMass;qdot/=modalMass;
  for(let i=0;i<masses.length;i++)leak+=masses[i]*((displacement[i][0]-q*phi[i][0])**2+(displacement[i][1]-q*phi[i][1])**2);
  return {displacement,velocityUV,modalCoordinate:q,modalVelocity:qdot,modalLeakageMassNorm:Math.sqrt(leak),
    kineticEnergy,mechanicalEnergy:elasticEnergy===null?null:elasticEnergy+kineticEnergy,linearMomentum};
}
/** Approximate DD reductions retain X0+u words; no rounded x feeds authority.
 * Word outputs are diagnostics, not correctly-rounded material invariants.
 */
function authorityMoments(x0,u,v,mass){
  const sum=()=>/** @type {D.DD} */([0,0]);let center=[sum(),sum(),sum()],angular=[sum(),sum(),sum()];
  const total=mass.reduce((s,m)=>s+m,0);
  for(let i=0;i<mass.length;i++){
    const q=[0,1,2].map(c=>D.twoSum(x0[3*i+c],u[3*i+c])),vel=v.slice(3*i,3*i+3);
    for(let c=0;c<3;c++){
      center[c]=D.add(center[c],D.scale(q[c],mass[i]));
      const a=(c+1)%3,b=(c+2)%3;
      angular[c]=D.add(angular[c],D.scale(D.sub(D.scale(q[a],vel[b]),D.scale(q[b],vel[a])),mass[i]));
    }
  }
  center=center.map(value=>D.scale(value,1/total));
  return {centerOfMassWords:center,angularMomentumAboutWorldOriginWords:angular,
    momentsScope:'approximate DD reductions of represented real X0+u and actual v; rounded reciprocal of total native mass; no public-x substitution or universal correct-rounding claim'};
}

/** Boundary-only observation. Failure buffers remain labelled incomplete; no repair. */
export function observeStateModalWorld(context,{step=0,initial=step===0,execution=null}={}){
  const w=context.world,n=w.mesh.nV,errors=controlledExecutionErrors(context),check=(ok,message)=>{if(!ok)errors.push(message);};
  const raw={x:arr(w.x),xs:arr(w.xs),xt:arr(w.xt),v:arr(w.v)},latent={u:arr(w._u),us:arr(w._us),ut:arr(w._ut),v:arr(w.v),x0:arr(w.X0),
    initialX:arr(w._referenceInitialX),initialU:arr(w._referenceInitialU),initialV:arr(w._referenceInitialV)};
  let nativeReference=new Float64Array(0),words=[];try{nativeReference=referenceNative(w);words=arr(nativeReference);}catch(cause){errors.push('reference unavailable: '+cause.message);}
  const fields={x:w.x,xs:w.xs,xt:w.xt,v:w.v,u:w._u,us:w._us,ut:w._ut,x0:w.X0,mass:w.mass,h:[w.dt],initialX:w._referenceInitialX,initialU:w._referenceInitialU,initialV:w._referenceInitialV,reference:nativeReference};
  const binding=encodeStateModalVectors(fields),targetValid=!initial&&step>0&&!w.asleep&&w.framesRun===step&&w.substepsRun===step&&!!execution&&execution.actualSubstepExecuted&&!execution.exception;
  check(Number.isSafeInteger(step)&&step>=0&&initial===(step===0)&&step===w.framesRun&&step===w.substepsRun,'actual one-call/one-substep index identity mismatch');
  check(!w.asleep,'sleep censors measurement');
  check(Object.values(fields).every(a=>a.every(finite)),'nonfinite actual buffers');
  if(initial)check(Object.entries(binding.stateSHA256).every(([key,value])=>value===context.initialBinding.stateSHA256[key]),'actual initial native-word binding changed');
  check(raw.x.length===3*n&&latent.u.length===3*n,'actual state dimensions changed');
  check(w.opts.stateCoordinates===MODE&&JSON.stringify(w._referenceIdentity)===JSON.stringify(REFERENCE_STATE_IDENTITY),'state identity changed');
  check(same(w.mass,context.masses)&&w.dt===1/(60*w.opts.substeps),'native mass/timestep changed');
  check(same(words,context.referenceWords),'reference words changed');
  check(zero(w.userForce)&&zero(w.fext)&&w.drivers.wind===0&&zero(w.driveOn)&&zero(w.terms.active),'external work entered experiment');
  check(w.opts.damping===0&&w.bendDamp===0&&w.opts.gravity===false&&w.opts.contact===false&&w.opts.ground===false&&w.opts.plasticity===false,'omitted physics options changed');
  if(execution)check(execution.returnedSubsteps===1&&execution.actualSubstepExecuted&&execution.framesAdvancedExactlyOne&&execution.accumulatedTimeExact&&
    execution.usMatchesPreviousU&&execution.utMatchesActualDisplacementPredictor&&execution.velocityMatchesActualDisplacementDifference&&
    execution.xProjectionMatchesAuthority&&execution.xsProjectionMatchesAuthority&&execution.xtProjectionMatchesAuthority&&!execution.exception,'actual authority predecessor/predictor/velocity/execution mismatch');
  let authority=null,publicData=null,nonMembraneEnergy=null,nonMembraneGradientMaximum=null,authorityNonMembraneEnergy=null,authorityNonMembraneGradientMaximum=null,metric=null,authorityMetric=null,rawPublicImplicitEnergy=null,rawAuthorityImplicitEnergy=null;
  try{
    const boundary=w.authoritativeState();check(boundary!==undefined&&same(boundary.u,latent.u),'authority boundary unavailable');
    const observed=w.authoritativeResiduals(context.forceTolerance);authority=observed.authoritative;publicData=observed.public;
    const shadow=shadowWorld(w),g=new Float64Array(3*n),gu=new Float64Array(3*n);
    gradient(shadow,w.x,g,ABS);gradient(shadow,w._u,gu,MODE);
    nonMembraneGradientMaximum=max(arr(g).map((v,i)=>v-publicData.elasticGradient[i]));
    authorityNonMembraneGradientMaximum=max(arr(gu).map((v,i)=>v-authority.elasticGradient[i]));
    const ie=inertiaEnergy(raw.x,raw.xt,w.mass,w.dt),ue=inertiaEnergy(latent.u,latent.ut,w.mass,w.dt);
    rawPublicImplicitEnergy=implicitEnergy(shadow,w.x,ABS);rawAuthorityImplicitEnergy=implicitEnergy(shadow,w._u,MODE);
    nonMembraneEnergy=rawPublicImplicitEnergy-(ie+publicData.energy);
    authorityNonMembraneEnergy=rawAuthorityImplicitEnergy-(ue+authority.energy);
    check(nonMembraneEnergy===0&&authorityNonMembraneEnergy===0&&nonMembraneGradientMaximum===0&&authorityNonMembraneGradientMaximum===0,'nonzero omitted energy/gradient');
    metric=shadow.orthotropicMembrane.diagnostics(w.x,ABS);authorityMetric=shadow.orthotropicMembrane.diagnostics(w._u,MODE);
    check(metric.finite&&authorityMetric.finite,'nonfinite actual selected metric');
  }catch(cause){errors.push(cause.message);}
  const force=(value,mode)=>{
    const elasticEnergy=value?.energy??null,inertial=mode===MODE?inertiaEnergy(latent.u,latent.ut,w.mass,w.dt):inertiaEnergy(raw.x,raw.xt,w.mass,w.dt);
    return {elasticEnergy,rawImplicitEnergy:mode===MODE?rawAuthorityImplicitEnergy:rawPublicImplicitEnergy,rawInertiaEnergy:inertial,elasticGradient:value?arr(value.elasticGradient):null,inertiaGradient:targetValid&&value?arr(value.inertiaGradient):null,
      residual:targetValid&&value?arr(value.residual):null,residualInfinity:targetValid&&value?value.residualInfinity:null,
      inertiaEnergy:targetValid?inertial:null,incrementalEnergy:targetValid&&elasticEnergy!==null?elasticEnergy+inertial:null,
      forceScale:context.forceScale,forceTolerance:context.forceTolerance,targetValid};
  };
  const p=force(publicData,ABS),a=force(authority,MODE),publicU=raw.x.map((x,i)=>x-w.X0[i]);
  const planarExact=[...raw.x,...raw.v,...latent.u,...latent.us,...latent.ut].every((v,i)=>i%3!==1||v===0)&&(!p.elasticGradient||p.elasticGradient.every((v,i)=>i%3!==1||v===0));
  check(planarExact,'out-of-plane state/gradient');
  const authorityResult={identity:structuredClone(w._referenceIdentity),...latent,...a,...reductions(context,latent.u,raw.v,a.elasticEnergy),
    converged:targetValid&&authority?authority.residualInfinity<=context.forceTolerance:null,planarExact,metric:authorityMetric,
    nonMembraneEnergy:authorityNonMembraneEnergy,nonMembraneGradientMaximum:authorityNonMembraneGradientMaximum,
    rawSHA256:Object.fromEntries(['u','us','ut','v','x0','initialX','initialU','initialV'].map(k=>[k,binding.stateSHA256[k]]))};
  try{Object.assign(authorityResult,authorityMoments(latent.x0,latent.u,raw.v,context.masses));}catch(cause){errors.push('authority moment diagnostic: '+cause.message);}
  const forceVectors={};
  for(const [prefix,value]of [['public',publicData],['authoritative',authority]])if(value)for(const key of ['elasticGradient','inertiaGradient','residual'])forceVectors[prefix+key[0].toUpperCase()+key.slice(1)]=value[key];
  const forceBinding=encodeStateModalVectors(forceVectors);
  const projected=reductions(context,publicU,raw.v,p.elasticEnergy);
  const totalMass=context.masses.reduce((s,m)=>s+m,0),centerOfMass=[0,0,0],angularMomentumAboutWorldOrigin=[0,0,0];
  for(let i=0;i<n;i++)for(let c=0;c<3;c++){
    centerOfMass[c]+=context.masses[i]*raw.x[3*i+c]/totalMass;
    const j=(c+1)%3,k=(c+2)%3;
    angularMomentumAboutWorldOrigin[c]+=context.masses[i]*(raw.x[3*i+j]*raw.v[3*i+k]-raw.x[3*i+k]*raw.v[3*i+j]);
  }
  const afterBinding=encodeStateModalVectors({...fields,reference:referenceNative(w)});
  check(Object.entries(binding.stateSHA256).every(([key,value])=>afterBinding.stateSHA256[key]===value),'observation changed actual raw bytes');
  return {schema:'pliego-membrane-state-modal-observation/1',step,initial,h:w.dt,time:w.time,...raw,...p,...projected,
    modalMass:context.modalMass,centerOfMass,angularMomentumAboutWorldOrigin,
    publicMetricCoordinates:'rounded-public-position-with-authoritative-velocity',metric,planarExact,
    literalForceGate:targetValid&&publicData?publicData.residualInfinity<=context.forceTolerance:null,
    absoluteForceTolerance:1e-7,relativeForceTolerance:1e-10,normalizedResidual:p.residualInfinity===null?null:p.residualInfinity/context.forceScale,
    targetScope:targetValid?'completed actual displacement predictor projected into public xt':'constructor/incomplete/unverified/sleep-censored buffers; no completed target certification',
    nonMembraneEnergy,nonMembraneGradientMaximum,authoritative:authorityResult,...binding,
    forceFloat64LE:forceBinding.stateFloat64LE,forceSHA256:forceBinding.stateSHA256,forceBindingScope:'raw selected native force tuples, including uninitialized raw-target arithmetic; only completed-target flags certify a force equation',
    rawSHA256:Object.fromEntries(['x','xs','xt','v'].map(k=>[k,binding.stateSHA256[k]])),
    asleep:w.asleep,framesRun:w.framesRun,substepsRun:w.substepsRun,execution,
    solver:{newtonIterations:w.opts.newtonIterations,substeps:w.opts.substeps,previousPoseStart:w.opts.previousPoseStart,
      factorizations:w.factorCount,lastPublicPcgIterations:w.pcgIterations,pcgMaxIterations:K.PCG_MAX_ITER,pcgRelativeTolerance:K.PCG_RTOL,lineSearchBacktracks:w.energySearch.backtracks,lineSearchRejected:w.energySearch.rejected,
      lineSearchArithmetic:w.opts.lineSearchArithmetic,membraneArithmetic:w.opts.membraneArithmetic,membraneReference:w.opts.membraneReference,
      stateCoordinates:MODE,membraneArithmeticIdentity:structuredClone(w.orthotropicMembrane.configuration.arithmetic),membraneReferenceIdentity:structuredClone(w.orthotropicMembrane.configuration.reference),stateIdentity:structuredClone(w._referenceIdentity),linearDirectionResiduals:null,acceptedAlphaHistory:null,
      // Exact-only receipts: requested operator, effective factor operator and every counted event.
      ...(w._exactCurvature?{membraneCurvature:w.opts.membraneCurvature,membraneCurvatureIdentity:structuredClone(w.orthotropicMembrane.configuration.curvaturePolicy),
        factorCurvature:w._factorState?.curvature??null,membraneCurvatureCounters:structuredClone(w._exactCurvature.counters),lastCurvatureReceipt:structuredClone(w._exactCurvature.last)}:{})},
    measurementValid:errors.length===0,errors,
    scope:'boundary observation of actual reference-displacement World; public field meanings retained, authority separate; force failure is valid diagnostic data, never a tolerance waiver'};
}

export function runStateModalRuntime(patch,{steps=1,retain='all',onObservation,...parameters}={}){
  return runStateModalContext(createStateModalWorld(patch,parameters),{steps,retain,onObservation});
}
/** Every requested interval is a real single public step; no sleep/reset/extra solve. */
export function runStateModalContext(context,{steps=1,retain='all',onObservation,onStep,checkpoints=[],...unknown}={}){
  demand(Object.keys(unknown).length===0,'unknown runner options');
  demand(Number.isSafeInteger(steps)&&steps>0&&['all','initial-final'].includes(retain),'positive steps and supported retention required');
  const callback=onObservation??onStep;demand(!(onObservation&&onStep),'one observation callback required');
  demand(callback===undefined||typeof callback==='function'&&callback.constructor.name!=='AsyncFunction','synchronous callback required');
  const w=context.world;demand(w.framesRun===0&&w.substepsRun===0&&w.time===0&&w._acc===0,'newly initialized, unstepped context required');
  const observations=[],saved={},requestedCheckpoints=new Set(checkpoints),initial=observeStateModalWorld(context,{step:0,initial:true});
  let last=initial,status='completed',error=null,completedSteps=0,observedCount=0,callbackCount=0,valid=true,noSleep=true,counters=true,publicAll=true,authorityAll=true;
  const consume=o=>{
    last=o;observedCount++;valid&&=o.measurementValid;noSleep&&=!o.asleep;
    if(!o.initial){publicAll&&=o.literalForceGate===true;authorityAll&&=o.authoritative.converged===true;}
    if(retain==='all'||o.initial)observations.push(o);
    if(requestedCheckpoints.has(o.step))saved[o.step]=structuredClone(o);
    if(callback){const result=callback(structuredClone(o));demand(!result||typeof result.then!=='function','async callback result unsupported');callbackCount++;}
  };consume(initial);
  if(!initial.measurementValid)status=w.asleep?'sleep-censored':'invalid-initial-observation';
  for(let step=1;step<=steps&&initial.measurementValid;step++){
    const before={u:w._u.slice(),x:w.x.slice(),v:w.v.slice(),time:w.time,frames:w.framesRun,substeps:w.substepsRun};
    let returned=null,exception=null;
    try{
      const changed=controlledExecutionErrors(context);demand(changed.length===0,changed.join('; '));
      const binding=currentStateBinding(w);
      demand(Object.entries(binding.stateSHA256).every(([key,value])=>value===last.stateSHA256[key]),'native boundary input changed after observation');
      returned=w.step(w.dt);
    }catch(cause){exception={name:cause.name,message:cause.message};status='world-step-exception';error=exception;}
    const actual=w.substepsRun===before.substeps+1;if(actual)completedSteps++;
    const execution={returnedSubsteps:returned,actualSubstepExecuted:actual,framesAdvancedExactlyOne:w.framesRun===before.frames+1,accumulatedTimeExact:w.time===before.time+w.dt,
      usMatchesPreviousU:same(w._us,before.u),utMatchesActualDisplacementPredictor:w._ut.every((v,i)=>Object.is(v,before.u[i]+w.dt*before.v[i])),
      velocityMatchesActualDisplacementDifference:w.v.every((v,i)=>Object.is(v,(w._u[i]-w._us[i])/w.dt)),
      xProjectionMatchesAuthority:w.x.every((v,i)=>Object.is(v,w.X0[i]+w._u[i])),xsProjectionMatchesAuthority:w.xs.every((v,i)=>Object.is(v,w.X0[i]+w._us[i])),xtProjectionMatchesAuthority:w.xt.every((v,i)=>Object.is(v,w.X0[i]+w._ut[i])),
      xsMatchesPreviousX:same(w.xs,before.x),xtMatchesActualPredictor:w.xt.every((v,i)=>Object.is(v,before.x[i]+(w.dt*before.v[i]+w.dt*w.dt*w.invMass[Math.floor(i/3)]*w.fext[i]))),
      velocityMatchesActualDifference:w.v.every((v,i)=>Object.is(v,(w.x[i]-w.xs[i])/w.dt)),
      publicDifferenceIdentitiesScope:'diagnostics only; changed ABI does not require public-rounded predictor/velocity association',exception};
    counters&&=returned===1&&actual&&execution.framesAdvancedExactlyOne&&execution.accumulatedTimeExact;
    const observation=observeStateModalWorld(context,{step,initial:false,execution});consume(observation);
    if(exception)break;if(w.asleep){status='sleep-censored';break;}if(!observation.measurementValid){status='invalid-observation';break;}
  }
  if(retain==='initial-final'&&last!==initial)observations.push(last);
  return {schema:'pliego-membrane-state-modal-runtime/1',status,error,parameters:{...context.parameters,steps,retain},options:context.options,h:w.dt,
    initial,final:last,observations,checkpoints:saved,observedCount,retainedCount:observations.length,callbackCount,requestedSteps:steps,completedSteps,actualTime:w.time,requestedHorizon:steps*w.dt,
    massProof:context.massProof,initialization:context.initialization,initialBinding:context.initialBinding,fixedInitialForceScale:context.forceScale,forceTolerance:context.forceTolerance,
    modalMass:context.modalMass,maximumModeNorm:context.maximumModeNorm,
    sleepPolicy:{speedMmPerSecond:K.SLEEP_SPEED,consecutivePublicCalls:K.SLEEP_FRAMES,override:'none; sleep censors this experiment'},
    gates:{measurementValid:valid,noSleep,exactActualSubstepCounters:counters,completeRequestedSteps:completedSteps===steps,literalFinalForceEverySubstep:completedSteps===steps&&status==='completed'&&publicAll,authoritativeFinalForceEverySubstep:completedSteps===steps&&status==='completed'&&authorityAll,
      discreteIntegratorAccuracy:'separate physical CST comparator, not exact selected-law/native-C truth',continuousTimeAccuracy:'separate unresolved gate',physicalStockCalibration:'not measured'},
    scope:'one actual public substep per call, unchanged budgets and inputs; independent public/authority force gates; all incomplete/failed outcomes retained'};
}
