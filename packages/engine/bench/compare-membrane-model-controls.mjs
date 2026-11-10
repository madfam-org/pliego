// Reviewed migration to a new opt-in law must preserve the entire old-law audit.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),oi=args.indexOf('--out');
assert.ok(oi<0||(oi===2&&args.length===4),'old baseline and new composite followed by optional --out required');
const paths=oi<0?args:args.slice(0,oi);assert.equal(paths.length,2);
const bytes=paths.map(p=>readFileSync(p)),[old,composite]=bytes.map(b=>JSON.parse(b)),fresh=composite.controls;
const sha=b=>createHash('sha256').update(b).digest('hex');
const root=fileURLToPath(new URL('../../../',import.meta.url)),base=join(root,'packages/engine/src'),files=[];
function visit(dir,prefix=''){for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
  if(e.isDirectory())visit(join(dir,e.name),prefix+e.name+'/');
  else if(e.name.endsWith('.js'))files.push({path:prefix+e.name,sha256:sha(readFileSync(join(dir,e.name)))});
}}
visit(base);
assert.equal(old.schema,'pliego-membrane-audit/0.1');assert.equal(composite.schema,'pliego-orthotropic-audit/0.1');
assert.equal(fresh.schema,old.schema);assert.equal(old.source.dirty,false);assert.equal(fresh.source.dirty,false);assert.equal(composite.source.dirty,false);
assert.equal(old.source.git,'f145538f8200563ff110439f006605882050d2ba','only reviewed historical source');
assert.equal(old.source.helperSHA256,'b49fccf52927247ee034531c738450b7a49bf1874093a56d3c09f8d710c156b0','only reviewed historical helper');
assert.equal(old.source.harnessSHA256,'53acc3eb697974b5ad91c6b6d8d6ec617baae22a2853217cdbe3efd971b92564','baseline harness unchanged');
assert.equal(fresh.source.git,composite.source.git);
assert.equal(fresh.source.git,execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),'new report must match current pinned checkout');
assert.deepEqual(fresh.source.engineFiles,files,'current runtime fingerprint required');assert.deepEqual(composite.source.engineFiles,files);
assert.equal(fresh.source.helperSHA256,sha(readFileSync(new URL('membrane-patch.mjs',import.meta.url))));
assert.equal(composite.source.patchHelperSHA256,fresh.source.helperSHA256);
const mutable=new Set(['xpbd/world.js','xpbd/implicit.js','xpbd/pcg.js','xpbd/energy-search.js','xpbd/state.js']);
const additions=new Set(['xpbd/orthotropic-membrane.js','xpbd/increment-search.js','xpbd/double-double.js','xpbd/accurate-membrane.js','xpbd/uv-reference.js','xpbd/newton.js','xpbd/reference-state.js']);
const previous=new Map(old.source.engineFiles.map(f=>[f.path,f.sha256]));
for(const f of files)if(!mutable.has(f.path)&&!additions.has(f.path))assert.equal(f.sha256,previous.get(f.path),'unreviewed runtime change: '+f.path);
assert.equal(files.length,old.source.engineFiles.length+additions.size);
for(const path of additions)assert.ok(files.some(f=>f.path===path)&&!previous.has(path),'only the seven named reviewed modules may be added');
for(const f of old.source.engineFiles)assert.ok(files.some(g=>g.path===f.path),'old runtime path removed');
const comparable=r=>{
  const c=structuredClone(r);delete c.recordedAt;
  delete c.source.git;delete c.source.engineFiles;delete c.source.helperSHA256;
  return c;
};
assert.deepEqual(comparable(old),comparable(fresh),'whole old-law audit except reviewed git/runtime/helper fingerprints must remain exact');
const result={schema:'pliego-membrane-model-controls/0.1',recordedAt:new Date().toISOString(),comparisonSHA256:sha(readFileSync(new URL(import.meta.url))),
  inputSHA256:bytes.map(sha),sources:[old.source,composite.source],cases:fresh.results.length,allRecordedControlFieldsEqual:true,
  migration:'only f145 historical source/helper to current pinned runtime; five named integration files plus the orthotropic-membrane, increment-search, double-double, accurate-membrane uv-reference, newton and reference-state modules may change, baseline harness unchanged; all other source/runtime/input/geometry/reference/energy/gradient/tensor/diagnostic/gates exact',
  acceptance:'unchanged legacy controls only; new-law acceptance requires its separate independent reference and remaining integration/material/device gates'};
const output=JSON.stringify(result,null,2)+'\n';if(oi>=0)writeFileSync(args[oi+1],output);else process.stdout.write(output);
console.error('membrane-model-controls: '+result.cases+' cases; every recorded old-law non-recording field preserved');
