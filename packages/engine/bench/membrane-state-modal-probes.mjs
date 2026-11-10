// Pure capture-to-oracle projection. Never steps a World or supplies solver targets.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stateModalSource,assertStateModalSource,STATE_MODAL_PROTOCOL} from './membrane-state-modal-audit.mjs';
import {reserveStateModalOutput} from './membrane-state-modal-output.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const STATE=['x','xs','xt','v','u','us','ut','x0','mass','h','initialX','initialU','initialV'];
const FORCE=['publicElasticGradient','publicInertiaGradient','publicResidual','authoritativeElasticGradient','authoritativeInertiaGradient','authoritativeResidual'];
export function assertStateModalProbeSource(captured,before){
  const {status:_status,...captureSource}=before;
  assert.deepEqual(captured,{...captureSource,dirty:false},'probe source must exactly match candidate capture');
}
function decode(encoded,hash){
  const b=Buffer.from(encoded,'base64');assert.equal(b.toString('base64'),encoded);assert.equal(sha(b),hash);assert.equal(b.length%8,0);
  const values=Array.from({length:b.length/8},(_,i)=>b.readDoubleLE(8*i));assert.ok(values.every(Number.isFinite),'oracle probes require finite native words');return values;
}

/** Original LE bytes are copied unchanged; JSON is only a numeric convenience view. */
export function stateModalProbeCase(group,row,observation,selection){
  const o=observation,a=o.authoritative;
  assert.equal(o.initial,false);assert.equal(o.targetValid,true);assert.equal(a.targetValid,true);
  const stateFloat64LE={},stateSHA256={},values={};
  for(const key of STATE){stateFloat64LE[key]=o.stateFloat64LE[key];stateSHA256[key]=o.stateSHA256[key];values[key]=decode(stateFloat64LE[key],stateSHA256[key]);}
  for(const key of FORCE){stateFloat64LE[key]=o.forceFloat64LE[key];stateSHA256[key]=o.forceSHA256[key];values[key]=decode(stateFloat64LE[key],stateSHA256[key]);}
  const referenceFloat64LE=row.referenceWords.stateFloat64LE.reference,referenceSHA256=row.referenceWords.stateSHA256.reference;
  assert.equal(referenceFloat64LE,o.stateFloat64LE.reference);assert.equal(referenceSHA256,o.stateSHA256.reference);decode(referenceFloat64LE,referenceSHA256);
  assert.equal(values.h.length,1);assert.equal(values.h[0],row.h);assert.equal(o.forceTolerance,row.forceTolerance);assert.equal(o.forceScale,row.fixedForceScale);
  const forceRecord=prefix=>({energy:prefix==='public'?o.elasticEnergy:a.elasticEnergy,
    elasticGradient:values[prefix+'ElasticGradient'],inertiaGradient:values[prefix+'InertiaGradient'],residual:values[prefix+'Residual'],
    residualInfinity:prefix==='public'?o.residualInfinity:a.residualInfinity,
    ...(prefix==='public'?{literalForceGate:o.literalForceGate}:{converged:a.converged})});
  return {vertices:group.vertices,triangles:group.triangles,material:group.material,grain:group.geometry.grain,
    referenceCoefficients:row.referenceCoefficients,referenceFloat64LE,referenceSHA256,
    x:values.x,xs:values.xs,xt:values.xt,mass:values.mass,h:values.h[0],
    state:{...a.identity,u:values.u,us:values.us,ut:values.ut,v:values.v,x0:values.x0,targetValid:true,
      initialization:{x:values.initialX,u:values.initialU,v:values.initialV}},
    runtime:{fixedForceScale:row.fixedForceScale,forceTolerance:row.forceTolerance,public:forceRecord('public'),authoritative:forceRecord('authoritative')},
    stateFloat64LE,stateSHA256,includeHessian:false,selection,
    scope:'one captured completed endpoint; independent latent/public force truth, not trajectory or time/material acceptance'};
}

/** Select every retained poststep role, regardless of either force result. */
export function stateModalTrajectoryProbes(group,row,trajectoryIndex){
  const byStep=new Map(),skipped=[];
  for(const [role,record]of Object.entries(row.snapshots)){
    const o=record.observation;
    if(o.initial||!o.targetValid){skipped.push({trajectoryIndex,step:o.step,role,reason:o.initial?'constructor target is not a completed solve':'uncertified target',stateSHA256:o.stateSHA256});continue;}
    let entry=byStep.get(o.step);
    if(entry){assert.deepEqual(entry.observation,o,'same endpoint roles must bind identical observations');entry.roles.push(role);}
    else byStep.set(o.step,{observation:o,roles:[role]});
  }
  const cases=Array.from(byStep.entries()).sort(([a],[b])=>a-b).map(([step,entry])=>stateModalProbeCase(group,row,entry.observation,
    {trajectoryIndex,level:row.level,budget:row.budget,seed:row.seed,step,roles:entry.roles.sort(),measurementValid:entry.observation.measurementValid}));
  return {cases,skipped};
}

export function buildStateModalProbes(report,inputSHA256){
  assert.equal(report.schema,'pliego-membrane-state-modal-audit/1');assert.equal(report.source.dirty,false);
  assert.match(inputSHA256,/^[a-f0-9]{64}$/);assert.equal(report.results.length,1);
  assert.equal(report.protocol.trajectories,STATE_MODAL_PROTOCOL.trajectories);assert.equal(report.protocol.poststeps,STATE_MODAL_PROTOCOL.poststeps);
  const group=report.results[0];assert.equal(group.trajectories.length,24);
  const cases=[],skipped=[];
  group.trajectories.forEach((row,index)=>{const result=stateModalTrajectoryProbes(group,row,index);cases.push(...result.cases);skipped.push(...result.skipped);});
  assert.ok(cases.length>0);
  return {schema:'pliego-membrane-state-modal-probes/1',source:report.source,inputSHA256,selectionPolicy:'every retained completed endpoint role; deduplicate trajectory+step only; no pass/fail filtering; all skipped constructor/uncertified roles listed',
    cases,skipped,coverage:{cases:cases.length,trajectories:24,declaredRequestedPoststeps:7110,capturedCompletedPoststeps:group.trajectories.reduce((sum,row)=>sum+row.runtime.completedSteps,0),allPoststepsEvaluated:false,allNewtonArmijoEvaluated:false},
    scope:'predeclared retained endpoint samples only; cannot certify unsampled force equations or complete time/material/booklet acceptance'};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);assert.equal(args.length,4);assert.equal(args[0],'--input');assert.equal(args[2],'--out');
  const before=stateModalSource();assert.equal(before.status,'','clean source required');
  const sink=reserveStateModalOutput(args[3]);try{
    const bytes=readFileSync(args[1]),report=JSON.parse(bytes);
    assertStateModalProbeSource(report.source,before);
    const result=buildStateModalProbes(report,sha(bytes));assertStateModalSource(before);sink.write(result);
    console.error('state-modal-probes: '+result.cases.length+' distinct completed endpoint samples; no solve executed');
  }finally{sink.close();}
}
