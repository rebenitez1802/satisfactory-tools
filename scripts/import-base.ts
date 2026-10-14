// Build the `base` data pack (public/packs/base/pack.json) from greeny's
// dataset plus the hand-written overlay. Keeps machine-run recipes only:
// equipment and FICSMAS (a separate file upstream) are left out, and the
// build-gun recipes of the machines we keep become their `buildCost`. Fluid amounts are already in m³. Generators become machines with
// one recipe per fuel, so the planner sizes fuel chains like any other.
// Milestones, MAM research and alternates' hard drives become schematics
// (what unlocks each recipe), for game progress.
//
//   node scripts/import-base.ts      (then scripts/fetch-icons.ts adds icons)

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DataPack } from '../src/catalog/pack.ts'
import type { Item, Machine, Recipe, Schematic, SchematicKind } from '../src/catalog/types.ts'
import {
  EXTRACTORS,
  FUEL_WASTE,
  GAME_VERSION,
  GASES,
  GENERATORS,
  OVERCLOCK,
  PRODUCTION,
  PURITIES,
  RESEARCH_TREES,
  SUPPORT_MACHINES,
  TRANSPORT_TIERS,
  UPGRADE_ITEMS,
  VARIABLE_POWER,
  WORLD,
} from './base-overlay.ts'
import { GREENY_COMMIT, loadGreeny, ROOT } from './greeny.ts'

export const PACK_DIR = join(ROOT, 'public', 'packs', 'base')

const toBuild = (descClass: string) => descClass.replace(/^Desc_/, 'Build_')
const toDesc = (buildClass: string) => buildClass.replace(/^Build_/, 'Desc_')
const hex = (c: { r: number; g: number; b: number }) =>
  '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')
const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id)

const data = await loadGreeny()

// What each building costs: the build-gun recipe whose product is its descriptor.
const buildCosts = new Map(
  Object.values(data.recipes)
    .filter((r) => r.forBuilding && r.products.length === 1)
    .map((r) => [toBuild(r.products[0].item), r.ingredients.map((a) => ({ item: a.item, amount: a.amount }))]),
)

// Recipes run by a machine.
const recipes: Recipe[] = Object.values(data.recipes)
  .filter((r) => r.inMachine && !r.forBuilding)
  .map((r) => ({
    id: r.className,
    name: r.name.replace(/^Alternate:\s*/, ''),
    machines: r.producedIn.map(toBuild),
    durationSec: r.time,
    inputs: r.ingredients.map((a) => ({ item: a.item, amount: a.amount })),
    outputs: r.products.map((a) => ({ item: a.item, amount: a.amount })),
    alternate: r.alternate,
    ...(r.isVariablePower && r.producedIn.every((m) => VARIABLE_POWER.has(toBuild(m)))
      ? { variablePower: { minMw: r.minPower, maxMw: r.maxPower } } : {}),
  }))
  .sort(byId)

// Machines.
const building = (buildClass: string) => {
  const b = data.buildings[toDesc(buildClass)]
  if (!b) throw new Error(`No building ${buildClass} in source data`)
  return b
}
const baseMachine = (buildClass: string, category: string): Machine => {
  const b = building(buildClass)
  return {
    id: buildClass,
    name: b.name,
    category,
    powerMw: b.metadata.powerConsumption ?? 0,
    powerExponent: b.metadata.powerConsumptionExponent ?? 1,
    speed: 1,
    ports: { belt: { in: 0, out: 0 }, pipe: { in: 0, out: 0 } },
    overclock: OVERCLOCK,
    ...(buildCosts.has(buildClass) ? { buildCost: buildCosts.get(buildClass) } : {}),
  }
}

const usedMachines = new Set(recipes.flatMap((r) => r.machines))
for (const m of usedMachines) if (!PRODUCTION[m]) throw new Error(`Overlay is missing production machine ${m}`)

const machines: Machine[] = []
for (const [id, extra] of Object.entries(PRODUCTION)) {
  machines.push({
    ...baseMachine(id, 'production'),
    speed: building(id).metadata.manufacturingSpeed || 1,
    ports: { belt: { in: extra.belt[0], out: extra.belt[1] }, pipe: { in: extra.pipe[0], out: extra.pipe[1] } },
    ...(extra.amplifier ? { amplifier: extra.amplifier } : {}),
  })
}
for (const [id, extra] of Object.entries(EXTRACTORS)) {
  const miner = data.miners[toDesc(id)]
  const extraction = miner
    ? {
        resources: miner.allowedResources,
        // Fluid amounts are stored ×1000 in the miner table.
        ratePerMin: (miner.itemsPerCycle / (miner.allowLiquids ? 1000 : 1)) * (60 / miner.extractCycleTime),
      }
    : extra.fallback
  if (!extraction) throw new Error(`No extraction data for ${id}`)
  machines.push({
    ...baseMachine(id, 'extraction'),
    ports: { belt: { in: extra.belt[0], out: extra.belt[1] }, pipe: { in: extra.pipe[0], out: extra.pipe[1] } },
    extraction: {
      ...extraction,
      usesPurity: extra.usesPurity,
      ...(extra.anywhere ? { anywhere: true } : {}),
      ...(extra.site ? { site: extra.site } : {}),
      ...(extra.poweredBy ? { poweredBy: extra.poweredBy } : {}),
    },
  })
}
for (const id of SUPPORT_MACHINES) machines.push(baseMachine(id, 'extraction'))

// Generators: one recipe per fuel. A cycle is one unit of fuel (1 item, or
// 1 m³ of a fluid fuel) burning for energy / power seconds; water and waste
// are per cycle too.
const WATER = 'Desc_Water_C'
const shortName = (cls: string) => cls.replace(/^(Build|Desc)_/, '').replace(/_C$/, '')
for (const [id, extra] of Object.entries(GENERATORS)) {
  const gen = data.generators[toDesc(id)]
  if (!gen) throw new Error(`No generator ${id} in source data`)
  const machine: Machine = {
    ...baseMachine(id, 'generator'),
    // Generators draw no power, and scale linearly with clock.
    powerMw: 0,
    powerExponent: 1,
    ports: { belt: { in: extra.belt[0], out: extra.belt[1] }, pipe: { in: extra.pipe[0], out: extra.pipe[1] } },
    generation: { powerMw: gen.powerProduction },
  }
  machines.push(machine)
  for (const fuel of gen.fuel) {
    const energy = data.items[fuel]?.energyValue
    if (!energy) throw new Error(`Fuel ${fuel} of ${id} has no energy value`)
    const durationSec = energy / gen.powerProduction
    const water = (gen.waterToPowerRatio * gen.powerProduction * durationSec) / 1000
    const waste = FUEL_WASTE[fuel]
    recipes.push({
      id: `Recipe_${shortName(id)}_${shortName(fuel)}_C`,
      name: `${machine.name} (${data.items[fuel].name})`,
      machines: [id],
      durationSec,
      inputs: [{ item: fuel, amount: 1 }, ...(water > 0 ? [{ item: WATER, amount: water }] : [])],
      outputs: waste ? [waste] : [],
      alternate: false,
    })
  }
}
recipes.sort(byId)
machines.sort(byId)
for (const m of machines) if (!m.buildCost) console.warn(`No build cost for ${m.id}`)

// Schematics: what unlocks each recipe. Milestones and HUB upgrades (tier 0)
// unlock with their tier, MAM research is ticked by the player, and
// alternates are hard drives. AWESOME Sink and customization schematics
// unlock no machine recipes and are left out.
const KINDS: Record<string, SchematicKind> = { EST_Tutorial: 'milestone', EST_Milestone: 'milestone', EST_MAM: 'research', EST_Alternate: 'alternate' }
const ours = new Set(recipes.map((r) => r.id))
const sources = Object.values(data.schematics).filter((s) => KINDS[s.type])
const unlocks = new Map(sources.map((s) => [s.className, s.unlock.recipes.filter((r) => ours.has(r))]))
// Recipes no schematic lists (unpackaging, residue recipes, the Converter's,
// the generators' fuels, the first iron recipes) come with the building that
// runs them.
const listed = new Set([...unlocks.values()].flat())
const buildRecipe = new Map(
  Object.values(data.recipes)
    .filter((r) => r.forBuilding && r.products.length === 1)
    .map((r) => [toBuild(r.products[0].item), r.className]),
)
for (const r of recipes) {
  if (listed.has(r.id)) continue
  const build = buildRecipe.get(r.machines[0])
  const by = sources.filter((s) => build && s.unlock.recipes.includes(build))
  if (!by.length) throw new Error(`Nothing unlocks ${r.id} or its machine ${r.machines[0]}`)
  for (const s of by) unlocks.get(s.className)!.push(r.id)
}
// Kept: every milestone (so each tier is listed, even one that unlocks only
// buildings), schematics that unlock a recipe, and those they require.
const keep = new Set(sources.filter((s) => KINDS[s.type] === 'milestone' || unlocks.get(s.className)!.length).map((s) => s.className))
for (let changed = true; changed; ) {
  changed = false
  for (const s of sources) {
    if (!keep.has(s.className)) continue
    for (const req of s.requiredSchematics) {
      if (!keep.has(req) && unlocks.has(req)) {
        keep.add(req)
        changed = true
      }
    }
  }
}
const schematics: Schematic[] = sources
  .filter((s) => keep.has(s.className))
  .map((s): Schematic => {
    const kind = KINDS[s.type]
    const requires = s.requiredSchematics.filter((r) => keep.has(r))
    const tree = s.className.match(/^Research_([A-Za-z]+)/)?.[1]
    if (kind === 'research' && !RESEARCH_TREES[tree ?? '']) throw new Error(`Overlay is missing research tree ${tree} (${s.className})`)
    return {
      id: s.className,
      name: s.name.replace(/^Alternate:\s*/, ''),
      kind,
      tier: kind === 'milestone' ? s.tier : 0,
      ...(kind === 'research' ? { group: RESEARCH_TREES[tree!] } : {}),
      recipes: unlocks.get(s.className)!.sort(),
      ...(requires.length ? { requires } : {}),
    }
  })
  .sort(byId)

// Items referenced by recipes or extractable.
const usedItems = new Set([
  ...recipes.flatMap((r) => [...r.inputs, ...r.outputs].map((a) => a.item)),
  ...machines.flatMap((m) => [...(m.extraction?.resources ?? []), ...(m.buildCost ?? []).map((a) => a.item)]),
  ...UPGRADE_ITEMS,
])
const items: Item[] = [...usedItems]
  .map((id): Item => {
    const it = data.items[id]
    if (!it) throw new Error(`No item ${id} in source data`)
    const form = !it.liquid ? 'solid' : GASES.has(id) ? 'gas' : 'liquid'
    return {
      id,
      name: it.name,
      form,
      ...(form !== 'solid' ? { color: hex(it.fluidColor) } : {}),
      ...(form === 'solid' && it.sinkPoints ? { sinkPoints: it.sinkPoints } : {}),
      ...(it.energyValue ? { energyMJ: it.energyValue } : {}),
      ...(it.radioactiveDecay ? { radioactive: true } : {}),
    }
  })
  .sort(byId)

const pack: DataPack = {
  manifest: {
    id: 'base',
    name: 'Satisfactory (base game)',
    version: `${GAME_VERSION}.0`,
    gameVersion: GAME_VERSION,
    description: 'Vanilla items, machines, recipes and the default map.',
    credits: [
      'Game content and icons © Coffee Stain Studios.',
      `Recipe data from greeny/SatisfactoryTools (MIT), commit ${GREENY_COMMIT.slice(0, 7)}.`,
      'Icons and resource node counts from the Official Satisfactory Wiki (satisfactory.wiki.gg).',
    ],
  },
  add: {
    purities: PURITIES,
    transportTiers: TRANSPORT_TIERS,
    items,
    machines,
    recipes,
    maps: [WORLD],
    schematics,
  },
}

mkdirSync(PACK_DIR, { recursive: true })
writeFileSync(join(PACK_DIR, 'pack.json'), JSON.stringify(pack, null, 1) + '\n')
console.log(
  `base pack: ${items.length} items, ${machines.length} machines, ${recipes.length} recipes ` +
    `(${recipes.filter((r) => r.alternate).length} alternate), ${schematics.length} schematics`,
)
