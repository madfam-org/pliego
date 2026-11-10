// Independent reductions of actual World fields; no engine or solver imports.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function demand(ok,message){if(!ok)throw new Error('membrane-state-modal-metrics: '+message);}
const sum=values=>{let s=0,c=0;for(const v of values){const t=s+v;c+=Math.abs(s)>=Math.abs(v)?(s-t)+v:(v-t)+s;s=t;}return s+c;};
const dot=(a,b,mass)=>sum(mass.map((m,i)=>m*sum(a[i].map((x,k)=>x*b[i][k]))));
const norm=(a,mass)=>Math.sqrt(Math.max(0,dot(a,a,mass)));
const difference=(a,b)=>a.map((p,i)=>p.map((x,k)=>x-b[i][k]));
const scaled=(a,s)=>a.map(p=>p.map(v=>v*s));
function field(a,n,dim,name){demand(Array.isArray(a)&&a.length===n&&a.every(p=>Array.isArray(p)&&p.length===dim&&p.every(finite)),name+' finite field/shape required');}

import {modalScales,modalTruth,spectralTruth,measureModalFields as measurePublicFields} from './membrane-modal-metrics.mjs';
export {modalScales,modalTruth,spectralTruth};

export function measureStateModalFields({vertices,mass,phi,omega,amplitude},observation,initialReference=null){
  const n=vertices.length,scales=modalScales({vertices,mass,phi,omega,amplitude});
  const authoritative=observation.authoritative;
  demand(authoritative&&typeof authoritative==='object','explicit authoritative observation required');
  const rawU=Array.from(authoritative.u??[]),v=Array.from(authoritative.v??[]);
  demand(rawU.length===3*n&&v.length===3*n&&rawU.every(finite)&&v.every(finite),'finite full authoritative u/v required');
  const u=mass.map((_m,i)=>rawU.slice(3*i,3*i+3));
  const velocity=mass.map((_m,i)=>v.slice(3*i,3*i+3));
  const coordinate=dot(u,scales.worldPhi,mass)/scales.modalMass;
  const modalVelocity=dot(velocity,scales.worldPhi,mass)/scales.modalMass;
  const displacementLeakage=norm(difference(u,scaled(scales.worldPhi,coordinate)),mass)/scales.displacement;
  const velocityLeakage=norm(difference(velocity,scaled(scales.worldPhi,modalVelocity)),mass)/scales.velocity;
  const actualPhase=Math.atan2(-modalVelocity/omega,coordinate),modalAmplitude=Math.hypot(coordinate,modalVelocity/omega);
  const truth=modalTruth({...scales,h:observation.h,step:observation.step,time:observation.time});
  const kinetic=.5*dot(velocity,velocity,mass),elastic=authoritative.elasticEnergy,energy=kinetic+elastic;
  demand(finite(elastic)&&elastic>=0&&finite(energy),'finite nonnegative actual energy required');
  const errors={};
  function error(target,expectedU,expectedV){
    const du=norm(difference(u,expectedU),mass)/scales.displacement;
    const dv=norm(difference(velocity,expectedV),mass)/scales.velocity;
    return {displacement:du,velocity:dv,state:Math.hypot(du,dv),energy:Math.abs(energy-target.energy)/scales.energy};
  }
  for(const key of ['continuous','backwardEuler']){
    const target=truth[key];
    const phaseDifference=Math.atan2(Math.sin(actualPhase-target.phase),Math.cos(actualPhase-target.phase));
    errors[key]={...error(target,scaled(scales.worldPhi,target.coordinate),scaled(scales.worldPhi,target.velocity)),
      modalCoordinate:Math.abs(coordinate-target.coordinate)/amplitude,modalVelocity:Math.abs(modalVelocity-target.velocity)/(amplitude*omega),
      phaseCycles:modalAmplitude>1e-8*amplitude?Math.abs(phaseDifference)/(2*Math.PI):null,
      phaseObservable:modalAmplitude>1e-8*amplitude};
  }
  let roundedInitial=null;
  if(initialReference){
    const targets=spectralTruth(initialReference,{h:observation.h,step:observation.step,time:observation.time});
    roundedInitial={continuous:error(targets.continuous,targets.continuous.displacement,targets.continuous.velocity),
      backwardEuler:error(targets.backwardEuler,targets.backwardEuler.displacement,targets.backwardEuler.velocity),
      initialReconstructionError:initialReference.reconstructionRelativeError,
      scope:'independent exact-UV physical CST spectrum propagates actual initial u with real M/h²; not exact selected-law/native-C propagation; never supplied to World'};
  }
  return {coordinate,modalVelocity,modalAmplitude,displacementLeakage,velocityLeakage,kinetic,elastic,energy,actualPhase,truth,errors,roundedInitial,
    scales:{modalMass:scales.modalMass,displacement:scales.displacement,velocity:scales.velocity,energy:scales.energy,force:scales.force,forceTolerance:scales.forceTolerance},
    normalization:scales.convention,
    coordinateSystem:'authoritative-reference-displacement',
    referenceMeaning:'unchanged independent exact-UV physical linear comparator, real M/h²; not selected-law/native-C truth',
    scope:'direct full3D u/v reductions, no rounded-x reconstruction; fixed denominators and all-mode/Y leakage; trajectory agreement cannot certify force/time/material acceptance'};
}

export function spectralStateInitialReference({vertices,mass,spectrum},initial){
  const n=vertices.length;field(vertices,n,2,'vertices');
  demand(Array.isArray(mass)&&mass.length===n&&mass.every(m=>finite(m)&&m>0),'positive spectral masses required');
  const eigenvalues=spectrum?.eigenvalues,modes=spectrum?.massNormalizedModes,nullIndices=spectrum?.nullIndices;
  demand(Array.isArray(eigenvalues)&&eigenvalues.length===2*n&&eigenvalues.every(finite)&&Array.isArray(modes)&&modes.length===2*n,'complete finite independent spectrum required');
  demand(Array.isArray(nullIndices)&&nullIndices.length===3&&new Set(nullIndices).size===3&&nullIndices.every(i=>Number.isInteger(i)&&i>=0&&i<2*n),'three declared free in-plane rigid modes required');
  const nulls=new Set(nullIndices),worldModes=modes.map((mode,i)=>{field(mode,n,2,'spectral mode');demand(nulls.has(i)||eigenvalues[i]>0,'nonrigid eigenvalues must be positive');return mode.map(([u,v])=>[u,0,-v]);});
  demand(initial.authoritative?.u?.length===3*n&&Array.from(initial.authoritative.u).every(finite),'finite actual initial authority required');
  demand(initial.authoritative.v?.length===3*n&&Array.from(initial.authoritative.v).every(v=>v===0),'zero initial velocity required for this spectral control');
  const u=mass.map((_m,i)=>initial.authoritative.u.slice(3*i,3*i+3));
  let orthogonality=0;
  for(let i=0;i<2*n;i++)for(let j=0;j<2*n;j++)orthogonality=Math.max(orthogonality,Math.abs(dot(worldModes[i],worldModes[j],mass)-(i===j?1:0)));
  demand(orthogonality<=1e-10,'independent mass-normalized basis orthogonality failed');
  const coefficients=worldModes.map(mode=>dot(mode,u,mass));
  const reconstructed=u.map((_p,i)=>[0,1,2].map(k=>sum(worldModes.map((mode,j)=>coefficients[j]*mode[i][k]))));
  const reconstructionRelativeError=norm(difference(reconstructed,u),mass)/Math.max(norm(u,mass),Number.MIN_VALUE);
  demand(reconstructionRelativeError<=1e-10,'actual initial field cannot be reconstructed by independent planar spectrum');
  return {eigenvalues:[...eigenvalues],nullIndices:[...nullIndices],worldModes,coefficients,orthogonality,reconstructionRelativeError,
    scope:'independent exact-UV physical CST eigenbasis and actual one-word u0; real M/h², not selected-law/native-C exact propagation; all null/other-mode coefficients retained'};
}

/** Public diagnostics retain actual projected x and actual World velocity. */
export function measurePublicStateModalFields(config,observation,initialReference=null){
  return {...measurePublicFields(config,observation,initialReference),
    coordinateSystem:'rounded-public-position-with-authoritative-velocity',
    referenceMeaning:'unchanged independent exact-UV physical CST comparator; public projection is not authoritative q'};
}

/** Compare complete authority fields, never re-add and re-subtract X0. */
export function compareStateModalStates(config,a,b){
  const n=config.vertices.length,s=modalScales(config),ua=a.authoritative?.u,ub=b.authoritative?.u,
    va=a.authoritative?.v,vb=b.authoritative?.v;
  demand([ua,ub,va,vb].every(v=>v?.length===3*n&&Array.from(v).every(finite)),'matching finite authority fields required');
  const asField=v=>config.mass.map((_m,i)=>Array.from(v).slice(3*i,3*i+3));
  const du=norm(difference(asField(ua),asField(ub)),config.mass)/s.displacement;
  const dv=norm(difference(asField(va),asField(vb)),config.mass)/s.velocity;
  return {displacement:du,velocity:dv,state:Math.hypot(du,dv),coordinateSystem:'authoritative-reference-displacement',normalization:s.convention};
}
