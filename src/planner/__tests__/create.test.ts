import { describe, expect, it } from 'vitest'
import { consumersOf, createNode, goalOptions, paletteOptions, producersOf, resourceOptions, searchOptions } from '../create'
import type { PickOption } from '../create'
import { catalog } from './fixtures'

const label = (o: PickOption) =>
  o.kind === 'recipe' ? o.recipe.name : o.kind === 'extractor' ? `${o.kind}:${o.machine.name}` : `${o.kind}:${o.item.name}`

describe('picker options', () => {
  it('producers: extractors, recipes (standard first), then supply', () => {
    const ore = producersOf(catalog, 'base:Desc_OreIron_C').map(label)
    expect(ore.slice(0, 3)).toEqual(['extractor:Miner Mk.1', 'extractor:Miner Mk.2', 'extractor:Miner Mk.3'])
    expect(ore[ore.length - 1]).toBe('supply:Iron Ore')

    const ingot = producersOf(catalog, 'base:Desc_IronIngot_C')
    expect(label(ingot[0])).toBe('Iron Ingot')
    const firstAlt = ingot.findIndex((o) => o.kind === 'recipe' && o.recipe.alternate)
    expect(firstAlt).toBeGreaterThan(0)
    expect(ingot.slice(firstAlt, -1).every((o) => o.kind === 'recipe' && o.recipe.alternate)).toBe(true)
  })

  it('consumers: goal first, then recipes using the item', () => {
    const plate = consumersOf(catalog, 'base:Desc_IronPlate_C').map(label)
    expect(plate[0]).toBe('goal:Iron Plate')
    expect(plate).toContain('Reinforced Iron Plate')
  })

  it('searches by recipe or product name', () => {
    const found = searchOptions(producersOf(catalog, 'base:Desc_IronIngot_C'), catalog, 'pure').map(label)
    expect(found).toEqual(['Pure Iron Ingot'])
  })

  it('quick-start lists: every resource/extractor pair, every item as a goal', () => {
    const res = resourceOptions(catalog).map(label)
    expect(res.slice(0, 3)).toEqual(['extractor:Miner Mk.1', 'extractor:Miner Mk.2', 'extractor:Miner Mk.3'])
    expect(searchOptions(resourceOptions(catalog), catalog, 'iron').map(label)).toHaveLength(3)
    expect(searchOptions(resourceOptions(catalog), catalog, 'iron mk.2').map(label)).toEqual(['extractor:Miner Mk.2'])
    expect(searchOptions(resourceOptions(catalog), catalog, 'copper mk3').map(label)).toEqual(['extractor:Miner Mk.3'])
    expect(goalOptions(catalog)).toHaveLength(catalog.items.size)
  })

  it('palette finds items and recipes', () => {
    const opts = paletteOptions(catalog, 'screw').map(label)
    expect(opts[0]).toBe('goal:Screw')
    expect(opts).toContain('supply:Screw')
    expect(opts).toContain('Screw')
    expect(paletteOptions(catalog, '')).toEqual([])
    expect(paletteOptions(catalog, 'iron ore').map(label)).toContain('extractor:Miner Mk.2')
  })
})

describe('createNode defaults', () => {
  const at = { x: 1, y: 2 }
  const ore = catalog.items.get('base:Desc_OreIron_C')!
  const mk2 = catalog.machines.get('base:Build_MinerMk2_C')!

  it('drag-created nodes are flexible, goals take Max', () => {
    expect(createNode({ kind: 'extractor', machine: mk2, resource: ore }, 'a', at, 'producer', catalog)).toMatchObject({
      limited: false,
      sites: [{ purity: 'base:normal', count: 1 }],
    })
    expect(createNode({ kind: 'goal', item: ore }, 'b', at, 'consumer', catalog)).toMatchObject({ target: 'max' })
  })

  it('palette sources are limits, goals are numbers', () => {
    expect(createNode({ kind: 'supply', item: ore }, 'c', at, 'palette', catalog)).toMatchObject({ limited: true, perMin: 60 })
    expect(createNode({ kind: 'goal', item: ore }, 'd', at, 'palette', catalog)).toMatchObject({ target: 60 })
  })

  it('recipes use their first machine', () => {
    const recipe = catalog.recipes.get('base:Recipe_IronPlate_C')!
    expect(createNode({ kind: 'recipe', recipe }, 'e', at, 'producer', catalog)).toMatchObject({
      kind: 'recipe',
      machine: 'base:Build_ConstructorMk1_C',
      limited: false,
      clock: 1,
    })
  })
})
