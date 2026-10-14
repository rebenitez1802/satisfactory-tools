import { describe, expect, it } from 'vitest'
import { builtCount, buildCost, doneShortfall, isDone } from '../buildcost'
import { markDone } from '../edit'
import { solvePlan } from '../solve'
import type { Plan } from '../types'
import { catalog, extractorNode, goalNode, plan, recipeNode, withPacks } from './fixtures'

// 90 plates/min: 4.5 Constructors, 135 ingots (4.5 Smelters), 135 ore (2.25 Mk.1 miners on normal nodes).
const chain = (o: Partial<Plan> = {}) =>
  plan(
    [
      extractorNode('ore', 'Build_MinerMk1_C', 'Desc_OreIron_C', [{ purity: 'base:normal', count: 1 }]),
      recipeNode('smelt', 'Recipe_IngotIron_C', 'Build_SmelterMk1_C'),
      recipeNode('plate', 'Recipe_IronPlate_C', 'Build_ConstructorMk1_C'),
      goalNode('goal', 'Desc_IronPlate_C', 90),
    ],
    [
      ['ore', 'smelt', 'Desc_OreIron_C'],
      ['smelt', 'plate', 'Desc_IronIngot_C'],
      ['plate', 'goal', 'Desc_IronPlate_C'],
    ],
    o,
  )

const amounts = (list: { item: string; amount: number }[]) =>
  Object.fromEntries(list.filter((a) => a.amount > 0).map((a) => [a.item.replace(/^base:/, ''), a.amount]))

// 5 Constructors (2 reinforced plates + 8 cable each), 5 Smelters (5 rods +
// 8 wire), 3 Mk.1 Miners (1 portable miner + 10 iron plates + 10 concrete).
const CHAIN_COST = {
  Desc_IronPlateReinforced_C: 10,
  Desc_Cable_C: 40,
  Desc_IronRod_C: 25,
  Desc_Wire_C: 40,
  BP_ItemDescriptorPortableMiner_C: 3,
  Desc_IronPlate_C: 30,
  Desc_Cement_C: 30,
}

const costOf = (p: Plan, c = catalog) => buildCost(p, solvePlan(p, c), c)

describe('build cost', () => {
  it('counts every building whole, per node', () => {
    const cost = costOf(chain())
    expect(amounts(cost.total)).toEqual(CHAIN_COST)
    expect(amounts(cost.needed)).toEqual(CHAIN_COST)
    expect(cost.unknown).toEqual([])
    expect(cost).toMatchObject({ done: 0, nodes: 4, behind: 0 })
  })

  it('is the same in either machine mode', () => {
    expect(amounts(costOf(chain({ settings: { machineMode: 'underclock' } })).total)).toEqual(CHAIN_COST)
  })

  it('leaves out nodes marked done', () => {
    const p = chain()
    const result = solvePlan(p, catalog)
    const done = markDone(p, ['plate', 'ore'], (id) => builtCount(result.nodes.get(id)))
    const cost = buildCost(done, result, catalog)
    expect(cost.done).toBe(2)
    expect(amounts(cost.total)).toEqual(CHAIN_COST)
    expect(amounts(cost.needed)).toEqual({ Desc_IronRod_C: 25, Desc_Wire_C: 40 })
    // Rows stay, at 0, so the summary can show "0 of 30".
    expect(cost.needed.map((a) => a.item)).toEqual(cost.total.map((a) => a.item))
  })

  it('a done node that needs more machines since is not done, and costs only the extra', () => {
    // Marked done with 3 Constructors (60/min); the goal then went up to 90.
    const p = markDone(chain(), ['plate'], () => 3)
    const result = solvePlan(p, catalog)
    const plate = result.nodes.get('plate')
    expect(doneShortfall(p.nodes[2], plate)).toEqual({ built: 3, needs: 5 })
    expect(isDone(p.nodes[2], plate)).toBe(false)
    expect(doneShortfall(p.nodes[1], result.nodes.get('smelt'))).toBeUndefined()
    const cost = buildCost(p, result, catalog)
    expect(cost).toMatchObject({ done: 0, behind: 1 })
    expect(amounts(cost.needed).Desc_IronPlateReinforced_C).toBe(4)
    expect(amounts(cost.needed).Desc_Cable_C).toBe(16)
    // Back down to 60/min: done again, with the mark it had.
    const less = { ...p, nodes: p.nodes.map((n) => (n.id === 'goal' ? { ...n, target: 60 } : n)) }
    const after = buildCost(less, solvePlan(less, catalog), catalog)
    expect(after).toMatchObject({ done: 1, behind: 0 })
    // Fewer machines than marked never counts as behind.
    expect(isDone(markDone(p, ['plate'], () => 9).nodes[2], plate)).toBe(true)
  })

  it('counts a resource well pressurizer once, and as built with its done node', () => {
    const p = plan(
      [
        extractorNode('well', 'Build_FrackingExtractor_C', 'Desc_NitrogenGas_C', [{ purity: 'base:normal', count: 1 }]),
        goalNode('goal', 'Desc_NitrogenGas_C', 300),
      ],
      [['well', 'goal', 'Desc_NitrogenGas_C']],
    )
    const result = solvePlan(p, catalog)
    // 60 m³/min per normal satellite: 5 satellites and their pressurizer.
    expect(result.nodes.get('well')!.buildings).toEqual([
      { machine: 'base:Build_FrackingExtractor_C', count: 5 },
      { machine: 'base:Build_FrackingSmasher_C', count: 1 },
    ])
    expect(amounts(buildCost(p, result, catalog).total)).toMatchObject({ Desc_SteelPlate_C: 50, Desc_Rubber_C: 100 })
    const needed = amounts(buildCost(markDone(p, ['well'], () => 4), result, catalog).needed)
    expect(needed).toEqual({ Desc_SteelPlate_C: 10, Desc_AluminumCasing_C: 10 })
  })

  it('lists machines with no known cost instead of counting them as free', () => {
    const c = withPacks({
      manifest: { id: 'mod', name: 'Mod', version: '1', dependsOn: ['base'] },
      patch: { machines: [{ id: 'base:Build_ConstructorMk1_C', buildCost: undefined }] },
    })
    const cost = costOf(chain(), c)
    expect(cost.unknown).toEqual(['base:Build_ConstructorMk1_C'])
    expect(amounts(cost.total).Desc_Cable_C).toBeUndefined()
  })
})
