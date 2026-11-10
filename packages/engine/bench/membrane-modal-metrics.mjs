// Independent reductions of actual World fields; no engine or solver imports.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function demand(ok,message){if(!ok)throw new Error('membrane-modal-metrics: '+message);}
const sum=values=>{let s=0,c=0;for(const v of values){const t=s+v;c+=Math.abs(s)>=Math.abs(v)?(s-t)+v:(v-t)+s;s=t;}return s+c;};
const dot=(a,b,mass)=>sum(mass.map((m,i)=>m*sum(a[i].map((x,k)=>x*b[i][k]))));
const norm=(a,mass)=>Math.sqrt(Math.max(0,dot(a,a,mass)));
const difference=(a,b)=>a.map((p,i)=>p.map((x,k)=>x-b[i][k]));
const scaled=(a,s)=>a.map(p=>p.map(v=>v*s));
function field(a,n,dim,name){demand(Array.isArray(a)&&a.length===n&&a.every(p=>Array.isArray(p)&&p.length===dim&&p.every(finite)),name+' finite field/shape required');}

/** Dimensionless phi with max nodal norm 1; fixed denominators survive zero crossings. */
export function modalScales({vertices,mass,phi,omega,amplitude}){
  const n=vertices.length;field(vertices,n,2,'vertices');field(phi,n,2,'phi');
  demand(n>0&&Array.isArray(mass)&&mass.length===n&&mass.every(m=>finite(m)&&m>0),'positive nodal masses required');
  demand(finite(omega)&&omega>0&&finite(amplitude)&&amplitude>0,'positive omega/amplitude required');
  const maximumModeNorm=Math.max(...phi.map(p=>Math.hypot(...p)));
  demand(Math.abs(maximumModeNorm-1)<=1e-10,'dimensionless max-node-normalized phi required');
  const worldPhi=phi.map(([u,v])=>[u,0,-v]),modalMass=dot(worldPhi,worldPhi,mass),totalMass=sum(mass);
  const displacement=amplitude*Math.sqrt(modalMass),velocity=omega*displacement;
  const energy=.5*modalMass*(amplitude*omega)**2;
  const force=amplitude*omega**2*Math.max(...mass.map((m,i)=>m*Math.hypot(...phi[i])));
  demand([modalMass,totalMass,displacement,velocity,energy,force].every(x=>finite(x)&&x>0),'finite nonzero modal scales required');
  return {worldPhi,modalMass,totalMass,amplitude,omega,displacement,velocity,energy,force,
    forceTolerance:Math.max(1e-7,1e-10*force),
    convention:'fixed initial modal scales: A*sqrt(phi^T M phi), A*omega*sqrt(phi^T M phi), .5*A^2*omega^2*phi^T M phi; force=A*omega^2*max nodal m*norm(phi), never instantaneous force'};
}

/** Analytic linear oscillator and exact discrete backward Euler, not Newmark. */
export function modalTruth({omega,amplitude,modalMass,h,step,time=step*h}){
  demand([omega,amplitude,modalMass,h].every(x=>finite(x)&&x>0)&&Number.isInteger(step)&&step>=0&&finite(time)&&time>=0,'valid modal/time parameters required');
  const z=omega*h,phase=step*Math.atan(z),decay=Math.exp(-.5*step*Math.log1p(z*z));
  const initialEnergy=.5*modalMass*(amplitude*omega)**2;
  return {z,step,h,time,continuous:{coordinate:amplitude*Math.cos(omega*time),velocity:-amplitude*omega*Math.sin(omega*time),energy:initialEnergy,phase:omega*time},
    backwardEuler:{coordinate:amplitude*decay*Math.cos(phase),velocity:-amplitude*omega*decay*Math.sin(phase),energy:initialEnergy*decay**2,phase,decay}};
}

/** Observe the full 3D mass-weighted error, retaining out-of-plane failures. */
export function measureModalFields({vertices,mass,phi,omega,amplitude},observation,initialReference=null){
  const n=vertices.length,scales=modalScales({vertices,mass,phi,omega,amplitude});
  const x=Array.from(observation.x??[]),v=Array.from(observation.v??[]);
  demand(x.length===3*n&&v.length===3*n&&x.every(finite)&&v.every(finite),'finite full actual World x/v required');
  const u=vertices.map(([a,b],i)=>[x[3*i]-a,x[3*i+1],x[3*i+2]+b]);
  const velocity=mass.map((_m,i)=>v.slice(3*i,3*i+3));
  const coordinate=dot(u,scales.worldPhi,mass)/scales.modalMass;
  const modalVelocity=dot(velocity,scales.worldPhi,mass)/scales.modalMass;
  const displacementLeakage=norm(difference(u,scaled(scales.worldPhi,coordinate)),mass)/scales.displacement;
  const velocityLeakage=norm(difference(velocity,scaled(scales.worldPhi,modalVelocity)),mass)/scales.velocity;
  const actualPhase=Math.atan2(-modalVelocity/omega,coordinate),modalAmplitude=Math.hypot(coordinate,modalVelocity/omega);
  const truth=modalTruth({...scales,h:observation.h,step:observation.step,time:observation.time});
  const kinetic=.5*dot(velocity,velocity,mass),elastic=observation.elasticEnergy,energy=kinetic+elastic;
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
      scope:'independent full linear K/M spectrum propagates the actual rounded initial displacement, with zero initial velocity; no new World initial state or prediction supplied'};
  }
  return {coordinate,modalVelocity,modalAmplitude,displacementLeakage,velocityLeakage,kinetic,elastic,energy,actualPhase,truth,errors,roundedInitial,
    scales:{modalMass:scales.modalMass,displacement:scales.displacement,velocity:scales.velocity,energy:scales.energy,force:scales.force,forceTolerance:scales.forceTolerance},
    normalization:scales.convention,
    scope:'full 3D mass-weighted fields and fixed initial denominators; modal projection alone cannot hide rigid/out-of-plane/other-mode drift; no convergence assertion from matching a trajectory'};
}

/** Full independent spectral representation of actual rounded, planar u0/v0=0. */
export function spectralInitialReference({vertices,mass,spectrum},initial){
  const n=vertices.length;field(vertices,n,2,'vertices');
  demand(Array.isArray(mass)&&mass.length===n&&mass.every(m=>finite(m)&&m>0),'positive spectral masses required');
  const eigenvalues=spectrum?.eigenvalues,modes=spectrum?.massNormalizedModes,nullIndices=spectrum?.nullIndices;
  demand(Array.isArray(eigenvalues)&&eigenvalues.length===2*n&&eigenvalues.every(finite)&&Array.isArray(modes)&&modes.length===2*n,'complete finite independent spectrum required');
  demand(Array.isArray(nullIndices)&&nullIndices.length===3&&new Set(nullIndices).size===3&&nullIndices.every(i=>Number.isInteger(i)&&i>=0&&i<2*n),'three declared free in-plane rigid modes required');
  const nulls=new Set(nullIndices),worldModes=modes.map((mode,i)=>{field(mode,n,2,'spectral mode');demand(nulls.has(i)||eigenvalues[i]>0,'nonrigid eigenvalues must be positive');return mode.map(([u,v])=>[u,0,-v]);});
  demand(initial.x?.length===3*n&&Array.from(initial.x).every(finite),'finite actual initial x required');
  demand(initial.v?.length===3*n&&Array.from(initial.v).every(v=>v===0),'zero initial velocity required for this spectral control');
  const u=vertices.map(([a,b],i)=>[initial.x[3*i]-a,initial.x[3*i+1],initial.x[3*i+2]+b]);
  let orthogonality=0;
  for(let i=0;i<2*n;i++)for(let j=0;j<2*n;j++)orthogonality=Math.max(orthogonality,Math.abs(dot(worldModes[i],worldModes[j],mass)-(i===j?1:0)));
  demand(orthogonality<=1e-10,'independent mass-normalized basis orthogonality failed');
  const coefficients=worldModes.map(mode=>dot(mode,u,mass));
  const reconstructed=u.map((_p,i)=>[0,1,2].map(k=>sum(worldModes.map((mode,j)=>coefficients[j]*mode[i][k]))));
  const reconstructionRelativeError=norm(difference(reconstructed,u),mass)/Math.max(norm(u,mass),Number.MIN_VALUE);
  demand(reconstructionRelativeError<=1e-10,'actual initial field cannot be reconstructed by independent planar spectrum');
  return {eigenvalues:[...eigenvalues],nullIndices:[...nullIndices],worldModes,coefficients,orthogonality,reconstructionRelativeError,
    scope:'mass-normalized independent eigenbasis and exact actual rounded initial displacement; only declared rigid modes propagate at zero frequency; raw roundoff eigenvalues retained'};
}

export function spectralTruth(reference,{h,step,time=step*h}){
  demand(finite(h)&&h>0&&Number.isInteger(step)&&step>=0&&finite(time)&&time>=0,'valid spectral observation time required');
  const {worldModes,coefficients,eigenvalues}=reference,nulls=new Set(reference.nullIndices),n=worldModes[0].length,out={};
  for(const kind of ['continuous','backwardEuler']){
    const q=[],v=[];let energy=0;
    for(let j=0;j<eigenvalues.length;j++){
      const omega=nulls.has(j)?0:Math.sqrt(eigenvalues[j]),z=omega*h;
      const decay=kind==='continuous'?1:Math.exp(-.5*step*Math.log1p(z*z));
      const phase=kind==='continuous'?omega*time:step*Math.atan(z);
      q[j]=coefficients[j]*decay*Math.cos(phase);v[j]=-coefficients[j]*omega*decay*Math.sin(phase);
      energy+=.5*(v[j]*v[j]+omega*omega*q[j]*q[j]);
    }
    out[kind]={displacement:Array.from({length:n},(_,i)=>[0,1,2].map(k=>sum(q.map((value,j)=>value*worldModes[j][i][k])))),
      velocity:Array.from({length:n},(_,i)=>[0,1,2].map(k=>sum(v.map((value,j)=>value*worldModes[j][i][k])))),energy};
  }
  return out;
}

/** Budget/amplitude controls compare complete fields, not only projected phase. */
export function compareModalStates(config,a,b){
  const n=config.vertices.length,s=modalScales(config);
  demand(a.x?.length===3*n&&b.x?.length===3*n&&a.v?.length===3*n&&b.v?.length===3*n,'matching full states required');
  const delta=(field,key)=>Array.from({length:n},(_,i)=>Array.from({length:3},(_,k)=>field[key][3*i+k]));
  const du=norm(difference(delta(a,'x'),delta(b,'x')),config.mass)/s.displacement;
  const dv=norm(difference(delta(a,'v'),delta(b,'v')),config.mass)/s.velocity;
  demand(finite(du)&&finite(dv),'finite actual state differences required');
  return {displacement:du,velocity:dv,state:Math.hypot(du,dv),normalization:s.convention};
}

export function compareAmplitudeNormalizedStates(config,a,b,amplitudeA,amplitudeB){
  demand([amplitudeA,amplitudeB].every(v=>finite(v)&&v>0),'positive control amplitudes required');
  const n=config.vertices.length,s=modalScales({...config,amplitude:1});
  for(const o of [a,b])demand(o.x?.length===3*n&&o.v?.length===3*n,'complete amplitude-control state required');
  const u=(o,amp)=>config.vertices.map(([x,z],i)=>[(o.x[3*i]-x)/amp,o.x[3*i+1]/amp,(o.x[3*i+2]+z)/amp]);
  const v=(o,amp)=>config.mass.map((_m,i)=>o.v.slice(3*i,3*i+3).map(x=>x/amp));
  const du=norm(difference(u(a,amplitudeA),u(b,amplitudeB)),config.mass)/s.displacement;
  const dv=norm(difference(v(a,amplitudeA),v(b,amplitudeB)),config.mass)/s.velocity;
  demand(finite(du)&&finite(dv),'finite amplitude-normalized differences required');
  return {displacement:du,velocity:dv,state:Math.hypot(du,dv),
    normalization:'each actual full3D displacement/velocity divided by its own A, then fixed sqrt(modalMass), omega*sqrt(modalMass); no readdition of reference positions or removal of Y'};
}
