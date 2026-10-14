import { describe, expect, it } from 'vitest'
import { solvePlan } from '../solve'
import type { Plan, PlanNode } from '../types'
import { catalog, extractorNode, goalNode, machine, plan, recipeNode, supplyNode } from './fixtures'

// Iron Ore → Smelter (30 → 30 ingots/min) → Constructor (30 ingots → 20 plates/min).
const ORE = 'Desc_OreIron_C'
const INGOT = 'Desc_IronIngot_C'
const PLATE = 'Desc_IronPlate_C'
const smelters = (o = {}) => recipeNode('smelt', 'Recipe_IngotIron_C', 'Build_SmelterMk1_C', o)
const constructors = (o = {}) => recipeNode('plate', 'Recipe_IronPlate_C', 'Build_ConstructorMk1_C', o)
const chain: [string, string, string][] = [
  ['ore', 'smelt', ORE],
  ['smelt', 'plate', INGOT],
  ['plate', 'goal', PLATE],
]
/** A Mk.1 miner on a normal node at 150%: 90 ore/min. */
const miner90 = (limited: boolean) =>
  extractorNode('ore', 'Build_MinerMk1_C', ORE, [{ purity: 'base:normal', count: 1 }], { clock: 1.5, limited })

function ironChain(source: PlanNode, target: number | 'max', o: { constructors?: object; plan?: Partial<Plan> } = {}) {
  return solvePlan(plan([source, smelters(), constructors(o.constructors), goalNode('goal', PLATE, target)], chain, o.plan), catalog)
}

describe('targets and limits (spec examples)', () => {
  it('forward: limited miner, Max goal', () => {
    const r = ironChain(miner90(true), 'max')
    expect(r.goals[0].achieved).toBeCloseTo(60)
    expect(r.nodes.get('smelt')!.setup!.count).toBeCloseTo(3)
    expect(r.nodes.get('plate')!.setup!.count).toBeCloseTo(3)
    expect(r.nodes.get('ore')!.bottleneck).toBe(true)
    expect(r.nodes.get('ore')!.utilization).toBeCloseTo(1)
    expect(r.diagnostics).toEqual([])
  })

  it('backward: target, nothing limited', () => {
    const r = ironChain(miner90(false), 120)
    expect(r.goals[0].achieved).toBe(120)
    expect(r.nodes.get('ore')!.activity).toBeCloseTo(180)
    expect(r.nodes.get('smelt')!.setup!.count).toBeCloseTo(6)
    expect(r.nodes.get('plate')!.setup!.count).toBeCloseTo(6)
    // The configured site gives 90, so a flexible miner reports it needs twice that.
    expect(r.nodes.get('ore')!.utilization).toBeCloseTo(2)
    expect(r.nodes.get('ore')!.bottleneck).toBe(false)
    expect(r.diagnostics.map((d) => d.nodeId)).toEqual(['ore'])
  })

  it('mixed: the limit is the bottleneck', () => {
    const r = ironChain(miner90(true), 120)
    expect(r.goals[0]).toMatchObject({ requested: 120 })
    expect(r.goals[0].achieved).toBeCloseTo(60)
    expect(r.nodes.get('ore')!.bottleneck).toBe(true)
  })

  it('mixed: plenty of resource leaves some unused', () => {
    const r = ironChain(supplyNode('ore', ORE, 300), 120)
    expect(r.goals[0].achieved).toBe(120)
    const ore = r.nodes.get('ore')!
    expect(ore.activity).toBeCloseTo(180)
    expect(ore.limit! - ore.activity).toBeCloseTo(120)
    expect(ore.bottleneck).toBe(false)
  })

  it('a limited machine group in the middle', () => {
    const r = ironChain(miner90(false), 'max', { constructors: { limited: true, count: 4 } })
    expect(r.goals[0].achieved).toBeCloseTo(80)
    expect(r.nodes.get('ore')!.activity).toBeCloseTo(120)
    expect(r.nodes.get('plate')!.bottleneck).toBe(true)
    expect(r.nodes.get('plate')!.setup).toMatchObject({ count: 4 })
  })
})

describe('solver', () => {
  it('sources report their capacity; a lone limited source runs flat out', () => {
    const miner = extractorNode('ore', 'Build_MinerMk2_C', ORE, [{ purity: 'base:pure', count: 1 }], { limited: true })
    const r = solvePlan(plan([miner, supplyNode('s', INGOT, 45)]), catalog)
    expect(r.nodes.get('ore')).toMatchObject({ activity: 240, capacity: 240 })
    expect(r.nodes.get('s')).toMatchObject({ activity: 45, capacity: 45 })
    expect(r.goals.map((g) => g.openEndOf)).toEqual(['ore', 's'])
  })

  it('a chain with a limit and no goal fills its open end', () => {
    const miner = extractorNode('ore', 'Build_MinerMk2_C', ORE, [{ purity: 'base:pure', count: 1 }], { limited: true })
    const r = solvePlan(plan([miner, smelters()], [['ore', 'smelt', ORE]]), catalog)
    expect(r.nodes.get('smelt')!.setup!.count).toBeCloseTo(8)
    expect(r.goals).toEqual([{ id: '~open:smelt', item: `base:${INGOT}`, requested: 'max', achieved: 240, openEndOf: 'smelt' }])
    expect(r.edges.size).toBe(1)
    expect([...r.nodes.keys()]).toEqual(['ore', 'smelt'])
    // Its output has no real belt, though the open end uses all of it.
    expect(r.nodes.get('smelt')!.outputs[0]).toMatchObject({ produced: 240, used: 240, connected: false })
    expect(r.nodes.get('ore')!.outputs[0]).toMatchObject({ connected: true })
    expect(r.totals.delivered).toEqual([{ item: `base:${INGOT}`, perMin: 240 }])
  })

  it('several Max goals behind one limit share it evenly', () => {
    // 120 ore → 120 ingots, split between plates and rods: 60 ingots each.
    const miner = extractorNode('ore', 'Build_MinerMk2_C', ORE, [{ purity: 'base:normal', count: 1 }], { limited: true })
    const rods = recipeNode('rods', 'Recipe_IronRod_C', 'Build_ConstructorMk1_C')
    const open = solvePlan(
      plan([miner, smelters(), constructors(), rods], [['ore', 'smelt', ORE], ['smelt', 'plate', INGOT], ['smelt', 'rods', INGOT]]),
      catalog,
    )
    expect(open.goals.map((g) => [g.openEndOf, +g.achieved.toFixed(6)])).toEqual([
      ['plate', 40],
      ['rods', 60],
    ])
    expect(open.nodes.get('ore')!.activity).toBeCloseTo(120)
    expect(open.splits[0].edges.map((e) => e.perMin)).toEqual([60, 60])

    // Same with explicit Max goals.
    const explicit = solvePlan(
      plan(
        [miner, smelters(), constructors(), rods, goalNode('goal', PLATE, 'max'), goalNode('g2', 'Desc_IronRod_C', 'max')],
        [['ore', 'smelt', ORE], ['smelt', 'plate', INGOT], ['smelt', 'rods', INGOT], ['plate', 'goal', PLATE], ['rods', 'g2', 'Desc_IronRod_C']],
      ),
      catalog,
    )
    expect(explicit.goals.map((g) => +g.achieved.toFixed(6))).toEqual([40, 60])
  })

  it('a Max goal next to a numeric target gets what is left', () => {
    const miner = extractorNode('ore', 'Build_MinerMk2_C', ORE, [{ purity: 'base:normal', count: 1 }], { limited: true })
    const r = solvePlan(
      plan(
        [miner, smelters(), constructors(), recipeNode('rods', 'Recipe_IronRod_C', 'Build_ConstructorMk1_C'), goalNode('goal', PLATE, 20), goalNode('g2', 'Desc_IronRod_C', 'max')],
        [['ore', 'smelt', ORE], ['smelt', 'plate', INGOT], ['smelt', 'rods', INGOT], ['plate', 'goal', PLATE], ['rods', 'g2', 'Desc_IronRod_C']],
      ),
      catalog,
    )
    // 20 plates take 30 ingots; rods get the other 90.
    expect(r.goals.map((g) => +g.achieved.toFixed(6))).toEqual([20, 90])
  })

  it('no open-end goals once the chain has a goal, or without limits', () => {
    const flexible = solvePlan(plan([miner90(false), smelters()], [['ore', 'smelt', ORE]]), catalog)
    expect(flexible.goals).toEqual([])
    const withGoal = ironChain(miner90(true), 30)
    expect(withGoal.goals.map((g) => g.openEndOf)).toEqual([undefined])
  })

  it('Max goal with nothing limited is reported, not infinite', () => {
    const r = ironChain(miner90(false), 'max')
    expect(r.goals[0].achieved).toBe(0)
    expect(r.diagnostics.some((d) => d.nodeId === 'goal')).toBe(true)
  })

  it('limited machines that are not fully used run underclocked', () => {
    const r = ironChain(miner90(false), 40, { constructors: { limited: true, count: 4 } })
    const plate = r.nodes.get('plate')!
    expect(plate.setup).toMatchObject({ count: 4 })
    expect(plate.setup!.clock).toBeCloseTo(0.5)
    expect(plate.utilization).toBeCloseTo(0.5)
    expect(plate.bottleneck).toBe(false)
  })

  it('byproducts become surplus and unconnected inputs are missing', () => {
    const r = solvePlan(
      plan(
        [recipeNode('rubber', 'Recipe_Rubber_C', 'Build_OilRefinery_C'), goalNode('goal', 'Desc_Rubber_C', 40)],
        [['rubber', 'goal', 'Desc_Rubber_C']],
      ),
      catalog,
    )
    expect(r.nodes.get('rubber')!.activity).toBeCloseTo(2)
    expect(r.totals.surplus).toEqual([{ item: 'base:Desc_HeavyOilResidue_C', perMin: 40 }])
    expect(r.totals.missingInputs).toEqual([{ item: 'base:Desc_LiquidOil_C', perMin: 60 }])
    expect(r.nodes.get('rubber')!.inputs[0]).toMatchObject({ needed: 60, supplied: 0, connected: false })
  })

  it('a shared producer sums demand and shows up as a split', () => {
    const r = solvePlan(
      plan(
        [
          supplyNode('ore', ORE, 0, false),
          smelters(),
          constructors(),
          recipeNode('rod', 'Recipe_IronRod_C', 'Build_ConstructorMk1_C'),
          goalNode('goal', PLATE, 20),
          goalNode('rods', 'Desc_IronRod_C', 15),
        ],
        [...chain, ['smelt', 'rod', INGOT], ['rod', 'rods', 'Desc_IronRod_C']],
      ),
      catalog,
    )
    expect(r.nodes.get('smelt')!.activity).toBeCloseTo(1.5)
    expect(r.splits).toHaveLength(1)
    expect(r.splits[0]).toMatchObject({ node: 'smelt', item: `base:${INGOT}`, produced: 45, leftover: 0 })
    expect(r.splits[0].edges.map((e) => e.perMin)).toEqual([30, 15])
  })

  it('splits demand across several producers by share', () => {
    const r = solvePlan(
      plan(
        [
          smelters(),
          recipeNode('smelt2', 'Recipe_IngotIron_C', 'Build_SmelterMk1_C'),
          constructors(),
          goalNode('goal', PLATE, 40),
        ],
        [
          ['smelt', 'plate', INGOT, 1],
          ['smelt2', 'plate', INGOT, 3],
          ['plate', 'goal', PLATE],
        ],
      ),
      catalog,
    )
    expect(r.nodes.get('smelt')!.activity).toBeCloseTo(0.5)
    expect(r.nodes.get('smelt2')!.activity).toBeCloseTo(1.5)
    expect(r.merges).toHaveLength(1)
  })

  it('independent chains do not limit each other', () => {
    const a = (id: string) => `${id}A`
    const nodes: PlanNode[] = [
      { ...miner90(true), id: a('ore') },
      { ...smelters(), id: a('smelt') },
      { ...constructors(), id: a('plate') },
      goalNode(a('goal'), PLATE, 120),
      supplyNode('ore', ORE, 1000),
      smelters(),
      constructors(),
      goalNode('goal', PLATE, 120),
    ]
    const edges: [string, string, string][] = [...chain, ...chain.map(([s, t, i]): [string, string, string] => [a(s), a(t), i])]
    const r = solvePlan(plan(nodes, edges), catalog)
    expect(r.goals.find((g) => g.id === 'goalA')!.achieved).toBeCloseTo(60)
    expect(r.goals.find((g) => g.id === 'goal')!.achieved).toBe(120)
  })

  it('settles loops', () => {
    // Recycled Plastic ⇄ Recycled Rubber: P = 60 + P/4 → 80 plastic, 40 rubber.
    const r = solvePlan(
      plan(
        [
          recipeNode('rp', 'Recipe_Alternate_Plastic_1_C', 'Build_OilRefinery_C'),
          recipeNode('rr', 'Recipe_Alternate_RecycledRubber_C', 'Build_OilRefinery_C'),
          goalNode('goal', 'Desc_Plastic_C', 60),
        ],
        [
          ['rp', 'goal', 'Desc_Plastic_C'],
          ['rp', 'rr', 'Desc_Plastic_C'],
          ['rr', 'rp', 'Desc_Rubber_C'],
        ],
      ),
      catalog,
    )
    expect(r.diagnostics).toEqual([])
    expect(r.nodes.get('rp')!.outputs[0].produced).toBeCloseTo(80)
    expect(r.nodes.get('rr')!.outputs[0].produced).toBeCloseTo(40)
    expect(r.totals.missingInputs).toEqual([{ item: 'base:Desc_LiquidFuel_C', perMin: expect.closeTo(60) }])
  })

  it('estimates power and buildings', () => {
    const miner = extractorNode('ore', 'Build_MinerMk2_C', ORE, [{ purity: 'base:normal', count: 1 }])
    const r = ironChain(miner, 60)
    // Miner runs at 75% (90 of 120), 3 Smelters, 3 Constructors.
    expect(r.nodes.get('ore')!.clock).toBeCloseTo(0.75)
    expect(r.totals.powerMw).toBeCloseTo(15 * 0.75 ** 1.321929 + 3 * 4 + 3 * 4)
    expect(r.totals.machines.get('base:Build_SmelterMk1_C')).toBeCloseTo(3)
    expect(r.totals.rawResources).toEqual([{ item: `base:${ORE}`, perMin: expect.closeTo(90) }])
    expect(r.totals.delivered).toEqual([{ item: `base:${PLATE}`, perMin: 60 }])
  })

  it('whole-machine mode rounds up and underclocks', () => {
    const r = ironChain(supplyNode('ore', ORE, 0, false), 50, { plan: { settings: { machineMode: 'underclock' } } })
    const plate = r.nodes.get('plate')!.setup!
    expect(plate.count).toBe(3)
    expect(plate.clock).toBeCloseTo(2.5 / 3)
    const fractional = ironChain(supplyNode('ore', ORE, 0, false), 50)
    // Same output; whole machines at lower clocks draw slightly less power.
    expect(r.totals.powerMw).toBeLessThan(fractional.totals.powerMw)
  })

  it('counts shards and Somersloops', () => {
    const r = ironChain(supplyNode('ore', ORE, 0, false), 100, { constructors: { clock: 2.5, sloops: 1 } })
    // 100 plates at 250% with a Somersloop each: 1 constructor (40 × 2.5 = 100).
    expect(r.nodes.get('plate')!.setup).toMatchObject({ count: 1, shards: 3 })
    expect(r.totals.shards).toBe(3)
    expect(r.totals.sloops).toBe(1)
    expect(r.nodes.get('plate')!.powerMw).toBeCloseTo(4 * 4 * 2.5 ** 1.321929)
  })

  it('warns when a belt is over capacity', () => {
    const r = ironChain(miner90(true), 'max', { plan: { settings: { machineMode: 'fractional', beltTier: 'base:Build_ConveyorBeltMk1_C' } } })
    expect(r.edges.get('e0')).toEqual({ perMin: 90, overCapacity: 60 })
    expect(r.edges.get('e2')!.overCapacity).toBeUndefined()
  })

  it('keeps unresolved nodes and ignores mismatched edges', () => {
    const r = solvePlan(
      plan(
        [recipeNode('gone', 'Recipe_Missing_C', 'Build_SmelterMk1_C'), constructors(), goalNode('goal', PLATE, 20)],
        [
          ['gone', 'plate', INGOT],
          ['plate', 'goal', 'Desc_IronRod_C'],
        ],
      ),
      catalog,
    )
    expect(r.nodes.get('gone')!.resolved).toBe(false)
    expect(r.edges.size).toBe(0)
    expect(r.diagnostics.map((d) => d.nodeId ?? d.edgeId)).toEqual(['gone', 'e1'])
    expect(machine('Build_SmelterMk1_C')).toBeDefined()
  })
})
