# Local authored archive companion

This pilot places an eight-page companion on a real, frozen native saddle-stitch
capture. The owning Pliego preview and renderer display its construction and
printed faces; a separate EN/ES reader exposes the same logical content. It does
not recreate a historical manual, import a walkthrough, infer game completion or
connect a game launcher. Narrative, completion and walkthrough material remains
unknown unless admitted by its owning consumer; this pilot has no guide-import
path.

The code is generic. Real edition metadata, source captures, admitted content
packets and generated artifacts stay in the operator's local output directory,
outside synthetic repository fixtures.

## Build and run locally

Use the existing trusted native producer first with an exact commons/runtime pin
and explicit eight-page, left-binding parameters. Preserve the entire native
archive unchanged. Then run the appearance-only adapter using the existing Python
runtime (no install is needed):

```sh
python scripts/companion_book.py \
  --archive /path/to/native-archive \
  --content /path/to/reviewed-content.json \
  --handoff /path/to/curated-handoff.json \
  --out /path/to/new-empty-companion
node apps/web/dev-server.mjs --port 8740 --companion /path/to/new-empty-companion
```

Open `http://127.0.0.1:8740/companion/?lang=en` or `?lang=es`. The optional
`?renderer=canvas2d` exercises the owning fallback, with accessible reading even
though that renderer does not display printed artwork. Every construction state
is discrete, with no autoplay, so reduced motion does not require losing 3D.

Companion mode binds only to loopback and admits GET/HEAD for this page, the native
studio renderer modules/CSS and explicitly named companion artifacts. Other app,
API, engine, traversal and outside-root symlink paths are refused. No directory
listing, arbitrary document URL, user configuration, file URL or launch capability
is provided. Normal dev-server behavior is retained when the flag is absent.

## Inputs and evidence

`authored-archive-companion/0.1` content supplies an edition HTTPS reference and
exactly page-1 through page-8 in reading order. Every page contains EN/ES titles
and short paragraphs, a kind (`archive-facts`, `authored-note` or `unknown`) and an
explicit source list. Status strings do not authenticate historical truth; the
local curatorial review stays separate. Script-like text is escaped into safe
original typographic SVG, never inserted as HTML or imported artwork.

Optional `curated-experience-handoff/0.1` links carry an explicit matching
`historical_reference`, `experience_id`, exact `bundle_digest`, `gallery_url`,
`reveal_url` and provenance. They are consumer relationships, not new historical
facts or a live remote-health check. HTTPS links get only the selected EN/ES
query; no game-name matching or arbitrary query return target is used.

The adapter checks the native archive hashes/closure with its existing checker,
adds inline front/back sheet artwork to a copy, stamps and verifies that derived
FOLD, and refuses any geometry/construction change. The new manifest retains the
original source pin/requested and resolved parameters, runtime fingerprint,
physical parts, flat-FOLD frame and native archive hashes separately from the
adapter's source-file hash, authored content and derived file hashes. The browser
checks retained reading/FOLD/page-image bytes before use. These are unsigned
integrity checks, not authenticated evidence or a hermetic interpreter rebuild.
Record the adapter's committed revision and clean/dirty status separately in the
local capture receipt; the older native runtime pin does not cover this adapter.

## Physical page binding

For left-bound eight-page imposition:

| Logical page | Physical sheet | Side | Native-front-coordinate half |
| --- | --- | --- | --- |
| 1 | sheet-1 | back | L |
| 2 | sheet-1 | front | L |
| 3 | sheet-2 | back | L |
| 4 | sheet-2 | front | L |
| 5 | sheet-2 | front | R |
| 6 | sheet-2 | back | R |
| 7 | sheet-1 | front | R |
| 8 | sheet-1 | back | R |

Regions are `[u_min, v_min, width, height]` in sheet-local mm, with u right and v
up as viewed from the native front. `back_view_slot` reverses these halves for an
observer looking at the back: outer spread is 8|1, inner spread is 2|7; the second
sheet is 6|3 and 4|5. Native sheet IDs and full source/parameter identity anchor the
mapping; mesh face indices are not reading-page IDs.

The default native camera may show the back cover (page 8) of the shut booklet.
The reader can independently show page 1 and its checked image. Selecting a page
never pretends to turn that physical face. Construction steps remain
nest/staple/shut; there is no independent reading animation in this cartridge.

## Boundaries

The existing native GLB is untextured; PDF omits artwork. This pilot provides
neither a textured-GLB nor a duplex print-ready guide export. The native rigid
preview is not an elastic paper-physics or print proof, and no original manual
trim/binding, retail fit, fabrication or playable launch is certified. Spoiler
hiding would be presentation only for a public monolithic asset; this unknown-only
pilot makes no protected-content delivery claim.
