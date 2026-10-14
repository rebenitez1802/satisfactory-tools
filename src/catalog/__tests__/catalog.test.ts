import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildCatalog } from '../build'
import { iconUrl, placeholderFor } from '../icons'
import type { DataPack } from '../pack'
import { loadBasePack } from './basePack'

const base = loadBasePack()

describe('base pack', () => {
  const { catalog, diagnostics } = buildCatalog([base])

  it('loads cleanly', () => {
    expect(diagnostics).toEqual([])
    expect(catalog.packs.map((p) => p.id)).toEqual(['base'])
  })

  it('has the expected vanilla content', () => {
    // 276 machine recipes plus 17 generator fuels.
    expect(catalog.recipes.size).toBe(293)
    expect([...catalog.recipes.values()].filter((r) => r.alternate)).toHaveLength(111)
    expect([...catalog.machines.values()].filter((m) => m.category === 'production')).toHaveLength(11)
    expect([...catalog.machines.values()].filter((m) => m.generation).map((m) => m.name).sort()).toEqual([
      'Biomass Burner',
      'Coal-Powered Generator',
      'Fuel-Powered Generator',
      'Nuclear Power Plant',
    ])
    expect(catalog.purities.size).toBe(3)
    expect([...catalog.transportTiers.values()].map((t) => t.ratePerMin)).toEqual([
      60, 120, 270, 480, 780, 1200, 300, 600,
    ])
  })

  it('namespaces ids and references', () => {
    const r = catalog.recipes.get('base:Recipe_IngotIron_C')!
    expect(r.machines).toEqual(['base:Build_SmelterMk1_C'])
    expect(r.inputs).toEqual([{ item: 'base:Desc_OreIron_C', amount: 1 }])
    expect(catalog.recipesProducing.get('base:Desc_IronIngot_C')).toContain(r.id)
  })

  it('knows fluids, gases and extractors', () => {
    expect(catalog.items.get('base:Desc_Water_C')?.form).toBe('liquid')
    expect(catalog.items.get('base:Desc_NitrogenGas_C')?.form).toBe('gas')
    expect(catalog.extractorsFor.get('base:Desc_OreIron_C')).toEqual([
      'base:Build_MinerMk1_C',
      'base:Build_MinerMk2_C',
      'base:Build_MinerMk3_C',
    ])
    expect(catalog.extractorsFor.get('base:Desc_Water_C')).toEqual([
      'base:Build_FrackingExtractor_C',
      'base:Build_WaterPump_C',
    ])
    expect(catalog.machines.get('base:Build_FrackingExtractor_C')?.extraction?.poweredBy).toBe(
      'base:Build_FrackingSmasher_C',
    )
  })

  it('counts the default map\'s resource sites', () => {
    const map = [...catalog.maps.values()][0]
    expect(map.id).toBe('base:default')
    const count = (resource: string, site: string) =>
      map.sites.filter((s) => s.resource === `base:${resource}` && s.site === site).reduce((n, s) => n + s.count, 0)
    expect(count('Desc_OreIron_C', 'node')).toBe(127)
    expect(count('Desc_LiquidOil_C', 'node')).toBe(30)
    expect(count('Desc_LiquidOil_C', 'well')).toBe(18)
    expect(count('Desc_Water_C', 'well')).toBe(55)
    expect(map.sites.every((s) => catalog.purities.has(s.purity))).toBe(true)
    expect(catalog.machines.get('base:Build_MinerMk3_C')?.extraction?.site).toBe('node')
    expect(catalog.machines.get('base:Build_FrackingExtractor_C')?.extraction?.site).toBe('well')
    expect(catalog.machines.get('base:Build_WaterPump_C')?.extraction?.site).toBeUndefined()
  })

  it('drops map sites with unknown resources', () => {
    const mod: DataPack = {
      manifest: { id: 'mod', name: 'Mod', version: '1', dependsOn: ['base'] },
      add: { maps: [{ id: 'island', name: 'Island', sites: [{ resource: 'base:Desc_OreIron_C', site: 'node', purity: 'base:pure', count: 2 }, { resource: 'Nope', site: 'node', purity: 'base:pure', count: 1 }] }] },
    }
    const built = buildCatalog([base, mod])
    expect(built.catalog.maps.get('mod:island')?.sites).toHaveLength(1)
    expect(built.diagnostics.map((d) => d.id)).toEqual(['mod:island'])
  })

  it('gives every recipe a power draw', () => {
    for (const r of catalog.recipes.values()) {
      const m = catalog.machines.get(r.machines[0])!
      if (m.generation) continue
      // Variable-power machines list 0 MW themselves; their recipes carry the range.
      expect(r.variablePower ? r.variablePower.maxMw : m.powerMw, r.id).toBeGreaterThan(0)
      if (r.variablePower) expect(m.powerMw, r.id).toBe(0)
    }
    expect(catalog.recipes.get('base:Recipe_SpaceElevatorPart_10_C')?.variablePower).toBeUndefined()
  })

  it('turns each generator fuel into a recipe, with water and waste', () => {
    const uranium = catalog.recipes.get('base:Recipe_GeneratorNuclear_NuclearFuelRod_C')!
    const perMin = (a: { amount: number }, r = uranium) => (a.amount * 60) / r.durationSec
    expect(catalog.machines.get(uranium.machines[0])!.generation).toEqual({ powerMw: 2500 })
    // 0.2 rods, 240 m³ water and 10 waste per minute (satisfactory.wiki.gg).
    expect(uranium.inputs.map((a) => perMin(a))).toEqual([0.2, 240])
    expect(uranium.outputs).toEqual([{ item: 'base:Desc_NuclearWaste_C', amount: 50 }])
    const plutonium = catalog.recipes.get('base:Recipe_GeneratorNuclear_PlutoniumFuelRod_C')!
    expect(perMin(plutonium.inputs[0], plutonium)).toBeCloseTo(0.1)
    expect(perMin(plutonium.outputs[0], plutonium)).toBeCloseTo(1)
    expect(catalog.recipes.get('base:Recipe_GeneratorNuclear_FicsoniumFuelRod_C')!.outputs).toEqual([])
    const coal = catalog.recipes.get('base:Recipe_GeneratorCoal_Coal_C')!
    expect(coal.inputs.map((a) => perMin(a, coal))).toEqual([15, 45])
    const fuel = catalog.recipes.get('base:Recipe_GeneratorFuel_LiquidFuel_C')!
    expect(fuel.inputs.map((a) => perMin(a, fuel))).toEqual([20])
    const waste = catalog.items.get('base:Desc_NuclearWaste_C')!
    expect(waste.radioactive).toBe(true)
    expect(waste.sinkPoints).toBeUndefined()
  })

  it('knows what unlocks every recipe', () => {
    for (const id of catalog.recipes.keys()) expect(catalog.schematicsFor.get(id)?.length, id).toBeGreaterThan(0)
    const s = (id: string) => catalog.schematics.get(`base:${id}`)!
    expect(s('Schematic_5-1_C')).toMatchObject({ name: 'Oil Processing', kind: 'milestone', tier: 5 })
    expect(s('Research_Caterium_2_C')).toMatchObject({ name: 'Quickwire', kind: 'research', group: 'Caterium' })
    expect(s('Schematic_Alternate_PureIronIngot_C')).toMatchObject({ kind: 'alternate', requires: ['base:Schematic_5-1_C'] })
    // Recipes no schematic lists come with their building: unpackaging with the Packager.
    expect(catalog.schematicsFor.get('base:Recipe_UnpackageWater_C')).toEqual(['base:Schematic_5-4_C'])
    expect(catalog.schematicsFor.get('base:Recipe_GeneratorCoal_Coal_C')).toEqual(['base:Schematic_3-1_C'])
  })

  it('names the items that go in shard and Somersloop slots', () => {
    const assembler = catalog.machines.get('base:Build_AssemblerMk1_C')!
    expect(assembler.overclock?.item).toBe('base:Desc_CrystalShard_C')
    expect(assembler.amplifier).toMatchObject({ slots: 2, item: 'base:Desc_WAT1_C' })
    expect(catalog.items.get('base:Desc_WAT1_C')?.name).toBe('Somersloop')
    expect(catalog.machines.get('base:Build_Packager_C')!.amplifier).toBeUndefined()
  })

  it('knows what every machine costs to build', () => {
    const cost = (id: string) =>
      Object.fromEntries(catalog.machines.get(`base:${id}`)!.buildCost!.map((a) => [catalog.items.get(a.item)!.name, a.amount]))
    for (const m of catalog.machines.values()) expect(m.buildCost?.length, m.id).toBeGreaterThan(0)
    // Checked against satisfactory.wiki.gg.
    expect(cost('Build_ConstructorMk1_C')).toEqual({ 'Reinforced Iron Plate': 2, Cable: 8 })
    expect(cost('Build_MinerMk3_C')).toEqual({
      'Portable Miner': 3,
      'Steel Pipe': 50,
      Supercomputer: 5,
      'Fused Modular Frame': 10,
      'Turbo Motor': 3,
    })
    expect(cost('Build_GeneratorNuclear_C')).toEqual({
      Concrete: 250,
      'Heavy Modular Frame': 25,
      Supercomputer: 10,
      Cable: 200,
      'Alclad Aluminum Sheet': 100,
    })
  })

  it('has an icon file for every item and machine', () => {
    for (const e of [...catalog.items.values(), ...catalog.machines.values()]) {
      expect(e.icon, e.id).toMatch(/^packs\/base\/icons\/.+\.png$/)
      expect(existsSync(new URL(`../../../public/${e.icon}`, import.meta.url)), e.icon).toBe(true)
    }
  })
})

const mod: DataPack = {
  manifest: { id: 'mymod', name: 'My Mod', version: '1.0.0', dependsOn: ['base'] },
  add: {
    items: [{ id: 'Desc_Gear_C', name: 'Gear', form: 'solid', icon: 'https://example.com/gear.png' }],
    machines: [
      {
        id: 'Build_SmelterMk2_C',
        name: 'Smelter Mk.2',
        category: 'production',
        powerMw: 8,
        powerExponent: 1.321929,
        speed: 2,
        ports: { belt: { in: 1, out: 1 }, pipe: { in: 0, out: 0 } },
      },
    ],
    recipes: [
      {
        id: 'Recipe_Gear_C',
        name: 'Gear',
        machines: ['base:Build_ConstructorMk1_C'],
        durationSec: 4,
        inputs: [{ item: 'base:Desc_IronPlate_C', amount: 2 }],
        outputs: [{ item: 'Desc_Gear_C', amount: 1 }],
        alternate: false,
      },
    ],
  },
  patch: {
    recipes: [
      { id: 'base:Recipe_IngotIron_C', durationSec: 1, machines: ['base:Build_SmelterMk1_C', 'Build_SmelterMk2_C'] },
    ],
  },
  remove: { recipes: ['base:Recipe_Alternate_PureIronIngot_C'] },
}

describe('pack merging', () => {
  it('applies a mod on top of base', () => {
    const { catalog, diagnostics } = buildCatalog([base, mod])
    expect(diagnostics).toEqual([])
    expect(catalog.packs.map((p) => p.id)).toEqual(['base', 'mymod'])
    expect(catalog.items.get('mymod:Desc_Gear_C')?.icon).toBe('https://example.com/gear.png')
    expect(catalog.recipes.get('mymod:Recipe_Gear_C')?.inputs[0].item).toBe('base:Desc_IronPlate_C')
    const ingot = catalog.recipes.get('base:Recipe_IngotIron_C')!
    expect(ingot.durationSec).toBe(1)
    expect(ingot.machines).toEqual(['base:Build_SmelterMk1_C', 'mymod:Build_SmelterMk2_C'])
    expect(ingot.outputs).toEqual([{ item: 'base:Desc_IronIngot_C', amount: 1 }])
    expect(catalog.recipes.has('base:Recipe_Alternate_PureIronIngot_C')).toBe(false)
    expect(catalog.recipesConsuming.get('base:Desc_IronPlate_C')).toContain('mymod:Recipe_Gear_C')
  })

  it('qualifies build costs, and drops a cost with unknown items', () => {
    const { catalog, diagnostics } = buildCatalog([
      base,
      {
        manifest: { id: 'costs', name: 'Costs', version: '1', dependsOn: ['base'] },
        patch: {
          machines: [
            { id: 'base:Build_SmelterMk1_C', buildCost: [{ item: 'base:Desc_IronPlate_C', amount: 3 }] },
            { id: 'base:Build_ConstructorMk1_C', buildCost: [{ item: 'Desc_Nope_C', amount: 1 }] },
          ],
        },
      },
    ])
    expect(catalog.machines.get('base:Build_SmelterMk1_C')!.buildCost).toEqual([{ item: 'base:Desc_IronPlate_C', amount: 3 }])
    expect(catalog.machines.get('base:Build_ConstructorMk1_C')!.buildCost).toBeUndefined()
    expect(diagnostics.map((d) => d.id)).toEqual(['base:Build_ConstructorMk1_C'])
  })

  it('merges schematics, indexed by recipe, and forgets removed recipes', () => {
    const { catalog, diagnostics } = buildCatalog([
      base,
      mod,
      {
        manifest: { id: 'gears', name: 'Gears', version: '1', dependsOn: ['base', 'mymod'] },
        add: { schematics: [{ id: 'Schematic_Gears_C', name: 'Gears', kind: 'milestone', tier: 2, recipes: ['mymod:Recipe_Gear_C'], requires: ['base:Schematic_2-1_C', 'Nope_C'] }] },
      },
    ])
    expect(diagnostics).toEqual([])
    const gears = catalog.schematics.get('gears:Schematic_Gears_C')!
    expect(gears.recipes).toEqual(['mymod:Recipe_Gear_C'])
    expect(gears.requires).toEqual(['base:Schematic_2-1_C'])
    expect(catalog.schematicsFor.get('mymod:Recipe_Gear_C')).toEqual(['gears:Schematic_Gears_C'])
    expect(catalog.schematicsFor.get('base:Recipe_Plastic_C')).toEqual(['base:Schematic_5-1_C'])
    // mymod removes Pure Iron Ingot: its hard drive unlocks nothing now.
    expect(catalog.schematics.get('base:Schematic_Alternate_PureIronIngot_C')!.recipes).toEqual([])
  })

  it('switches back to vanilla by leaving the mod out', () => {
    const { catalog } = buildCatalog([base, mod], { enabled: ['base'] })
    expect(catalog.items.has('mymod:Desc_Gear_C')).toBe(false)
    expect(catalog.recipes.get('base:Recipe_IngotIron_C')?.durationSec).toBe(2)
    expect(catalog.recipes.has('base:Recipe_Alternate_PureIronIngot_C')).toBe(true)
  })

  it('loads dependencies first regardless of order given', () => {
    const { catalog, diagnostics } = buildCatalog([mod, base], { enabled: ['mymod', 'base'] })
    expect(diagnostics).toEqual([])
    expect(catalog.packs.map((p) => p.id)).toEqual(['base', 'mymod'])
  })

  it('skips a pack whose dependency is missing', () => {
    const { catalog, diagnostics } = buildCatalog([mod])
    expect(catalog.packs).toEqual([])
    expect(diagnostics.some((d) => d.severity === 'error' && d.pack === 'mymod')).toBe(true)
  })

  it('drops recipes left dangling by a removal', () => {
    const noScrews: DataPack = {
      manifest: { id: 'noscrews', name: 'No Screws', version: '1', dependsOn: ['base'] },
      remove: { items: ['base:Desc_IronScrew_C'] },
    }
    const { catalog, diagnostics } = buildCatalog([base, noScrews])
    expect(catalog.recipes.has('base:Recipe_IronPlateReinforced_C')).toBe(false)
    expect(catalog.recipes.has('base:Recipe_Screw_C')).toBe(false)
    for (const r of catalog.recipes.values()) {
      expect([...r.inputs, ...r.outputs].every((a) => catalog.items.has(a.item))).toBe(true)
    }
    expect(diagnostics.filter((d) => d.severity === 'error').length).toBeGreaterThan(0)
  })

  it('rejects adds into another namespace and duplicate ids', () => {
    const bad: DataPack = {
      manifest: { id: 'bad', name: 'Bad', version: '1', dependsOn: ['base'] },
      add: {
        items: [
          { id: 'base:Desc_Hijack_C', name: 'Hijack', form: 'solid' },
          { id: 'Desc_Dup_C', name: 'A', form: 'solid' },
          { id: 'Desc_Dup_C', name: 'B', form: 'solid' },
        ],
      },
    }
    const { catalog, diagnostics } = buildCatalog([base, bad])
    expect(catalog.items.has('base:Desc_Hijack_C')).toBe(false)
    expect(catalog.items.get('bad:Desc_Dup_C')?.name).toBe('A')
    expect(diagnostics.filter((d) => d.pack === 'bad')).toHaveLength(2)
  })

  it('lets a standalone pack replace the base game', () => {
    const tiny: DataPack = {
      manifest: { id: 'tiny', name: 'Tiny', version: '1' },
      add: {
        items: [
          { id: 'Ore', name: 'Ore', form: 'solid' },
          { id: 'Bar', name: 'Bar', form: 'solid' },
        ],
        machines: [
          {
            id: 'Press',
            name: 'Press',
            category: 'production',
            powerMw: 1,
            powerExponent: 1,
            speed: 1,
            ports: { belt: { in: 1, out: 1 }, pipe: { in: 0, out: 0 } },
          },
        ],
        recipes: [
          {
            id: 'Bar',
            name: 'Bar',
            machines: ['Press'],
            durationSec: 1,
            inputs: [{ item: 'Ore', amount: 1 }],
            outputs: [{ item: 'Bar', amount: 1 }],
            alternate: false,
          },
        ],
      },
    }
    const { catalog, diagnostics } = buildCatalog([base, tiny], { enabled: ['tiny'] })
    expect(diagnostics).toEqual([])
    expect(catalog.items.size).toBe(2)
    expect(catalog.recipesProducing.get('tiny:Bar')).toEqual(['tiny:Bar'])
  })
})

describe('icons', () => {
  it('resolves against the site base', () => {
    expect(iconUrl('packs/base/icons/X.png', '/satisfactory-tools/')).toBe('/satisfactory-tools/packs/base/icons/X.png')
    expect(iconUrl('data:image/png;base64,AA', '/x/')).toBe('data:image/png;base64,AA')
    expect(iconUrl(undefined, '/')).toBeUndefined()
  })

  it('makes placeholders', () => {
    expect(placeholderFor('Reinforced Iron Plate').initials).toBe('RI')
    expect(placeholderFor('Alternate: Pure Iron Ingot').initials).toBe('PI')
    expect(placeholderFor('Wire').initials).toBe('WI')
    expect(placeholderFor('Water', '#7ab0d4').background).toBe('#7ab0d4')
    expect(placeholderFor('Gear').background).toBe(placeholderFor('Gear').background)
  })
})
