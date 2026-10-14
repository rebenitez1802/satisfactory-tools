// Build the `base` data pack (public/packs/base/pack.json) from greeny's
// dataset plus the hand-written overlay. Keeps machine-run recipes only:
// build-gun recipes, equipment, and FICSMAS (a separate file upstream) are
// left out. Fluid amounts are already in m³.
//
//   node scripts/import-base.ts      (then scripts/fetch-icons.ts adds icons)

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DataPack } from '../src/catalog/pack.ts'
import type { Item, Machine, Recipe } from '../src/catalog/types.ts'
import { EXTRACTORS, GAME_VERSION, GASES, OVERCLOCK, PRODUCTION, PURITIES, SUPPORT_MACHINES, TRANSPORT_TIERS, UPGRADE_ITEMS, VARIABLE_POWER } from './base-overlay.ts'
import { GREENY_COMMIT, loadGreeny, ROOT } from './greeny.ts'

export const PACK_DIR = join(ROOT, 'public', 'packs', 'base')

const toBuild = (descClass: string) => descClass.replace(/^Desc_/, 'Build_')
const toDesc = (buildClass: string) => buildClass.replace(/^Build_/, 'Desc_')
const hex = (c: { r: number; g: number; b: number }) =>
  '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')
const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id)

const data = await loadGreeny()

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
      ...(extra.poweredBy ? { poweredBy: extra.poweredBy } : {}),
    },
  })
}
for (const id of SUPPORT_MACHINES) machines.push(baseMachine(id, 'extraction'))
machines.sort(byId)

// Items referenced by recipes or extractable.
const usedItems = new Set([
  ...recipes.flatMap((r) => [...r.inputs, ...r.outputs].map((a) => a.item)),
  ...machines.flatMap((m) => m.extraction?.resources ?? []),
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
    }
  })
  .sort(byId)

const pack: DataPack = {
  manifest: {
    id: 'base',
    name: 'Satisfactory (base game)',
    version: `${GAME_VERSION}.0`,
    gameVersion: GAME_VERSION,
    description: 'Vanilla items, machines and recipes.',
    credits: [
      'Game content and icons © Coffee Stain Studios.',
      `Recipe data from greeny/SatisfactoryTools (MIT), commit ${GREENY_COMMIT.slice(0, 7)}.`,
      'Icons from the Official Satisfactory Wiki (satisfactory.wiki.gg).',
    ],
  },
  add: {
    purities: PURITIES,
    transportTiers: TRANSPORT_TIERS,
    items,
    machines,
    recipes,
  },
}

mkdirSync(PACK_DIR, { recursive: true })
writeFileSync(join(PACK_DIR, 'pack.json'), JSON.stringify(pack, null, 1) + '\n')
console.log(
  `base pack: ${items.length} items, ${machines.length} machines, ${recipes.length} recipes ` +
    `(${recipes.filter((r) => r.alternate).length} alternate)`,
)
