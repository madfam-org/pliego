// Ordinary bounded development fixture. Explicitly not an accepted matrix capture.
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
const [repo,out]=process.argv.slice(2);
if(!repo||!out||process.argv.length!==4)throw new Error('usage: node make-selected-newton-test-fixture.mjs REPO FRESH_OUT');
const bench=resolve(repo,'packages/engine/bench');
const {makePatch}=await import(pathToFileURL(resolve(bench,'membrane-patch.mjs')));
const {loadStateModalInputs}=await import(pathToFileURL(resolve(bench,'membrane-state-modal-inputs.mjs')));
const {runStateModalTrajectory}=await import(pathToFileURL(resolve(bench,'membrane-state-modal-audit.mjs')));
const p=loadStateModalInputs(),patch=makePatch({...p.geometry,membraneModel:'orthotropic-stvk',membraneNu12:.293});
const trajectories=[false,true].map(seed=>runStateModalTrajectory(patch,p.reference,{...p.rows.find(r=>r.level===8&&r.budget===4&&r.seed===seed),steps:3},{instrument:true}));
const report={schema:'pliego-selected-newton-small-fixture/1',purpose:'ordinary3judgedsteps+oneexplicitrestorecontrol perstart,4Newtoniterations; dirty development fixture only; not accepted24matrix',
  results:[{geometry:p.geometry,vertices:patch.vertices,triangles:patch.triangles,material:patch.material,trajectories}]};
writeFileSync(out,JSON.stringify(report)+'\n',{flag:'wx',mode:0o600});
console.error('ordinary selected-Newton test fixture:2starts/6judgedsteps/24Newton decisions/2extra restore controls');
