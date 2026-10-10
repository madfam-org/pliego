// @ts-check
/**
 * The `.fold` fixtures committed under test/fixtures (for other lanes, e.g. the studio).
 * Regenerate with `node packages/engine/test/helpers/write-fixtures.js`; test `fixtures` fails if a
 * committed file drifts from its builder.
 */
import * as F from './docbuilder.js';

export async function fixtureDocs() {
  return {
    'square-valley': F.squareValley({ size: 150, stock: 'kami' }).doc,
    'page-leaf': F.pageLeaf(),
    'v-fold-card': (await F.vfoldCard()).doc,
    'miura-4x4': F.miura({ gamma: 60 }).doc,
    'tissue-flag': F.tissueFlag(),
  };
}
