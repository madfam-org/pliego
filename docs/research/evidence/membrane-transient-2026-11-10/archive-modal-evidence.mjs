// Lossless storage of source-identical captures; complete original bytes reconstruct.
import assert from 'node:assert/strict';
import{readFileSync,writeFileSync,mkdirSync}from'node:fs';
import{join,basename,resolve}from'node:path';
import{createHash}from'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const [mode,inputDirectory,outputDirectory]=process.argv.slice(2);
assert.ok(['--build','--reconstruct'].includes(mode)&&inputDirectory&&outputDirectory,'--build|--reconstruct inputDirectory outputDirectory');
assert.notEqual(resolve(inputDirectory),resolve(outputDirectory),'separate output directory required');
mkdirSync(outputDirectory,{mode:0o700}); // Exclusive fresh directory; never reuse a file, directory or symlink.
const write=(name,bytes)=>{assert.equal(name,basename(name));writeFileSync(join(outputDirectory,name),bytes,{flag:'wx'});};
function pathsFor(report,kind){
 const paths=[['recordedAt']];if(kind==='repeat')return paths;assert.equal(kind,'observer');
 paths.push(['protocol','instrument'],['protocol','perNewtonLinearDiagnostics'],['gates','perNewtonLinearDiagnostics']);
 report.results.forEach((c,i)=>c.trajectories.forEach((_t,j)=>{paths.push(['results',i,'trajectories',j,'solveObservation'],['results',i,'trajectories',j,'gates','perNewtonLinearDiagnostics']);}));
 return paths;
}
function get(value,path){for(const key of path){assert.ok(Object.hasOwn(value,key),'existing declared path required');value=value[key];}return value;}
function reconstruct(baseBytes,descriptor){
 assert.equal(descriptor.schema,'pliego-modal-capture-delta/0.1');assert.equal(sha(baseBytes),descriptor.baseSHA256);
 const base=JSON.parse(baseBytes);assert.equal(base.schema,'pliego-membrane-modal-audit/0.1');assert.equal(base.source.dirty,false);
 const allowed=pathsFor(base,descriptor.kind);assert.deepEqual(descriptor.replacements.map(x=>x.path),allowed,'only timestamp or proven observer metadata may differ');
 for(const replacement of descriptor.replacements){const parent=get(base,replacement.path.slice(0,-1)),key=replacement.path.at(-1);assert.ok(Object.hasOwn(parent,key));parent[key]=replacement.value;}
 const bytes=Buffer.from(JSON.stringify(base)+'\n');assert.equal(bytes.length,descriptor.targetBytes);assert.equal(sha(bytes),descriptor.targetSHA256,'complete reconstructed original bytes must match');return bytes;
}
if(mode==='--build'){
 const baseName='diagnostic.json',baseBytes=readFileSync(join(inputDirectory,baseName)),base=JSON.parse(baseBytes);
 assert.equal(base.source.dirty,false);assert.equal(base.gates.sourceClean,true);assert.equal(base.protocol.instrument,true);
 write(baseName,baseBytes);const records=[{file:baseName,representation:'complete original',sha256:sha(baseBytes),originalBytes:baseBytes.length,storedBytes:baseBytes.length,allOriginalBytesExact:true}];
 for(const [name,kind]of [['diagnostic-repeat','repeat'],['diagnostic-uninstrumented','observer']]){
  const raw=readFileSync(join(inputDirectory,name+'.json')),target=JSON.parse(raw);assert.equal(target.source.dirty,false);
  const descriptor={schema:'pliego-modal-capture-delta/0.1',kind,base:baseName,baseSHA256:sha(baseBytes),target:name+'.json',targetSHA256:sha(raw),targetBytes:raw.length,
   replacements:pathsFor(base,kind).map(path=>({path,value:get(target,path)})),
   scope:'lossless reconstruction of the entire captured JSON byte stream; no field/trace/failure removed; only already verified timestamp or observer-metadata differences stored'};
  assert.ok(reconstruct(baseBytes,descriptor).equals(raw),'actual source bytes must equal reconstruction');
  const descriptorBytes=Buffer.from(JSON.stringify(descriptor,null,2)+'\n'),file=name+'.delta.json';write(file,descriptorBytes);
  records.push({file,representation:'lossless declared-path delta',sha256:sha(descriptorBytes),target:descriptor.target,targetSHA256:descriptor.targetSHA256,originalBytes:raw.length,storedBytes:descriptorBytes.length,allOriginalBytesExact:true});
 }
 const manifest={schema:'pliego-modal-archive/0.1',node:process.version,sourceGit:base.source.git,toolSHA256:sha(readFileSync(new URL(import.meta.url))),records,
  originalBytes:records.reduce((s,r)=>s+r.originalBytes,0),storedBytes:records.reduce((s,r)=>s+r.storedBytes,0),
  method:'complete diagnostic capture plus two independently verified timestamp/observer-only deltas; JSON.stringify reconstructs every original captured byte and original SHA256; no simulation/metric/gate data omitted'};
 write('archive-manifest.json',JSON.stringify(manifest,null,2)+'\n');
 console.log('modal-archive: 3 original reports byte-exact; '+manifest.originalBytes+' original / '+manifest.storedBytes+' stored bytes');
}else{
 const manifest=JSON.parse(readFileSync(join(inputDirectory,'archive-manifest.json')));assert.equal(manifest.schema,'pliego-modal-archive/0.1');
 assert.equal(manifest.toolSHA256,sha(readFileSync(new URL(import.meta.url))),'archival producer must match');
 const baseBytes=readFileSync(join(inputDirectory,'diagnostic.json'));let count=0;
 for(const record of manifest.records){assert.equal(record.file,basename(record.file));const stored=readFileSync(join(inputDirectory,record.file));assert.equal(sha(stored),record.sha256);
  const target=record.representation==='complete original'?stored:reconstruct(baseBytes,JSON.parse(stored)),name=record.target||record.file;
  assert.equal(target.length,record.originalBytes);write(name,target);count++;
 }
 assert.equal(count,3);console.log('modal-reconstruct: 3 complete original reports with exact captured bytes/hashes; no abbreviated replay');
}
