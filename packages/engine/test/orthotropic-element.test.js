import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrthotropicElement, evaluateOrthotropicElement, OrthotropicMembrane } from '../src/xpbd/orthotropic-membrane.js';
import { BlockCholesky } from '../src/linalg/blockchol.js';

const material = { E1: 5.5e9, E2: 2.5e9, G12: 0.387 * Math.sqrt(5.5e9 * 2.5e9), thickness: 0.1 };
const uv = [0, 0, 2, 0.2, 0.3, 1.5];
const norm = a => Math.hypot(...a);
const relative = (a, b) => norm(a.map((v, i) => v - b[i])) / Math.max(1, norm(a), norm(b));
const pose = coords => Float64Array.from(coords.flatMap(([u, v]) => [1.04 * u + 0.03 * v, 0.07 * u - 0.04 * v, -0.97 * v - 0.02 * u]));
const coordinates = [uv.slice(0, 2), uv.slice(2, 4), uv.slice(4, 6)];
function rotation(angle) {
  const n = Math.sqrt(14), [x, y, z] = [1 / n, 2 / n, 3 / n], c = Math.cos(angle), s = Math.sin(angle), d = 1 - c;
  return [c + x*x*d, x*y*d-z*s, x*z*d+y*s, y*x*d+z*s, c+y*y*d, y*z*d-x*s, z*x*d-y*s, z*y*d+x*s, c+z*z*d];
}
const rotateVector = (r, x) => [0, 1, 2].map(i => r[3*i]*x[0]+r[3*i+1]*x[1]+r[3*i+2]*x[2]);
function rotatePose(r, x, shift = [0, 0, 0]) {
  return Float64Array.from([0, 1, 2].flatMap(i => rotateVector(r, x.subarray(3*i, 3*i+3)).map((v, k) => v + shift[k])));
}
const multiply = (a, p) => Float64Array.from(p, (_v, i) => p.reduce((s, v, j) => s + a[9*i+j]*v, 0));
const quadratic = (a, p) => multiply(a, p).reduce((s, v, i) => s + p[i]*v, 0);

test('objective orthotropic element preserves energy and covariant derivatives under finite 3D rotations and translations', () => {
  let cases = 0, worst = 0;
  const rest = Float64Array.from(coordinates.flatMap(([u,v]) => [u, 0, -v]));
  for (const grain of [0, Math.PI/6, Math.PI/4, Math.PI/2, 0.713]) {
    const element = createOrthotropicElement(uv, material, grain, 0.293), x = pose(coordinates);
    const base = evaluateOrthotropicElement(element, x), initial = evaluateOrthotropicElement(element, rest);
    assert.ok(initial.energy < 1e-20 * element.volume * material.E1);
    assert.ok(norm(initial.gradient) < 1e-12 * material.E1 * material.thickness);
    const net = [0,0,0], moment = [0,0,0];
    for (let i=0;i<3;i++) {
      const p=x.subarray(3*i,3*i+3), g=base.gradient.subarray(3*i,3*i+3);
      for(let k=0;k<3;k++) net[k]+=g[k];
      moment[0]+=p[1]*g[2]-p[2]*g[1]; moment[1]+=p[2]*g[0]-p[0]*g[2]; moment[2]+=p[0]*g[1]-p[1]*g[0];
    }
    assert.ok(norm(net) < 1e-13 * norm(base.gradient));
    assert.ok(norm(moment) < 1e-13 * norm(base.gradient)*norm(x));
    for (const angle of [0.43, Math.PI, -2.17]) {
      const r=rotation(angle), moved=evaluateOrthotropicElement(element,rotatePose(r,x,[3.1,-2.3,4.7]));
      const energyError=Math.abs(moved.energy-base.energy)/base.energy;
      assert.ok(energyError<1e-12, `rotation energy error=${energyError}`);
      const rotatedGradient=Float64Array.from([0,1,2].flatMap(i=>rotateVector(r,base.gradient.subarray(3*i,3*i+3))));
      assert.ok(relative(moved.gradient,rotatedGradient)<1e-12);
      const expected=new Float64Array(81);
      for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let a=0;a<3;a++)for(let b=0;b<3;b++) {
        let sum=0;
        for(let c=0;c<3;c++)for(let d=0;d<3;d++)sum+=r[3*a+c]*base.hessian[9*(3*i+c)+3*j+d]*r[3*b+d];
        expected[9*(3*i+a)+3*j+b]=sum;
      }
      const hError=relative(moved.hessian,expected); worst=Math.max(worst,energyError,hError);
      assert.ok(hError<1e-12); cases++;
    }
  }
  console.log(`orthotropic-element: finite 3D rotation/translation cases=${cases}; worst energy/Hessian covariance error=${worst}; exact force/moment balance; no fixed-normal rejection`);
});

test('exact orthotropic gradient and Hessian match finite differences with step halving; GN is a separate PSD approximation', () => {
  let cases=0, worstGradient=0, worstHessian=0;
  for(const grain of [0,0.37,Math.PI/4,Math.PI/2]) {
    const element=createOrthotropicElement(uv,material,grain,0.293), x=pose(coordinates), observed=evaluateOrthotropicElement(element,x);
    let previousGradient=Infinity, previousHessian=Infinity;
    for(const h of [1e-3,5e-4,2.5e-4,1.25e-4,6.25e-5]) {
      const gFD=new Float64Array(9), hFD=new Float64Array(81);
      for(let j=0;j<9;j++) {
        const a=x.slice(),b=x.slice();a[j]+=h;b[j]-=h;
        const plus=evaluateOrthotropicElement(element,a),minus=evaluateOrthotropicElement(element,b);
        gFD[j]=(plus.energy-minus.energy)/(2*h);
        for(let i=0;i<9;i++)hFD[9*i+j]=(plus.gradient[i]-minus.gradient[i])/(2*h);
      }
      const ge=relative(gFD,observed.gradient),he=relative(hFD,observed.hessian);
      assert.ok(ge<1e-4 && he<1e-5,`derivative errors gradient=${ge} Hessian=${he}`);
      assert.ok(ge<=0.3*previousGradient+1e-10 && he<=0.3*previousHessian+1e-10,'halving must approach analytic derivatives');
      previousGradient=ge;previousHessian=he;cases++;
    }
    assert.ok(previousGradient<1e-7 && previousHessian<1e-8,'finest finite differences must resolve exact derivatives');
    worstGradient=Math.max(worstGradient,previousGradient);worstHessian=Math.max(worstHessian,previousHessian);
    for(let i=0;i<9;i++)for(let j=0;j<9;j++)assert.ok(Math.abs(observed.hessian[9*i+j]-observed.hessian[9*j+i])<1e-14*norm(observed.hessian));
    for(let c=0;c<3;c++) {
      const translation=Float64Array.from({length:9},(_v,i)=>i%3===c?1:0);
      assert.ok(norm(multiply(observed.hessian,translation))<1e-14*norm(observed.hessian));
    }
    for(let sample=0;sample<24;sample++) {
      const direction=Float64Array.from({length:9},(_v,i)=>Math.sin(0.43*i+sample));
      assert.ok(quadratic(observed.gaussNewton,direction)>=-1e-14*norm(observed.gaussNewton)*norm(direction)**2);
    }
  }
  const element=createOrthotropicElement(uv,material,0,0.293);
  const compressed=Float64Array.from(coordinates.flatMap(([u,v])=>[0.8*u,0,-0.8*v]));
  const result=evaluateOrthotropicElement(element,compressed), normal=Float64Array.of(0,0,0,0,1,0,0,0,0);
  const exactDirection=quadratic(result.hessian,normal),gnDirection=quadratic(result.gaussNewton,normal);
  assert.ok(exactDirection<0,'compressed exact stress curvature must remain visible');
  assert.equal(gnDirection,0,'GN omits geometric stress curvature');
  const twice=createOrthotropicElement(uv,{...material,thickness:2*material.thickness},0,0.293);
  assert.equal(evaluateOrthotropicElement(twice,compressed).energy,2*result.energy);
  console.log(`orthotropic-element: derivative halving cases=${cases}; finest relative errors gradient=${worstGradient} exactHessian=${worstHessian}; compressed exact Rayleigh=${exactDirection}, PSD GN=${gnDirection}`);
});

function meshFixture() {
  // Nonmonotone triangle IDs exercise transposed block slots.
  return { nV:3,nT:1,tris:Int32Array.of(2,0,1),triSheet:Int32Array.of(0),
    uv:Float64Array.of(2,0.2,0.3,1.5,0,0) };
}
function membraneFixture() {
  const mesh=meshFixture(),m={Emd:material.E1,Ecd:material.E2,G12:material.G12,t:material.thickness};
  return new OrthotropicMembrane(mesh,[m],{sheets:[{grainDeg:27}]},[0.293]);
}
test('runtime triangle assembly and matrix-free GN agree with exact element GN for fixed/free masks and transposed slots', () => {
  const membrane=membraneFixture(),mesh=membrane.mesh;
  const coords=[Array.from(mesh.uv.subarray(0,2)),Array.from(mesh.uv.subarray(2,4)),Array.from(mesh.uv.subarray(4,6))],x=pose(coords);
  const g=new Float64Array(9);membrane.addGradient(x,g);
  const element=membrane.elements[0],local=Float64Array.from(Array.from(mesh.tris).flatMap(v=>Array.from(x.subarray(3*v,3*v+3))));
  const exact=evaluateOrthotropicElement(element,local);
  assert.equal(membrane.energy(x),exact.energy);
  for(let i=0;i<3;i++)for(let c=0;c<3;c++)assert.equal(g[3*mesh.tris[i]+c],exact.gradient[3*i+c]);
  for(const mask of [[1,1,1],[1,0,1]]) {
    const invMass=Float64Array.from(mask),fi=Int32Array.from(mask,()=>-1);let n=0;
    for(let i=0;i<3;i++)if(mask[i])fi[i]=n++;
    const pairs=[];for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)pairs.push([i,j]);
    const ch=new BlockCholesky(n,pairs),none=-2147483648;
    const slot=(i,j)=>fi[i]<0||fi[j]<0?none:ch.slot(fi[i],fi[j]);
    const sys={diagSlot:Int32Array.from([0,1,2],i=>slot(i,i)),membraneSlots:Int32Array.of(slot(2,0),slot(2,1),slot(0,1))};
    membrane.addGaussNewtonBlocks({sys},x,ch);
    const p=Float64Array.from({length:9},(_v,i)=>Math.sin(i+0.7)),out=new Float64Array(9);
    membrane.addGaussNewtonTimes(x,p,out,invMass);
    const assembled=new Float64Array(9),elementProduct=new Float64Array(9);
    for(let i=0;i<3;i++)if(mask[i])for(let j=0;j<3;j++)if(mask[j]) {
      const s=slot(i,j),offset=s>=0?s:-s-1;
      for(let r=0;r<3;r++)for(let c=0;c<3;c++)assembled[3*i+r]+=ch.Ax[offset+(s>=0?3*r+c:3*c+r)]*p[3*j+c];
    }
    for(let i=0;i<3;i++)if(mask[mesh.tris[i]])for(let j=0;j<3;j++)if(mask[mesh.tris[j]])for(let r=0;r<3;r++)for(let c=0;c<3;c++)elementProduct[3*mesh.tris[i]+r]+=exact.gaussNewton[9*(3*i+r)+3*j+c]*p[3*mesh.tris[j]+c];
    assert.ok(relative(out,assembled)<1e-14);assert.ok(relative(out,elementProduct)<1e-14);
    for(let i=0;i<3;i++)if(!mask[i])assert.deepEqual(out.subarray(3*i,3*i+3),new Float64Array(3));
  }
  assert.equal(membrane.configurationKey,membraneFixture().configurationKey);
  console.log('orthotropic-element: runtime energy/gradient match element; GN assembly/operator/element agreement including fixed-mask elimination and transposed slots');
});

test('reference conditioning and current collapse fail visibly while energy trials return Infinity and rigid flips stay valid', () => {
  assert.throws(()=>createOrthotropicElement([0,0,1,0,1,1e-14],material,0,0.293),/ill-conditioned/);
  assert.throws(()=>createOrthotropicElement([0,0,0,1,1,0],material,0,0.293),/reversed/);
  assert.throws(()=>createOrthotropicElement(uv,material,0,2),/positive-definite/);
  assert.throws(()=>createOrthotropicElement(uv,{...material,G12:0},0,0.293),/positive finite/);
  const membrane=membraneFixture(),collapsed=new Float64Array(9);
  assert.equal(membrane.energy(collapsed),Infinity);assert.equal(membrane.diagnostics(collapsed).invalidTriangles,1);
  assert.throws(()=>membrane.addGradient(collapsed,new Float64Array(9)),/collapsed/);
  assert.throws(()=>membrane.addGaussNewtonTimes(collapsed,new Float64Array(9),new Float64Array(9)),/collapsed/);
  const x=Float64Array.from([2,0,-0.2,0.3,0,-1.5,0,0,0]);
  const flipped=Float64Array.from(x,(_v,i)=>i%3===2?-x[i]:x[i]);
  assert.ok(Number.isFinite(membrane.energy(flipped)));assert.equal(membrane.diagnostics(flipped).finite,true);
  x[0]=Infinity;assert.equal(membrane.energy(x),Infinity);assert.equal(membrane.diagnostics(x).finite,false);
  console.log('orthotropic-element: ill-conditioned/reversed reference and indefinite Q rejected; collapsed/nonfinite trial energy Infinity; derivatives fail; valid 180-degree turn accepted');
});

test('principal metric diagnostics match known stretches and remain finite at extreme representable energies', () => {
  const unitUV=[0,0,1,0,0,1];
  const element=createOrthotropicElement(unitUV,material,0,0.293);
  const x=Float64Array.of(0,0,0,1.2,0,0,0,0,-0.7);
  for(const position of [x,rotatePose(rotation(1.37),x,[2,-3,4])]) {
    const result=evaluateOrthotropicElement(element,position);
    assert.ok(Math.abs(result.maximumStretch-1.2)<1e-14);
    assert.ok(Math.abs(result.minimumStretch-0.7)<1e-14);
    assert.ok(Math.abs(result.areaRatio-0.84)<1e-14);
  }
  const soft={E1:1e-308,E2:1e-308,G12:1e-308,thickness:0.001};
  const extreme=createOrthotropicElement(unitUV,soft,0,0);
  const stretched=Float64Array.of(0,0,0,1e154,0,0,0,1,0);
  const result=evaluateOrthotropicElement(extreme,stretched);
  assert.ok(Number.isFinite(result.energy));
  assert.ok(Math.abs(result.energy/6.25e303-1)<1e-14);
  assert.equal(result.maximumStretch,1e154);assert.equal(result.minimumStretch,1);
  assert.equal(result.areaRatio,1e154);
  const mesh={nV:3,nT:1,tris:Int32Array.of(0,1,2),triSheet:Int32Array.of(0),uv:Float64Array.from(unitUV)};
  const membrane=new OrthotropicMembrane(mesh,[{Emd:soft.E1,Ecd:soft.E2,G12:soft.G12,t:soft.thickness}],{sheets:[{grainDeg:0}]},[0]);
  const diagnostics=membrane.diagnostics(stretched);
  assert.equal(diagnostics.finite,true);assert.equal(diagnostics.invalidTriangles,0);
  assert.equal(diagnostics.maximumStretch,1e154);assert.equal(diagnostics.minimumStretch,1);
  for(const value of Object.values(diagnostics))if(typeof value==='number')assert.ok(Number.isFinite(value));
  const overflow=stretched.slice();overflow[3]=1.4e154;
  assert.equal(membrane.energy(overflow),Infinity);assert.equal(membrane.diagnostics(overflow).finite,false);
  console.log('orthotropic-element: analytical stretches/area verified under 3D rotation; finite 6.25e303 nJ extreme has finite 1e154/1 principal stretches; unrepresentable state rejected');
});
