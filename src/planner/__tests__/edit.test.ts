import { describe, expect, it } from 'vitest'
import { connectPorts, copyNodes, duplicateNodes, markDone, pasteClip, removeEdges, retargetEdges, pruneEdges, removeNodes, sameProductRecipes, setRecipe, updateNode, validatePlan } from '../edit'
import { catalog, extractorNode, goalNode, plan, recipeNode } from './fixtures'

const chain = () =>
  plan(
    [
      extractorNode('ore', 'Build_MinerMk1_C', 'Desc_OreIron_C', [{ purity: 'base:normal', count: 1 }]),
      recipeNode('smelt', 'Recipe_IngotIron_C', 'Build_SmelterMk1_C', { sloops: 1 }),
      recipeNode('plate', 'Recipe_IronPlate_C', 'Build_ConstructorMk1_C'),
      goalNode('goal', 'Desc_IronPlate_C', 20),
    ],
    [
      ['ore', 'smelt', 'Desc_OreIron_C'],
      ['smelt', 'plate', 'Desc_IronIngot_C'],
      ['plate', 'goal', 'Desc_IronPlate_C'],
    ],
  )

describe('plan edits', () => {
  it('switching to an alternate keeps belts that still fit', () => {
    // Pure Iron Ingot runs in a Refinery: ore + water → ingots; machine changes, belts stay.
    const p = setRecipe(chain(), 'smelt', 'base:Recipe_Alternate_PureIronIngot_C', catalog)
    const smelt = p.nodes.find((n) => n.id === 'smelt')!
    expect(smelt).toMatchObject({ recipe: 'base:Recipe_Alternate_PureIronIngot_C', machine: 'base:Build_OilRefinery_C' })
    expect(p.edges).toHaveLength(3)
  })

  it('switching to an unrelated recipe drops belts that no longer fit', () => {
    const p = setRecipe(chain(), 'smelt', 'base:Recipe_IngotCopper_C', catalog)
    expect(p.edges.map((e) => e.id)).toEqual(['e2'])
  })

  it('changing an extractor resource drops its old belt', () => {
    const p = updateNode(chain(), 'ore', { resource: 'base:Desc_OreCopper_C' }, catalog)
    expect(p.edges.map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  it('pruning keeps belts on unresolved nodes', () => {
    const base = chain()
    const p = { ...base, nodes: base.nodes.map((n) => (n.id === 'plate' ? { ...n, recipe: 'gone:Recipe_X_C' } : n)) }
    expect(pruneEdges(p, catalog)).toBe(p)
  })

  it('removes nodes with their belts and duplicates without', () => {
    expect(removeNodes(chain(), ['smelt']).edges.map((e) => e.id)).toEqual(['e2'])
    let i = 0
    const d = duplicateNodes(chain(), ['plate'], () => `copy${++i}`)
    expect(d.nodes.map((n) => n.id)).toEqual(['ore', 'smelt', 'plate', 'goal', 'copy1'])
    expect(d.edges).toHaveLength(3)
  })

  it('copies and pastes nodes with the belts between them', () => {
    const clip = copyNodes(chain(), ['smelt', 'plate'])
    expect(clip.nodes.map((n) => n.id)).toEqual(['smelt', 'plate'])
    expect(clip.edges.map((e) => e.id)).toEqual(['e1'])
    let i = 0
    const { plan: p, ids } = pasteClip(chain(), clip, () => `c${++i}`, { x: 100, y: 0 })
    expect(ids).toEqual(['c1', 'c2'])
    expect(p.nodes).toHaveLength(6)
    expect(p.edges[p.edges.length - 1]).toMatchObject({ source: 'c1', target: 'c2', item: 'base:Desc_IronIngot_C' })
    expect(p.nodes.find((n) => n.id === 'c1')!.position.x).toBe(100)
  })

  it('connects to the matching port of a dropped-on node', () => {
    const p = { ...chain(), edges: [] }
    // From the smelter's ingot output onto the constructor: smelter → plate.
    expect(connectPorts(p, catalog, 'smelt', 'base:Desc_IronIngot_C', 'out', 'plate', ).edges).toEqual([
      { id: 'smelt->plate:base:Desc_IronIngot_C', source: 'smelt', target: 'plate', item: 'base:Desc_IronIngot_C' },
    ])
    // From the constructor's ingot input onto the smelter: same belt.
    expect(connectPorts(p, catalog, 'plate', 'base:Desc_IronIngot_C', 'in', 'smelt').edges[0].source).toBe('smelt')
    // Onto a node without that item: nothing.
    expect(connectPorts(p, catalog, 'smelt', 'base:Desc_IronIngot_C', 'out', 'goal')).toBe(p)
    // Existing belt: nothing.
    expect(connectPorts(chain(), catalog, 'ore', 'base:Desc_OreIron_C', 'out', 'smelt').edges).toHaveLength(3)
  })

  it('moves a belt to another consumer, or deletes it', () => {
    const base = chain()
    const withSecond = { ...base, nodes: [...base.nodes, recipeNode('plate2', 'Recipe_IronPlate_C', 'Build_ConstructorMk1_C')] }
    const moved = retargetEdges(withSecond, catalog, ['e1'], 'plate2')
    expect(moved.edges.map((e) => `${e.source}>${e.target}`)).toEqual(['ore>smelt', 'plate>goal', 'smelt>plate2'])
    expect(retargetEdges(withSecond, catalog, ['e1'], 'goal')).toBe(withSecond)
    expect(removeEdges(base, ['e1']).edges.map((e) => e.id)).toEqual(['e0', 'e2'])
  })

  it('lists recipes with the same main product', () => {
    const ids = sameProductRecipes(catalog, 'base:Recipe_IngotIron_C')
    expect(ids).toContain('base:Recipe_Alternate_PureIronIngot_C')
    expect(ids).toContain('base:Recipe_IngotIron_C')
  })

  it('lists the other fuels for a generator', () => {
    expect(sameProductRecipes(catalog, 'base:Recipe_GeneratorNuclear_NuclearFuelRod_C').sort()).toEqual([
      'base:Recipe_GeneratorNuclear_FicsoniumFuelRod_C',
      'base:Recipe_GeneratorNuclear_NuclearFuelRod_C',
      'base:Recipe_GeneratorNuclear_PlutoniumFuelRod_C',
    ])
  })

  it('validates plan files', () => {
    expect(validatePlan(chain())).toBeUndefined()
    expect(validatePlan(null)).toBe('Not a plan file.')
    expect(validatePlan({ hello: 1 })).toBe('Not a plan file.')
    expect(validatePlan({ ...chain(), schemaVersion: 2 })).toBe('Unsupported plan version.')
    const bad = chain()
    bad.edges.push({ id: 'x', source: 'nope', target: 'goal', item: 'base:Desc_IronPlate_C' })
    expect(validatePlan(bad)).toBe('Plan has an invalid connection.')
  })
})

describe('build checklist marks', () => {
  const doneOf = (p: ReturnType<typeof chain>, id: string) => p.nodes.find((n) => n.id === id)!.done

  it('marks nodes done with their machine count, and clears the mark', () => {
    const p = markDone(chain(), ['smelt', 'plate'], (id) => (id === 'smelt' ? 4 : 2))
    expect(doneOf(p, 'smelt')).toEqual({ count: 4 })
    expect(doneOf(p, 'plate')).toEqual({ count: 2 })
    expect(doneOf(p, 'ore')).toBeUndefined()
    const cleared = markDone(p, ['smelt'], false)
    expect(doneOf(cleared, 'smelt')).toBeUndefined()
    expect('done' in cleared.nodes.find((n) => n.id === 'smelt')!).toBe(false)
    expect(doneOf(cleared, 'plate')).toEqual({ count: 2 })
  })

  it('copies start not done', () => {
    const p = markDone(chain(), ['smelt', 'plate'], () => 1)
    let n = 0
    const pasted = pasteClip(p, copyNodes(p, ['smelt', 'plate']), () => `new${n++}`)
    expect(pasted.plan.nodes.filter((x) => pasted.ids.includes(x.id)).map((x) => x.done)).toEqual([undefined, undefined])
    expect(doneOf(pasted.plan, 'smelt')).toEqual({ count: 1 })
    const dup = duplicateNodes(p, ['plate'], () => 'dup')
    expect(doneOf(dup, 'dup')).toBeUndefined()
  })

  it('a new recipe, machine or resource clears the mark; other edits keep it', () => {
    const p = markDone(chain(), ['ore', 'smelt', 'plate'], () => 2)
    expect(doneOf(updateNode(p, 'smelt', { clock: 0.5, label: 'Smelters' }, catalog), 'smelt')).toEqual({ count: 2 })
    expect(doneOf(updateNode(p, 'smelt', { recipe: 'base:Recipe_IngotIron_C' }, catalog), 'smelt')).toEqual({ count: 2 })
    expect(doneOf(setRecipe(p, 'smelt', 'base:Recipe_Alternate_PureIronIngot_C', catalog), 'smelt')).toBeUndefined()
    expect(doneOf(updateNode(p, 'ore', { machine: 'base:Build_MinerMk2_C' }, catalog), 'ore')).toBeUndefined()
    expect(doneOf(updateNode(p, 'ore', { resource: 'base:Desc_OreCopper_C' }, catalog), 'ore')).toBeUndefined()
  })
})
