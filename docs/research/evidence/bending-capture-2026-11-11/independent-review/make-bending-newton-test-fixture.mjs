// Ordinary bounded development fixture for the bending selected-Newton reviewer.
// Explicitly not an accepted matrix capture: a few real steps of the level-1 budget-4 and budget-16
// rows (both previous-pose starts), exact-hessian membrane curvature, half-tau PCG stop.
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const [repo,out]=process.argv.slice(2);
if(!repo||!out||process.argv.length!==4)throw new Error('usage: node make-bending-newton-test-fixture.mjs REPO FRESH_OUT');
const STEPS=4,bench=resolve(repo,'packages/engine/bench');
const {loadBendingStateInputs}=await import(pathToFileURL(resolve(bench,'bending-state-inputs.mjs')));
const {runBendingStateTrajectory}=await import(pathToFileURL(resolve(bench,'bending-state-audit.mjs')));
const inputs=loadBendingStateInputs(),trajectories=[];
for(const budget of [4,16])for(const seed of [false,true]){
  const row={...inputs.rows.find(r=>r.level===1&&r.budget===budget&&r.seed===seed),steps:STEPS};
  trajectories.push(runBendingStateTrajectory(inputs,row,{instrument:true,membraneCurvature:'exact-hessian',pcgStop:'half-force-tolerance'}));
}
const git=(...a)=>execFileSync('git',a,{cwd:repo,encoding:'utf8'}).trim();
const report={schema:'pliego-selected-newton-bending-small-fixture/1',
  purpose:'ordinary '+STEPS+' judged steps per row (level 1, budgets 4 and 16, both starts) plus one explicit restore control per row; development fixture from a possibly dirty lane checkout; not the accepted 24-row matrix',
  sourceAtBuild:{git:git('rev-parse','HEAD'),dirty:git('status','--porcelain')!=='',scope:'informational only; the fixture is not a clean capture'},
  protocol:{membraneCurvature:'exact-hessian',pcgStop:'half-force-tolerance',steps:STEPS,instrument:true},
  results:[{geometry:inputs.geometry,vertices:inputs.vertices,triangles:inputs.triangles,material:inputs.material,mesh:inputs.mesh,reference:inputs.reference,trajectories}]};
writeFileSync(out,JSON.stringify(report)+'\n',{flag:'wx',mode:0o600});
const events=trajectories.reduce((s,t)=>s+t.solveObservation.trace.length,0);
console.error('ordinary bending selected-Newton fixture: '+trajectories.length+' rows/'+trajectories.length*STEPS+' judged steps/'+events+' Newton decisions; snapshot roles '+trajectories.map(t=>Object.keys(t.solveObservation.snapshots).length).join('+'));
