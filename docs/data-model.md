# Production planner data model

The planner never hard-codes game content. Items, machines, recipes, purities
and belt/pipe tiers are loaded from **data packs**. Code only branches on
engine rules such as an item's form or whether a machine extracts or runs
recipes. That keeps mods (new machines, resources, recipes) and future game
patches a data change, not a code change.

```
public/packs/<packId>/pack.json    pack data (src/catalog/pack.ts)
public/packs/<packId>/icons/       icons referenced from pack.json
src/catalog/                       content types, pack merge → Catalog
src/planner/                       plan graph types, rate + power math
scripts/                           build-time importers (not shipped)
```

## Layers

1. **Catalog**, static game content (`src/catalog/types.ts`).
   - `Item`: has a form (`solid` / `liquid` / `gas`; fluids in m³).
   - `Machine`: power, clock limits, Somersloop slots, ports, and an optional
     `extraction` spec for miners and extractors.
   - `Recipe`: inputs and outputs per cycle, duration, the machines that can
     run it, and an alternate flag.
   - `Purity` and `TransportTier`.

   `buildCatalog(packs, { enabled })` merges packs into an immutable `Catalog`
   with lookup indexes (`recipesProducing`, `recipesConsuming`,
   `extractorsFor`) plus a list of diagnostics.
2. **Plan**, the user's graph (`src/planner/types.ts`). It has four node kinds:
   - `recipe`: machine × count × clock × Somersloops.
   - `extractor`: machine + resource + sites by purity.
   - `supply`: items coming in from outside.
   - `goal`: items the plan should deliver.

   Goals carry a 🎯 target (a number or `max`). Any other node can be ⛔
   `limited`; everything else is sized by `solvePlan` (`src/planner/solve.ts`).
   See [production-planner.md](production-planner.md) for the rules. Edges
   carry one item. A plan references catalog content by id only and records
   which packs it was built with.
3. **Math** (`src/planner/rates.ts`) follows vanilla rules:
   - Rate: `amount × 60 / durationSec × speed × clock × count`.
   - Somersloops multiply outputs only, by `1 + filled × boostPerSlot`; a full
     machine doubles its output.
   - Power per machine: `base × clock^1.321929 × (1 + filled/slots)^2`.
     Variable-power recipes use their average power.
   - A fractional count (2.4) is costed as built: 2 machines at the node's
     clock plus one at 40% of it.
   - `machineSetup` switches between fractional counts and whole machines
     (underclocked, or overclocked onto a fixed count, including the shards
     needed).
   - Not modelled yet: the 1.2 cost multipliers, generators, and world node
     limits.

## Ids and packs

- Ids are namespaced: `base:Desc_IronIngot_C`. Local ids are the game's class
  names.
- Inside a pack file, an unqualified id means "this pack" and `other:Id`
  refers to another pack.
- A pack can `add` entities, `patch` them (shallow: top-level fields are
  replaced) and `remove` them. Packs load after everything in their
  `dependsOn`.
- A mod pack depends on `base`. Loading only `base` gives vanilla again. A
  standalone pack can replace `base` entirely.
- Broken references never crash: recipes that point at missing items or
  machines are dropped and reported in the diagnostics.

## Regenerating the base pack

```bash
npm run data:base   # scripts/import-base.ts + scripts/fetch-icons.ts
```

- Recipe data comes from greeny/SatisfactoryTools `data/data1.0.json` (MIT),
  pinned to a commit in `scripts/greeny.ts`. Its machine recipes match the
  game's 1.2 data.
- Values greeny lacks are hand-written in `scripts/base-overlay.ts`: ports,
  Somersloop slots, purities, belt and pipe tiers, the Water Extractor,
  resource wells and gas forms.
- Icons come from satisfactory.wiki.gg. They are © Coffee Stain Studios and
  credited in the site footer.
