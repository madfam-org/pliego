// Prescribed affine 2D membrane audit. No time integration or production model change.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync, openSync, closeSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { makePatch, measureAffine, affineDisplacement } from './membrane-patch.mjs';
import { MODES, extractTensor, norm, tensorErrors, relativeDifference, symmetricEigenvalues } from './membrane-tensor.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const bench = fileURLToPath(new URL('./', import.meta.url));
const hash = x => createHash('sha256').update(x).digest('hex');
const digest = name => hash(readFileSync(join(bench, name)));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const PYTHON = process.env.PLIEGO_AUDIT_PYTHON || 'python3';
const H = [1e-4, 5e-5, 2.5e-5];
const POLICIES = [
  { name: 'uncapped-symmetric', physicalMembrane: true, membraneCompression: 1 },
  { name: 'uncapped-default-compression', physicalMembrane: true, membraneCompression: 0.05 },
  { name: 'capped-symmetric', physicalMembrane: false, membraneCompression: 1 },
];

function source() {
  const files = [], base = join(root, 'packages/engine/src');
  function visit(dir, prefix = '') {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (e.isDirectory()) visit(join(dir, e.name), prefix + e.name + '/');
      else if (e.name.endsWith('.js')) files.push({ path: prefix + e.name, sha256: hash(readFileSync(join(dir, e.name))) });
    }
  }
  visit(base);
  return { git: git(['rev-parse', 'HEAD']), status: git(['status', '--porcelain']), engineFiles: files,
    harnessSHA256: digest('membrane-audit.mjs'), helperSHA256: digest('membrane-patch.mjs'),
    extractionSHA256: digest('membrane-tensor.mjs'), referenceSHA256: digest('membrane-reference.py'),
    oracleTestsSHA256: digest('test_membrane_reference.py'),
    fixtureBuilderSHA256: hash(readFileSync(join(root, 'packages/engine/test/helpers/docbuilder.js'))) };
}
function python(args, input) {
  // File-backed stdin gives JSON an explicit EOF and avoids large synchronous
  // input-pipe stalls observed on the local Node/macOS research environment.
  const dir=input===undefined?null:mkdtempSync(join(tmpdir(),'pliego-membrane-input-'));
  let fd;
  try {
    if(dir) {const path=join(dir,'input.json');writeFileSync(path,JSON.stringify(input));fd=openSync(path,'r');}
    return execFileSync(PYTHON,[join(bench,'membrane-reference.py'),...args],{
      stdio:[fd===undefined?'ignore':fd,'pipe','pipe'],encoding:'utf8',maxBuffer:32*1024*1024,
      env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},
    });
  } finally {if(fd!==undefined)closeSync(fd);if(dir)rmSync(dir,{recursive:true,force:true});}
}
function globalQ(materialQ, angle) {
  const r = angle * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const t = [[c*c, s*s, c*s], [s*s, c*c, -c*s], [-2*c*s, 2*c*s, c*c-s*s]];
  return t[0].map((_x, i) => t[0].map((_y, j) =>
    t.reduce((sum, row, a) => sum + row[i] * materialQ[a].reduce((n, v, b) => n + v * t[b][j], 0), 0)));
}
function quadratic(q, e, volume) {
  return 0.5 * volume * e.reduce((n, v, i) => n + v * q[i].reduce((s, k, j) => s + k * e[j], 0), 0);
}
// Independent constant-stress boundary traction integral, not CST shape gradients.
function boundaryGradient(patch, q, strain) {
  const sigma = q.map(row => row.reduce((n, v, j) => n + v * strain[j], 0));
  const edges = new Map(), out = patch.vertices.map(() => [0, 0]);
  for (const tri of patch.triangles) for (let k = 0; k < 3; k++) {
    const a = tri[k], b = tri[(k+1)%3], key = [Math.min(a,b), Math.max(a,b)].join(',');
    const old = edges.get(key); if (old) old.count++; else edges.set(key, { a, b, count: 1 });
  }
  for (const { a, b, count } of edges.values()) if (count === 1) {
    const dx = patch.vertices[b][0] - patch.vertices[a][0], dy = patch.vertices[b][1] - patch.vertices[a][1];
    const g = [sigma[0]*dy - sigma[2]*dx, sigma[2]*dy - sigma[1]*dx].map(v => v * patch.material.thickness / 2);
    for (const i of [a,b]) for (let k=0;k<2;k++) out[i][k] += g[k];
  }
  return out;
}
function vectorError(a, b) { return norm(a.map((row,i) => row.map((v,j) => v-b[i][j]))) / Math.max(norm(a), norm(b), Number.MIN_VALUE); }

function nominalDisplacement(patch,strain) {
  return patch.vertices.map(([u,v])=>[strain[0]*u+strain[2]*v/2,strain[1]*v+strain[2]*u/2]);
}
function reference(patch, angle) {
  const inputs=[], descriptions=[];
  const add=(kind,h,key,sign,strain,displacement)=>{
    descriptions.push({kind,h,key,sign,strain});
    inputs.push({material:patch.material,angleDegrees:angle,vertices:patch.vertices,triangles:patch.triangles,displacement});
  };
  add('nominal',H[0],'zero','zero',[0,0,0],nominalDisplacement(patch,[0,0,0]));
  for(const [key,mode] of MODES) for(const [sign,factor] of [['positive',1],['negative',-1]]) {
    const strain=mode.map(v=>v*H[0]*factor);
    add('nominal',H[0],key,sign,strain,nominalDisplacement(patch,strain));
  }
  for(const h of H) for(const [key,mode] of MODES) for(const [sign,factor] of [['positive',1],['negative',-1]]) {
    const strain=mode.map(v=>v*h*factor);
    add('applied',h,key,sign,strain,affineDisplacement(patch,strain));
  }
  const input={cases:inputs},raw=python([],input),data=JSON.parse(raw).cases;
  assert.equal(data.length,descriptions.length);
  const q=globalQ(data[0].engineeringQ,angle),volume=patch.area*patch.material.thickness,byName={};
  assert.ok(symmetricEigenvalues(q).every(v=>v>0),'reference Q must be positive definite');
  assert.equal(data[0].energy,0);
  let maxEnergyError=0,maxGradientError=0,maxAppliedEnergyDrift=0,maxAppliedGradientDrift=0;
  for(let i=0;i<data.length;i++) {
    const d=data[i],description=descriptions[i],strain=description.strain;
    assert.equal(d.vertices,patch.vertices.length);assert.equal(d.referencedVertices,d.vertices);
    assert.equal(d.triangles,patch.triangles.length);assert.equal(d.unusedVertexIndices.length,0);
    assert.ok(Math.abs(d.area-patch.area)<=1e-10*patch.area);
    const expected=quadratic(q,strain,volume);
    const energyError=Math.abs(d.energy-expected)/Math.max(Math.abs(expected),Number.MIN_VALUE);
    const gradientError=vectorError(d.gradient,boundaryGradient(patch,q,strain));
    if(description.kind==='nominal') {
      maxEnergyError=Math.max(maxEnergyError,energyError);maxGradientError=Math.max(maxGradientError,gradientError);
    } else {
      maxAppliedEnergyDrift=Math.max(maxAppliedEnergyDrift,energyError);maxAppliedGradientDrift=Math.max(maxAppliedGradientDrift,gradientError);
      byName[description.h+':'+description.key+':'+description.sign]=d;
    }
  }
  assert.ok(maxEnergyError<=1e-10&&maxGradientError<=1e-10,'nominal affine reference checks failed: '+JSON.stringify({pattern:patch.info.pattern,cells:patch.info.cells,angle,maxEnergyError,maxGradientError}));
  return {q,byName,summary:{
    angleDegrees:angle,material:patch.material,engineeringQMaterial:data[0].engineeringQ,engineeringQGlobal:q,
    inputSHA256:hash(JSON.stringify(input)),outputSHA256:hash(raw),cases:data.length,nominalAffineCases:19,actualAppliedCases:54,
    maxAffineEnergyRelativeError:maxEnergyError,maxBoundaryGradientRelativeError:maxGradientError,
    maxAppliedVsNominalEnergyDrift:maxAppliedEnergyDrift,maxAppliedVsNominalGradientDrift:maxAppliedGradientDrift,
    allVerticesAndTrianglesConsumed:true,oracleValid:true}};
}
function observe(patch, ref, strain, key, sign, h) {
  const value = measureAffine(patch,strain), baseline = ref.byName[h+':'+key+':'+sign];
  const expectedEnergy = baseline.energy, expectedGradient = baseline.gradient;
  assert.ok(value.nonMembraneEnergy === 0 && value.steps === 0 && value.frames === 0 && value.time === 0);
  return { energy: value.energy, referenceEnergy: expectedEnergy,
    appliedDisplacementSHA256:hash(JSON.stringify(affineDisplacement(patch,strain))),
    relativeEnergyError: Math.abs(value.energy-expectedEnergy)/Math.abs(expectedEnergy),
    nodalGradientRelativeError: vectorError(value.gradient,expectedGradient),
    generalizedGradient: value.generalizedGradient, interiorResidual: value.interiorResidual,
    interiorResidualRelativeToReferenceGradientNorm: value.interiorResidual.l2 / norm(expectedGradient),
    statsEnergy: value.statsEnergy, statsEnergyDelta: value.statsEnergyDelta,
    statsEnergyRelativeDelta: value.statsEnergyRelativeDelta, statsEnergyScaledDelta: value.statsEnergyScaledDelta,
    statsEnergyScale: value.statsEnergyScale, statsAgreementTolerance: value.statsAgreementTolerance,
    referenceInteriorMaximum: Math.max(0,...patch.interiorIndices.map(i=>Math.hypot(...expectedGradient[i]))),
    maxStrain: value.maxStrain, maxCompression: value.maxCompression };
}
function runCase(patch, policy, ref) {
  const amplitudes = [];
  for (const h of H) {
    const zero = measureAffine(patch,[0,0,0]);
    assert.equal(zero.energy,0);
    const modes = {}, energies = { zero: zero.energy };
    for (const [key, direction] of MODES) {
      modes[key] = {}; energies[key] = {};
      for (const [sign,factor] of [['positive',1],['negative',-1]]) {
        modes[key][sign] = observe(patch,ref,direction.map(v=>v*h*factor),key,sign,h);
        energies[key][sign] = modes[key][sign].energy;
      }
    }
    const tensor = policy.membraneCompression === 1 ? extractTensor(energies,patch.area*patch.material.thickness,h) : null;
    amplitudes.push({ h, zeroEnergy: zero.energy, modes, tensor,
      tensorErrors: tensor ? tensorErrors(tensor,ref.q) : null });
  }
  const finest = amplitudes.at(-1), previous = amplitudes.at(-2);
  const halving = amplitudes.slice(1).map((current,i) => current.tensor ? ({
    fromH:amplitudes[i].h,toH:current.h,relativeFrobeniusChange:relativeDifference(current.tensor,amplitudes[i].tensor),
    maximumEntryChangeNormalizedToQ:Math.max(...current.tensor.flatMap((row,j)=>row.map((v,k)=>Math.abs(v-amplitudes[i].tensor[j][k])/Math.sqrt(ref.q[j][j]*ref.q[k][k])))) }) : null);
  const drift = finest.tensor ? relativeDifference(finest.tensor,previous.tensor) : null;
  const maxEnergyError = Math.max(...Object.values(finest.modes).flatMap(m=>[m.positive.relativeEnergyError,m.negative.relativeEnergyError]));
  return { policy: policy.name, options: patch.options, fixtureSHA256: patch.fixtureSHA256,
    meshSHA256: patch.meshSHA256, mesh: patch.info, material: patch.material,
    amplitudes, strainHalving:halving, strainHalvingRelativeTensorChange: drift, maximumSignedEnergyError: maxEnergyError,
    gates: { measurementValid: true, strainExtraction: drift === null ? 'not applicable to asymmetric compression' : halving.every(v=>v.relativeFrobeniusChange<=1e-4 && v.maximumEntryChangeNormalizedToQ<=1e-4),
      centralForceIdentity: finest.tensor ? finest.tensorErrors.centralForceC12MinusC66Normalized <= 1e-4 : 'not applicable to asymmetric compression',
      tensorFrobenius1Percent: finest.tensor ? finest.tensorErrors.relativeFrobenius <= .01 : 'no unique zero-strain tensor',
      tensorEntries1Percent: finest.tensor ? finest.tensorErrors.maximumNormalizedEntryError <= .01 : 'no unique zero-strain tensor',
      signedEnergy1Percent: maxEnergyError <= .01, physicalStockCalibration: 'not measured', interactionPerformance: 'not measured' } };
}
function meshComparisons(rows) {
  const comparisons = [];
  const active = rows.filter(r=>r.amplitudes.at(-1).tensor);
  const tensor = r=>r.amplitudes.at(-1).tensor;
  for (const a of active) for (const b of active) {
    if (a.policy!==b.policy || a.mesh.grain!==b.mesh.grain) continue;
    if (a.mesh.pattern===b.mesh.pattern && a.mesh.cells===8 && b.mesh.cells===16)
      comparisons.push({ kind:'mesh-refinement',policy:a.policy,grain:a.mesh.grain,pattern:a.mesh.pattern,
        fromCells:8,toCells:16,relativeTensorChange:relativeDifference(tensor(a),tensor(b)),threshold:.005 });
    if (a.mesh.cells===16 && b.mesh.cells===16 && a.mesh.pattern<b.mesh.pattern)
      comparisons.push({ kind:'topology',policy:a.policy,grain:a.mesh.grain,cells:16,
        patterns:[a.mesh.pattern,b.mesh.pattern],relativeTensorChange:relativeDifference(tensor(a),tensor(b)),threshold:.01 });
  }
  for(const c of comparisons)c.pass=c.relativeTensorChange<=c.threshold;
  return comparisons;
}
export function runAudit({ allowDirty=false, smoke=false }={}) {
  const start=source(); assert.ok(allowDirty || !start.status,'clean checkout required; --allow-dirty is development-only');
  const selfTestRaw=python(['--self-test']), selfTest=JSON.parse(selfTestRaw);
  assert.equal(selfTest.passed,true);assert.ok(selfTest.testCases>0 && selfTest.checks.affineCases>0);
  const rows=[], references=[], cache=new Map(), topology=new Map();
  for(const pattern of smoke?['forward','alternating']:['forward','alternating','perturbed'])
    for(const cells of smoke?[2,4]:[4,8,16]) for(const grain of smoke?[0,45]:[0,30,45,90]) for(const policy of POLICIES) {
      const patch=makePatch({cells,pattern,grain,...policy});
      const topologyKey=pattern+':'+cells, nativeKey=JSON.stringify(patch.info.nativeByteFingerprints);
      if(topology.has(topologyKey))assert.equal(nativeKey,topology.get(topologyKey),'grain or policy changed native topology/rest pose');
      else topology.set(topologyKey,nativeKey);
      const refKey=patch.meshSHA256+':'+grain;
      if(!cache.has(refKey)) { const ref=reference(patch,grain);cache.set(refKey,ref);references.push({meshSHA256:patch.meshSHA256,...ref.summary}); }
      rows.push(runCase(patch,policy,cache.get(refKey)));
    }
  assert.deepEqual(source(),start,'source changed during audit; discard measurements');
  const comparisons=meshComparisons(rows), symmetric=rows.filter(r=>r.amplitudes.at(-1).tensor);
  return { schema:'pliego-membrane-audit/0.1',recordedAt:new Date().toISOString(),
    source:{...start,dirty:!!start.status,status:undefined},runtime:{node:process.version,python:execFileSync(PYTHON,['--version'],{encoding:'utf8'}).trim(),arch:process.arch,platform:process.platform},
    protocol:{scope:'All-node prescribed affine energy/reaction audit, not a solved boundary-value patch test; zero World.step/substeps/time/contact/inertia/non-membrane energy; no performance or physical-stock acceptance',
      units:{length:'mm',stress:'microN/mm^2 = Pa',energy:'nJ',gradient:'microN = dU/d(displacement)',tensor:'microN/mm^2'},
      referenceConvention:'Synthetic nu12=.293; nu21=nu12*E2/E1; matches current directional membrane compliance; existing stock nu/bending geometric-mean convention remains unresolved',
      referenceInputRepresentation:'Python CST evaluates 19 mathematical nominal-affine cases at h0 for strict analytical energy/traction verification, then all 54 actual binary64 applied displacement vectors at the three amplitudes for engine comparison. Pose addition/subtraction rounding can make actual fields slightly nonaffine; nominal-vs-applied drifts are recorded, not mistaken for oracle inconsistency. No finer-amplitude reference scaling.',
      engineeringStrain:['exx','eyy','gamma=2exy'],amplitudes:H,policies:POLICIES,modes:MODES,smoke,
      thresholds:{oracle:1e-10,strainHalving:1e-4,centralForceIdentity:1e-4,tensorRelativeFrobenius:.01,tensorEntryNormalized:.01,signedEnergy:.01,meshRefinement:.005,topology:.01},
      normalization:'Tensor entry error / sqrt(Qii*Qjj); tensor error / norm(Q); tensor change / max(norm(A),norm(B)); zero target entries never divide by themselves; central-force invariant / norm(actual measured tensor). Gradient error / max(norm(actual),norm(target)).',
      expectedCentralForceIdentity:'Derived diagnostic C12=C66 for stress-free affine scalar central-force springs, compression=1, h->0; not an engineering-accuracy gate'},
    oracleSelfTest:{result:selfTest,outputSHA256:hash(selfTestRaw)},references,results:rows,meshComparisons:comparisons,
    gates:{oracleValid:references.every(r=>r.oracleValid),sourceClean:!start.status,completeMatrix:!smoke&&rows.length===108,
      fixedTopologyAcrossGrainAndPolicies:true,noTimeIntegration:true,allExtractionValid:symmetric.every(r=>r.gates.strainExtraction),
      centralForceIdentityObserved:symmetric.every(r=>r.gates.centralForceIdentity),
      symmetricConstitutiveAccuracy:symmetric.every(r=>r.gates.tensorFrobenius1Percent&&r.gates.tensorEntries1Percent&&r.gates.signedEnergy1Percent),
      allSignedEnergiesWithin1Percent:rows.every(r=>r.gates.signedEnergy1Percent),
      meshAndTopology:comparisons.length>0&&comparisons.every(c=>c.pass),
      physicalStockCalibration:'not measured',interactionPerformance:'not measured'},
    acceptance:'Audit completion retains engineering failures. Numerical force convergence, bit-exact replay and faster backends cannot close a constitutive mismatch; synthetic reference is not measured paper.' };
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), index=args.indexOf('--out'), path=index>=0?resolve(args[index+1]||''):null;
  assert.ok(args.every((v,i)=>['--out','--allow-dirty','--smoke'].includes(v)||(index>=0&&i===index+1)),'unknown argument');
  if(path) { assert.ok(!path.startsWith(root),'write audit outputs outside checkout');assert.ok(!existsSync(path),'refuse to overwrite existing audit'); }
  const report=runAudit({allowDirty:args.includes('--allow-dirty'),smoke:args.includes('--smoke')});
  const output=JSON.stringify(report,null,2)+'\n';
  if(path)writeFileSync(path,output);else process.stdout.write(output);
  console.error('membrane-audit: cases='+report.results.length+' references='+report.references.length+' oracle='+report.gates.oracleValid+' constitutive='+report.gates.symmetricConstitutiveAccuracy+'; no steps, no material/device certificate');
}
