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
    expect(catalog.recipes.size).toBe(276)
    expect([...catalog.recipes.values()].filter((r) => r.alternate)).toHaveLength(111)
    expect([...catalog.machines.values()].filter((m) => m.category === 'production')).toHaveLength(11)
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

  it('gives every recipe a power draw', () => {
    for (const r of catalog.recipes.values()) {
      const m = catalog.machines.get(r.machines[0])!
      // Variable-power machines list 0 MW themselves; their recipes carry the range.
      expect(r.variablePower ? r.variablePower.maxMw : m.powerMw, r.id).toBeGreaterThan(0)
      if (r.variablePower) expect(m.powerMw, r.id).toBe(0)
    }
    expect(catalog.recipes.get('base:Recipe_SpaceElevatorPart_10_C')?.variablePower).toBeUndefined()
  })

  it('names the items that go in shard and Somersloop slots', () => {
    const assembler = catalog.machines.get('base:Build_AssemblerMk1_C')!
    expect(assembler.overclock?.item).toBe('base:Desc_CrystalShard_C')
    expect(assembler.amplifier).toMatchObject({ slots: 2, item: 'base:Desc_WAT1_C' })
    expect(catalog.items.get('base:Desc_WAT1_C')?.name).toBe('Somersloop')
    expect(catalog.machines.get('base:Build_Packager_C')!.amplifier).toBeUndefined()
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
