import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCompanion, verifiedFile } from '../companion/companion-data.js';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

function fixture() {
  const content = { schema: 'authored-archive-companion/0.1', edition: { reference: 'https://example.org/edition', record_url: 'https://example.org/source' }, pages: [] };
  const manifest = { schema: 'pliego-authored-companion/0.1', edition: content.edition, native: { parts: ['sheet-1','sheet-2'] }, page_frame:{units:'mm',space:'sheet-local'}, pages: [] };
  for (let i=0;i<8;i++) {
    content.pages.push({ id: `page-${i+1}`, kind: 'unknown', title: { en: 'Unknown route', es: 'Ruta desconocida' }, paragraphs: { en: ['Not admitted'], es: ['No admitida'] }, sources: [] });
    manifest.pages.push({ page:`page-${i+1}`, number:i+1, sheet:`sheet-${Math.floor(i/4)+1}`, side:i%4<2?'front':'back', half:i%2?'R':'L', region_mm:[i%2?105:0,0,105,148],back_view_slot:i%4<2?null:(i%2?0:1) });
  }
  return { manifest,content };
}
test('separate reading pages map once to actual native surfaces', () => {
  const {manifest,content}=fixture(); assert.equal(validateCompanion(manifest,content),true);
  manifest.pages[2]={...manifest.pages[0],page:'page-3',number:3};
  assert.throws(()=>validateCompanion(manifest,content),/assigned twice/);
});
test('wrong edition, unknown sheet and unadmitted guide refuse rendering', () => {
  for (const change of [(m,c)=>{m.edition={reference:'https://example.org/other'};}, (m,c)=>{m.pages[0].sheet='invented';}, (m,c)=>{m.page_frame.units='px';}, (m,c)=>{m.pages[2].back_view_slot=0;}, (m,c)=>{c.pages[0].kind='walkthrough';}, (m,c)=>{c.pages[0].sources=['javascript:alert(1)'];}]) {
    const {manifest,content}=fixture(); change(manifest,content); assert.throws(()=>validateCompanion(manifest,content));
  }
});
test('changed reading bytes fail before JSON or native viewer consumption', async () => {
  const bytes=new TextEncoder().encode('{}');
  const files={'content.json':{sha256:'a'.repeat(64),bytes:2}};
  await assert.rejects(verifiedFile('content.json',files,async()=>({ok:true,arrayBuffer:async()=>bytes.buffer})),/hash differs/);
  await assert.rejects(verifiedFile('../content.json',files),/Undeclared/);
});
test('companion server admits only known static outputs and denies traversal, API and external symlinks', async () => {
  const dir=mkdtempSync(join(tmpdir(),'pliego-book-static-')), outside=mkdtempSync(join(tmpdir(),'pliego-book-outside-'));
  writeFileSync(join(dir,'companion.json'),'{}'); writeFileSync(join(outside,'example.txt'),'synthetic private fixture');
  symlinkSync(join(outside,'example.txt'),join(dir,'content.json'));
  const port=19000+Math.floor(Math.random()*10000);
  const server=spawn(process.execPath,[fileURLToPath(new URL('../dev-server.mjs',import.meta.url)),'--port',String(port),'--companion',dir],{stdio:['ignore','pipe','pipe']});
  try {
    await once(server.stdout,'data');
    const root=`http://127.0.0.1:${port}`;
    for (const [path,status] of [['/companion/',200],['/companion-data/companion.json',200],['/studio/src/render/index.js',200],['/companion-data/content.json',404],['/companion-data/other.txt',404],['/companion-data/%2e%2e/example.txt',404],['/api/v1/catalog',404],['/engine/index.js',404],['/studio/',404],['/',404]]) assert.equal((await fetch(root+path)).status,status,path);
    assert.equal((await fetch(root+'/companion-data/companion.json',{method:'POST'})).status,405);
  } finally { server.kill(); rmSync(dir,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true}); }
});
