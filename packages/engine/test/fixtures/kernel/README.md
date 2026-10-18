# Kernel-built fixtures

Sheet documents built by the Pliego kernel from commons cartridges (sheet-hyperobjects, CERN-OHL-W-2.0),
kept byte-for-byte so engine tests run on real catalog geometry without the kernel:

| file | built from |
|---|---|
| `tab-and-slot.fold` | `tab-and-slot`, mode `assembled`, defaults, with both slits named `interlock-slot` |
| `hexagonal-twist-steep.fold` | `hexagonal-twist`, mode `triangle`, preset `steep` (commons 86a74fa) |
| `four-bar-linkage.fold` | `card-linkages`, mode `four-bar`, defaults (commons 86a74fa) |
| `deckle-tear-crease-card-strip.fold` | `deckle-tear`, mode `crease`, preset `card-strip` (commons 86a74fa, kernel 0.3.0): a hand folds a kiss-cut line over and back before the tear |
