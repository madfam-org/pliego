// Local consumer validation: hashes check bytes, never historical truth or guide admission.
export function validateCompanion(manifest, content) {
  if (manifest?.schema !== 'pliego-authored-companion/0.1' || content?.schema !== 'authored-archive-companion/0.1') throw new Error('Unsupported companion format');
  if (manifest.edition.reference !== content.edition.reference) throw new Error('Edition reference differs');
  if (manifest.page_frame?.units !== 'mm' || manifest.page_frame?.space !== 'sheet-local') throw new Error('Page regions must declare native sheet-local mm');
  if (manifest.pages?.length !== 8 || content.pages?.length !== 8) throw new Error('Eight reading pages are required');
  const surfaces = new Set();
  for (let i = 0; i < 8; i++) {
    const p = manifest.pages[i], c = content.pages[i];
    if (p.number !== i + 1 || p.page !== `page-${i+1}` || c.id !== p.page) throw new Error('Reading order differs from physical mapping');
    if (!manifest.native.parts.includes(p.sheet) || !['front', 'back'].includes(p.side) || !['L', 'R'].includes(p.half)) throw new Error('Unknown native page surface');
    if (!Array.isArray(p.region_mm) || p.region_mm.length !== 4 || !p.region_mm.every(Number.isFinite) || p.region_mm[2] <= 0 || p.region_mm[3] <= 0) throw new Error('Invalid physical page region');
    if (p.side === 'back' && p.back_view_slot !== (p.half === 'L' ? 1 : 0)) throw new Error('Back view must reverse the physical front-coordinate half');
    const surface = `${p.sheet}/${p.side}/${p.half}`;
    if (surfaces.has(surface)) throw new Error('A physical page surface is assigned twice');
    surfaces.add(surface);
    if (!['archive-facts', 'authored-note', 'unknown'].includes(c.kind)) throw new Error('Guide content is not admitted in this pilot');
    for (const lang of ['en', 'es']) {
      if (typeof c.title?.[lang] !== 'string' || !Array.isArray(c.paragraphs?.[lang]) || !c.paragraphs[lang].every(s => typeof s === 'string')) throw new Error('Missing accessible reading text');
    }
    if (!Array.isArray(c.sources)) throw new Error('Missing explicit source list');
    for (const url of c.sources) safeSource(url);
  }
  safeSource(content.edition.reference);
  safeSource(content.edition.record_url);
  if (manifest.handoff) {
    if (manifest.handoff.schema !== 'curated-experience-handoff/0.1' || manifest.handoff.historical_reference !== content.edition.reference || !/^sha256:[a-f0-9]{64}$/.test(manifest.handoff.bundle_digest)) throw new Error('Curated handoff differs from this edition');
    safeSource(manifest.handoff.gallery_url); safeSource(manifest.handoff.reveal_url);
  }
  return true;
}

export function safeSource(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Source link must be public HTTPS without credentials');
  return url.href;
}

export async function verifiedBytes(name, files, fetcher = fetch) {
  // Fixed local root and a bounded list of known JSON/FOLD/page-image assets.
  if (!/^(content\.json|book-(en|es)\.fold|pages\/(en|es)\/page-[1-8]\.svg)$/.test(name) || !/^[a-f0-9]{64}$/.test(files?.[name]?.sha256)) throw new Error('Undeclared local companion asset');
  const response = await fetcher(`/companion-data/${name}`);
  if (!response.ok) throw new Error(`Companion asset unavailable: ${name}`);
  const bytes = await response.arrayBuffer();
  const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (actual !== files[name].sha256 || bytes.byteLength !== files[name].bytes) throw new Error(`Companion asset hash differs: ${name}`);
  return bytes;
}

export async function verifiedFile(name, files, fetcher = fetch) {
  return JSON.parse(new TextDecoder().decode(await verifiedBytes(name, files, fetcher)));
}
