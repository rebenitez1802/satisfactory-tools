# Production planner data model

The planner never hard-codes game content. Items, machines, recipes, purities,
belt/pipe tiers and world maps are loaded from **data packs**. Code only branches on
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
     `extraction` spec for miners and extractors, or `generation` (MW made)
     for generators. `extraction.anywhere` marks extractors that aren't tied
     to resource nodes (the Water Extractor goes on any water), so any number
     can be built and the UI counts extractors rather than nodes.
     `extraction.site` names the kind of world site it goes on (`node` for
     miners and oil extractors, `well` for well satellites); extractors of
     the same kind compete for the same sites.
     `buildCost` lists the items one of the machine costs to build; absent
     means unknown, not free. A cost naming an item that isn't loaded is
     dropped with a diagnostic.
   - Generators run recipes like any machine: one per fuel. A cycle burns one
     unit of fuel (1 item, or 1 m³ of a fluid fuel) for `energyMJ / MW`
     seconds; water and waste are per cycle. Generator recipes may have no
     outputs, and all their outputs count as byproducts.
   - `Item.radioactive` marks uranium, waste and fuel rods. Radioactive
     surplus that can't be sunk (no `sinkPoints`) is flagged by the solver.
   - `Recipe`: inputs and outputs per cycle, duration, the machines that can
     run it, and an alternate flag.
   - `Purity` and `TransportTier`.
   - `WorldMap`: a map's resource sites, as counts per resource, kind of
     site and purity. The first map is the default; a plan may carry its
     own counts (`PlanSettings.world`). The base pack's default map comes
     from the wiki's per-resource pages, in `scripts/base-overlay.ts`.

   - `Schematic`: something the player unlocks, and the recipes it unlocks.
     Its `kind` is all the planner needs: a `milestone` unlocks with its
     HUB `tier` (tier 0 is the HUB upgrades), `research` is ticked by the
     player (the MAM, grouped by tree), and an `alternate` is a hard drive,
     found once every schematic in `requires` is unlocked. A recipe no
     schematic unlocks is always available. `catalog.schematicsFor` indexes
     them by recipe. A recipe or requirement that isn't loaded (a mod
     removed it) is silently forgotten.

   `buildCatalog(packs, { enabled })` merges packs into an immutable `Catalog`
   with lookup indexes (`recipesProducing`, `recipesConsuming`,
   `extractorsFor`) plus a list of diagnostics.
2. **Plan**, the user's graph (`src/planner/types.ts`). It has four node kinds:
   - `recipe`: machine × count × clock × Somersloops.
   - `extractor`: machine + resource + sites by purity.
   - `supply`: items coming in from outside.
   - `goal`: items the plan should deliver.

   Goals carry a 🎯 target (a number or `max`); so do generator groups, as
   `power` in MW. Any other node can be ⛔
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
   - Generators are linear: N machines' worth at 100% make N × their MW and
     burn N × the fuel, at any clock.
   - World node limits (`src/planner/world.ts`): the most a site gives is
     the fastest extractor that fits it at its highest clock, capped by
     the fastest belt or pipe (a pure iron node: Mk.3 at 250% = 1200/min).
   - Not modelled yet: the 1.2 cost multipliers.
     Geothermal generators are left out on purpose: no production chain
     feeds them.

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
- Build costs are greeny's build-gun recipes (`forBuilding`), matched to
  each machine by its class name.
- Values greeny lacks are hand-written in `scripts/base-overlay.ts`: ports,
  Somersloop slots, purities, belt and pipe tiers, the Water Extractor,
  resource wells, gas forms, generator ports, the waste each nuclear fuel
  rod leaves (greeny lists generators' fuels and water but not their waste),
  and the default map's resource node counts.
- Schematics are greeny's milestones, HUB upgrades, MAM research and
  alternates (AWESOME Sink and customization ones are left out). Recipes
  greeny lists under no schematic (unpackaging, residue recipes, the
  Converter's, generator fuels, the first iron recipes) come with the
  schematic that unlocks the building that runs them. MAM tree names are in
  the overlay. Every milestone is kept, so each tier is listed.
- Icons and resource node counts come from satisfactory.wiki.gg. Icons are
  © Coffee Stain Studios; both are credited in the site footer.
