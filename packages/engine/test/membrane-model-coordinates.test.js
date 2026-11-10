import test from 'node:test';
import assert from 'node:assert/strict';
import { createUVReferenceElement, createOrthotropicElement, evaluateOrthotropicElement, OrthotropicMembrane } from '../src/xpbd/orthotropic-membrane.js';
import { accurateTrialTerms } from '../src/xpbd/accurate-membrane.js';
import { makePatch } from '../bench/membrane-patch.mjs';

const material={E1:5.5e9,E2:2.5e9,G12:1.43e9,thickness:.1};
const uv=[0,0,2,0,0,2],base=Float64Array.of(32,0,16,34,0,16,32,0,14);
const latent='reference-displacement',absolute='absolute-position';
const norm=a=>Math.hypot(...a);
const evaluate=(e,u,coordinates=latent)=>evaluateOrthotropicElement(e,u,{arithmetic:'double-double',coordinates});
function fixture(grain=31){
  const patch=makePatch({cells:1,grain,membraneModel:'orthotropic-stvk',membraneNu12:.293}),w=patch.world;
  const model=new OrthotropicMembrane(w.mesh,w.materials,w.doc,[.293],'double-double','uv-displacement');
  return {w,model};
}
function multiply(ch,direction){
  const out=new Float64Array(direction.length);
  for(let c=0;c<ch.n;c++)for(let k=ch.Ap[c];k<ch.Ap[c+1];k++){
    const i=ch.perm[ch.Ai[k]],j=ch.perm[c];
    for(let a=0;a<3;a++)for(let b=0;b<3;b++){
      out[3*i+a]+=ch.Ax[9*k+3*a+b]*direction[3*j+b];
      if(i!==j)out[3*j+b]+=ch.Ax[9*k+3*a+b]*direction[3*i+a];
    }
  }
  return out;
}

test('explicit model coordinates preserve exact-pose/default equality across grains and every public evaluation path',()=>{
  let controls=0;
  for(const grain of [0,.37,Math.PI/4,Math.PI/2]){
    const e=createUVReferenceElement(uv,material,grain,.293,base);
    const u=Float64Array.from({length:9},(_,i)=>(i%2?-1:1)*(i+1)/128),q=base.map((v,i)=>v+u[i]);
    assert.deepEqual(evaluate(e,u),evaluate(e,q,absolute));
    assert.deepEqual(evaluate(e,q,absolute),evaluateOrthotropicElement(e,q,{arithmetic:'double-double'}));controls++;
  }
  const {w,model:m}=fixture(),u=Float64Array.from(w.x,(_,i)=>(i%2?-1:1)*(i+1)/128),q=w.mesh.X0.map((v,i)=>v+u[i]);
  const after=u.map((v,i)=>v+(i+1)/256),qa=w.mesh.X0.map((v,i)=>v+after[i]);
  assert.equal(m.energy(u,latent),m.energy(q));assert.equal(m.energy(q),m.energy(q,absolute));
  assert.deepEqual(m.diagnostics(u,latent),m.diagnostics(q));
  assert.deepEqual(m.energyDifferenceDetails(u,after,latent),m.energyDifferenceDetails(q,qa));
  assert.equal(m.energyDifference(u,after,latent),m.energyDifferenceDetails(u,after,latent).difference);
  const a=new Float64Array(u.length),b=a.slice();m.addGradient(u,a,latent);m.addGradient(q,b);assert.deepEqual(a,b);
  const direction=u.map((_,i)=>Math.sin(i+.31)),ch=w.sys.ch;
  ch.clear();m.addGaussNewtonBlocks(w,u,ch,latent);const matrix=ch.Ax.slice();
  ch.clear();m.addGaussNewtonBlocks(w,q,ch);assert.deepEqual(ch.Ax,matrix);
  for(const fixed of [false,true]){
    const mask=w.invMass.slice(),p=direction.slice();if(fixed){mask[0]=0;p.fill(0,0,3);}
    const x=new Float64Array(u.length),y=x.slice();m.addGaussNewtonTimes(u,p,x,mask,latent);m.addGaussNewtonTimes(q,p,y,mask);assert.deepEqual(x,y);
    const assembled=multiply(ch,p);if(fixed)assembled.fill(0,0,3);
    assert.ok(norm(x.map((v,i)=>v-assembled[i]))/norm(x)<1e-12);
  }
  console.log(`membrane-model-coordinates-parity: ${controls} grain controls; default/explicit absolute and exact latent q agree for energy/g/H/GN/metrics/increments, sparse/operator masks`);
});

test('reference-displacement derivatives retain finite-difference convergence for nonplanar deformation',()=>{
  let worst=0;
  for(const grain of [.37,-.61]){
    const e=createUVReferenceElement(uv,material,grain,.293,base),u=Float64Array.from({length:9},(_,i)=>.03*Math.sin(1.3*i+.2)),value=evaluate(e,u);
    let previous=Infinity;
    for(const h of [1e-3,5e-4,2.5e-4,1.25e-4]){
      const g=new Float64Array(9),H=new Float64Array(81);
      for(let j=0;j<9;j++){
        const p=u.slice(),m=u.slice();p[j]+=h;m[j]-=h;const plus=evaluate(e,p),minus=evaluate(e,m);
        g[j]=(plus.energy-minus.energy)/(2*h);
        for(let i=0;i<9;i++)H[9*i+j]=(plus.gradient[i]-minus.gradient[i])/(2*h);
      }
      const error=norm(H.map((v,i)=>v-value.hessian[i]))/norm(value.hessian);
      assert.ok(error<.3*previous+1e-10);previous=error;
      assert.ok(norm(g.map((v,i)=>v-value.gradient[i]))/norm(value.gradient)<2e-4);
    }
    assert.ok(previous<1e-8);worst=Math.max(worst,previous);
  }
  console.log(`membrane-model-coordinates-derivatives: two signed grain/nonplanar controls, four central-difference halvings; finest exact Hessian relative error=${worst}`);
});

test('nonzero latent updates survive an unchanged rounded public pose and retain endpoint work',()=>{
  const {w,model:m}=fixture(),u=new Float64Array(w.x.length),after=u.slice();
  const coordinate=Array.from(w.mesh.X0).findIndex((v,i)=>i%3!==1&&Math.abs(v)>=20);assert.ok(coordinate>=0);
  after[coordinate]=2**-50;
  const beforePublic=w.mesh.X0.map((v,i)=>v+u[i]),afterPublic=w.mesh.X0.map((v,i)=>v+after[i]);assert.deepEqual(beforePublic,afterPublic);
  assert.equal(m.energy(u,latent),0);assert.ok(m.energy(after,latent)>0);assert.equal(m.energy(afterPublic),0);
  const g=new Float64Array(u.length);m.addGradient(after,g,latent);assert.ok(g.some(v=>v!==0));
  const details=m.energyDifferenceDetails(u,after,latent);assert.equal(details.valid,true);assert.equal(details.linear,0);assert.ok(details.remainder>0);
  assert.ok(Math.abs(details.difference/m.energy(after,latent)-1)<1e-14);
  assert.equal(m.energyDifferenceDetails(after,after,latent).difference,0);
  const reverse=m.energyDifferenceDetails(after,u,latent);assert.ok(Math.abs(reverse.difference/details.difference+1)<1e-14);
  const target=new Float64Array(u.length),world={mass:w.mass,dt:1/600,xt:new Float64Array(u.length).fill(2)};
  const terms=accurateTrialTerms(world,u,after,g,target),same=accurateTrialTerms({...world,xt:target},u,after,g);
  assert.deepEqual(terms,same);assert.equal(terms.inertiaLinear,0);assert.ok(terms.inertiaRemainder>0);
  assert.notEqual(accurateTrialTerms(world,u,after,g).inertiaLinear,0);
  const mesh={nV:3,nT:1,tris:Int32Array.of(0,1,2),triSheet:Int32Array.of(0),
    uv:Float64Array.of(0,0,1,0,0,1),X0:Float64Array.of(0,0,0,1,0,0,0,0,-1)};
  const control=new OrthotropicMembrane(mesh,[{Emd:8,Ecd:8,G12:4,t:1}],{sheets:[{grainDeg:0}]},[0],'double-double','uv-displacement');
  const first=Float64Array.of(1,0,0,-.5,0,1,.5,0,0),last=first.slice();last[0]=2**-54;
  assert.equal(last[0]-first[0],-1);
  const exact=control.energyDifferenceDetails(first,last,latent);assert.equal(exact.valid,true);
  // U(a)=2a²−2a+1 with a=(.5−q0)²; symmetry makes U(1)=U(0),
  // and the leading exact change at q0=2^-54 is +2^-54, retained past rounded subtraction.
  assert.ok(Math.abs(exact.difference-2**-54)<1e-30);
  console.log('membrane-model-coordinates-sub-ulp: nonzero u step with identical public x has positive latent energy/force and exact endpoint remainder; explicit ut/default target arithmetic separated');
});

test('coordinate selectors reject unsupported models without writes and never persist as hidden work mode',()=>{
  const {w,model:m}=fixture(),q=w.x.slice(),u=new Float64Array(q.length),g=new Float64Array(q.length).fill(7),before=g.slice();
  const spring=createOrthotropicElement(uv,material,.37,.293),e=createUVReferenceElement(uv,material,.37,.293,base);
  assert.throws(()=>evaluateOrthotropicElement(spring,u.subarray(0,9),{coordinates:latent}),/requires UV reference/);
  assert.throws(()=>evaluateOrthotropicElement(spring,u.subarray(0,9),{arithmetic:'double-double',coordinates:latent}),/requires UV reference/);
  assert.throws(()=>evaluateOrthotropicElement(e,u.subarray(0,9),{coordinates:latent}),/requires double-double/);
  const baseline=m.energy(q),configuration=structuredClone(m.configuration),configKey=m.configurationKey;
  for(const bad of ['unknown',null,0,{}]){
    for(const run of [()=>m.energy(q,bad),()=>m.addGradient(q,g,bad),()=>m.diagnostics(q,bad),()=>m.energyDifferenceDetails(q,q,bad),
      ()=>m.addGaussNewtonTimes(q,u,g,w.invMass,bad),()=>m.addGaussNewtonBlocks(w,q,w.sys.ch,bad)])assert.throws(run,/invalid coordinate/);
  }
  assert.deepEqual(g,before);m.energy(u,latent);assert.equal(m.energy(q),baseline);assert.deepEqual(m.configuration,configuration);assert.equal(m.configurationKey,configKey);
  assert.equal(Object.hasOwn(m.work,'coordinates'),false);
  const collapsed=w.mesh.X0.map(v=>-v);assert.equal(m.energy(collapsed,latent),Infinity);assert.equal(m.diagnostics(collapsed,latent).finite,false);
  assert.throws(()=>m.addGradient(collapsed,g,latent),/invalid metric/);
  const old=new OrthotropicMembrane(w.mesh,w.materials,w.doc,[.293],'double-double');assert.throws(()=>old.energy(u,latent),/requires UV reference/);
  const binary=new OrthotropicMembrane(w.mesh,w.materials,w.doc,[.293]);assert.throws(()=>binary.addGradient(u,g,latent),/requires UV reference/);
  console.log('membrane-model-coordinates-domain: invalid selectors, old law and binary64 refused; gradient unchanged on selector errors; no configuration/work coordinate-state inference');
});
