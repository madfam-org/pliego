// @ts-check
/** Write the engine's .fold fixtures (deterministic JSON, 1-space indent, trailing newline). */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fixtureDocs } from './fixtures.js';

const dir = fileURLToPath(new URL('../fixtures/', import.meta.url));
mkdirSync(dir, { recursive: true });
const docs = await fixtureDocs();
for (const [name, doc] of Object.entries(docs)) {
  writeFileSync(`${dir}${name}.fold`, `${JSON.stringify(doc, null, 1)}\n`);
  console.log(`wrote test/fixtures/${name}.fold`);
}
