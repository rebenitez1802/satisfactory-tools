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

describe('water extractors', () => {
  // Water extractors go on any water, so a flexible group adds extractors
  // instead of overclocking the one it was created with.
  const PUMP = 'Build_WaterPump_C'
  const water = (o = {}) => extractorNode('water', PUMP, 'Desc_Water_C', [{ purity: 'base:normal', count: 1 }], o)
  const pumps = (source: PlanNode, target: number | 'max', settings?: Plan['settings']) =>
    solvePlan(plan([source, goalNode('goal', 'Desc_Water_C', target)], [['water', 'goal', 'Desc_Water_C']], settings && { settings }), catalog)

  it('adds extractors at the preferred clock', () => {
    const r = pumps(water(), 900)
    const n = r.nodes.get('water')!
    expect(n.activity).toBeCloseTo(900)
    expect(n.setup).toMatchObject({ count: expect.closeTo(7.5), clock: 1, shards: 0, feasible: true })
    expect(n.clock).toBeUndefined()
    expect(n.utilization).toBeUndefined()
    expect(r.diagnostics).toEqual([])
    expect(r.totals.powerMw).toBeCloseTo(7 * 20 + 20 * 0.5 ** 1.321929)
    expect(r.totals.machines.get(`base:${PUMP}`)).toBeCloseTo(7.5)
    expect(r.totals.shards).toBe(0)
  })

  it('rounds up to whole extractors in whole-machine mode', () => {
    const r = pumps(water(), 900, { machineMode: 'underclock' })
    expect(r.nodes.get('water')!.setup).toMatchObject({ count: 8, clock: expect.closeTo(0.9375) })
  })

  it('keeps an overclock the player asked for', () => {
    const r = pumps(water({ clock: 2.5 }), 900)
    expect(r.nodes.get('water')!.setup).toMatchObject({ count: expect.closeTo(3), clock: 2.5, shards: 3 })
    expect(r.totals.shards).toBe(9)
  })

  it('a limited group is still a hard limit', () => {
    const r = pumps(water({ limited: true, sites: [{ purity: 'base:normal', count: 2 }] }), 900)
    const n = r.nodes.get('water')!
    expect(r.goals[0].achieved).toBeCloseTo(240)
    expect(n.bottleneck).toBe(true)
    expect(n.setup).toBeUndefined()
    expect(n.capacity).toBeCloseTo(240)
  })

  it('miners still need the nodes they are on', () => {
    const r = ironChain(extractorNode('ore', 'Build_MinerMk1_C', ORE, [{ purity: 'base:normal', count: 1 }]), 120)
    expect(r.nodes.get('ore')!.clock).toBeCloseTo(3)
    expect(r.nodes.get('ore')!.setup).toBeUndefined()
    expect(r.diagnostics).toEqual([expect.objectContaining({ nodeId: 'ore', message: 'Needs more resource nodes than configured.' })])
  })
})

const REFINERY = 'Build_OilRefinery_C'
const NUCLEAR = 'Build_GeneratorNuclear_C'
const reactor = (id: string, fuel: string, o: object = {}) => recipeNode(id, `Recipe_GeneratorNuclear_${fuel}_C`, NUCLEAR, o)

describe('generators', () => {
  const coal = (power: number | 'max' | undefined, o: object = {}) =>
    recipeNode('gen', 'Recipe_GeneratorCoal_Coal_C', 'Build_GeneratorCoal_C', { power, ...o })
  const coalPlan = (gen: PlanNode, coalPerMin?: number) =>
    plan(
      [supplyNode('coal', 'Desc_Coal_C', coalPerMin ?? 0, coalPerMin !== undefined), supplyNode('water', 'Desc_Water_C', 0, false), gen],
      [
        ['coal', 'gen', 'Desc_Coal_C'],
        ['water', 'gen', 'Desc_Water_C'],
      ],
    )

  it('a power target sizes the generators and their fuel', () => {
    const r = solvePlan(coalPlan(coal(300)), catalog)
    // 75 MW each, burning 15 coal and 45 m³ water a minute.
    expect(r.nodes.get('gen')!.setup!.count).toBeCloseTo(4)
    expect(r.nodes.get('coal')!.activity).toBeCloseTo(60)
    expect(r.nodes.get('water')!.activity).toBeCloseTo(180)
    expect(r.nodes.get('gen')!.generatedMw).toBeCloseTo(300)
    expect(r.nodes.get('gen')!.powerMw).toBe(0)
    expect(r.goals).toEqual([{ id: 'gen', item: 'base:Desc_Coal_C', requested: 300, achieved: expect.closeTo(300), power: true }])
    expect(r.totals.generatedMw).toBeCloseTo(300)
  })

  it('overclocked generators scale linearly', () => {
    const r = solvePlan(coalPlan(coal(300, { clock: 2 })), catalog)
    expect(r.nodes.get('gen')!.setup).toMatchObject({ count: 2, clock: 2, shards: 2 })
    expect(r.nodes.get('coal')!.activity).toBeCloseTo(60)
    expect(r.totals.generatedMw).toBeCloseTo(300)
  })

  it('Max burns all the fuel a limit allows', () => {
    const r = solvePlan(coalPlan(coal('max'), 45), catalog)
    expect(r.goals[0].achieved).toBeCloseTo(225)
    expect(r.nodes.get('coal')!.bottleneck).toBe(true)
  })

  it('a target the fuel cannot cover falls short', () => {
    const r = solvePlan(coalPlan(coal(300), 30), catalog)
    expect(r.goals[0].achieved).toBeCloseTo(150)
    expect(r.nodes.get('coal')!.bottleneck).toBe(true)
  })

  it('reports power drawn and made', () => {
    // 4 Water Extractors (20 MW each at 100%) feed 2 Nuclear Power Plants.
    const pumps = extractorNode('water', 'Build_WaterPump_C', 'Desc_Water_C', [{ purity: 'base:normal', count: 4 }])
    const r = solvePlan(
      plan(
        [supplyNode('rods', 'Desc_NuclearFuelRod_C', 0, false), pumps, reactor('npp', 'NuclearFuelRod', { power: 5000 })],
        [
          ['rods', 'npp', 'Desc_NuclearFuelRod_C'],
          ['water', 'npp', 'Desc_Water_C'],
        ],
      ),
      catalog,
    )
    expect(r.nodes.get('water')!.activity).toBeCloseTo(480)
    expect(r.totals.powerMw).toBeCloseTo(80)
    expect(r.totals.generatedMw).toBeCloseTo(5000)
  })

  it('flags radioactive waste with nowhere to go', () => {
    const r = solvePlan(plan([reactor('npp', 'NuclearFuelRod', { power: 2500 })]), catalog)
    expect(r.totals.surplus).toEqual([{ item: 'base:Desc_NuclearWaste_C', perMin: expect.closeTo(10) }])
    expect(r.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', nodeId: 'npp', message: expect.stringContaining("10 Uranium Waste/min is left over and can't be sunk") }),
    ])
  })

  it('a flexible generator is sized by demand for its waste', () => {
    // Two plutonium plants burn 0.2 rods/min; the waste chain pulls 40 uranium waste, i.e. 4 uranium plants.
    const r = solvePlan(plan(...wasteChain(reactor('u', 'NuclearFuelRod'), reactor('pu', 'PlutoniumFuelRod', { power: 5000 }))), catalog)
    expect(r.nodes.get('u')!.activity).toBeCloseTo(4)
    expect(r.nodes.get('u')!.generatedMw).toBeCloseTo(10000)
  })

  it('plans a whole nuclear chain: 4 uranium : 2 plutonium : 1 Ficsonium plants', () => {
    const [nodes, edges] = wasteChain(reactor('u', 'NuclearFuelRod', { power: 10000 }), reactor('pu', 'PlutoniumFuelRod', { power: 'max' }))
    const r = solvePlan(
      plan(
        [
          ...nodes,
          recipeNode('fx', 'Recipe_Ficsonium_C', 'Build_HadronCollider_C'),
          recipeNode('frod', 'Recipe_FicsoniumFuelRod_C', 'Build_QuantumEncoder_C'),
          recipeNode('dm', 'Recipe_DarkEnergy_C', 'Build_Converter_C'),
          reactor('f', 'FicsoniumFuelRod', { power: 'max' }),
        ],
        [
          ...edges,
          ['pu', 'fx', 'Desc_PlutoniumWaste_C'],
          ['fx', 'frod', 'Desc_Ficsonium_C'],
          ['frod', 'fx', 'Desc_DarkEnergy_C'],
          ['dm', 'fx', 'Desc_DarkEnergy_C'],
          ['frod', 'f', 'Desc_FicsoniumFuelRod_C'],
        ],
      ),
      catalog,
    )
    expect(r.goals.map((g) => [g.id, g.achieved])).toEqual([
      ['u', expect.closeTo(10000)],
      ['pu', expect.closeTo(5000)],
      ['f', expect.closeTo(2500)],
    ])
    expect(r.totals.generatedMw).toBeCloseTo(17500)
    // All the waste is used: only the Blender's water is left over, and no warnings.
    expect(r.totals.surplus.map((s) => s.item)).toEqual(['base:Desc_Water_C'])
    expect(r.diagnostics).toEqual([])
    expect(r.nodes.get('u')!.outputs[0]).toMatchObject({ produced: expect.closeTo(40), used: expect.closeTo(40) })
    expect(r.splits[0].edges.map((e) => e.perMin)).toEqual([expect.closeTo(30), expect.closeTo(10)])
  })
})

/** Uranium waste → Non-Fissile Uranium + Plutonium Pellets → cells → Plutonium Fuel Rods → `pu`. */
function wasteChain(u: PlanNode, pu: PlanNode): [PlanNode[], [string, string, string][]] {
  const WASTE = 'Desc_NuclearWaste_C'
  return [
    [
      supplyNode('rods', 'Desc_NuclearFuelRod_C', 0, false),
      u,
      recipeNode('nfu', 'Recipe_NonFissileUranium_C', 'Build_Blender_C'),
      recipeNode('pellet', 'Recipe_Plutonium_C', 'Build_HadronCollider_C'),
      recipeNode('cell', 'Recipe_PlutoniumCell_C', 'Build_AssemblerMk1_C'),
      recipeNode('purod', 'Recipe_PlutoniumFuelRod_C', 'Build_ManufacturerMk1_C'),
      pu,
    ],
    [
      ['rods', 'u', 'Desc_NuclearFuelRod_C'],
      ['u', 'nfu', WASTE],
      ['u', 'pellet', WASTE],
      ['nfu', 'pellet', 'Desc_NonFissibleUranium_C'],
      ['pellet', 'cell', 'Desc_PlutoniumPellet_C'],
      ['cell', 'purod', 'Desc_PlutoniumCell_C'],
      ['purod', 'pu', 'Desc_PlutoniumFuelRod_C'],
    ],
  ]
}

describe('byproducts', () => {
  const HOR = 'Desc_HeavyOilResidue_C'
  const RESIN = 'Desc_PolymerResin_C'
  // Plastic: 30 oil → 20 plastic + 10 heavy oil residue a minute. Residual Fuel: 60 residue → 40 fuel.
  const plastic = recipeNode('pl', 'Recipe_Plastic_C', REFINERY)
  const residualFuel = recipeNode('rf', 'Recipe_ResidualFuel_C', REFINERY)
  // Fuel: 60 oil → 40 fuel + 30 resin. Residual Rubber: 40 resin + 40 water → 20 rubber.
  const fuel = recipeNode('fu', 'Recipe_LiquidFuel_C', REFINERY)
  const rubber = recipeNode('rr', 'Recipe_ResidualRubber_C', REFINERY)

  it('spare byproduct fills a chain with no goal of its own', () => {
    const r = solvePlan(
      plan([goalNode('g', 'Desc_Plastic_C', 20), plastic, residualFuel], [
        ['pl', 'g', 'Desc_Plastic_C'],
        ['pl', 'rf', HOR],
      ]),
      catalog,
    )
    expect(r.nodes.get('pl')!.activity).toBeCloseTo(1)
    expect(r.nodes.get('rf')!.outputs[0].produced).toBeCloseTo(20 / 3)
    expect(r.goals[1]).toMatchObject({ openEndOf: 'rf', achieved: expect.closeTo(20 / 3) })
    expect(r.totals.surplus).toEqual([])
  })

  it('a Max goal gets the spare byproduct even when the source has no room left', () => {
    const r = solvePlan(
      plan([supplyNode('oil', 'Desc_LiquidOil_C', 30), goalNode('g', 'Desc_Plastic_C', 20), plastic, residualFuel, goalNode('f', 'Desc_LiquidFuel_C', 'max')], [
        ['oil', 'pl', 'Desc_LiquidOil_C'],
        ['pl', 'g', 'Desc_Plastic_C'],
        ['pl', 'rf', HOR],
        ['rf', 'f', 'Desc_LiquidFuel_C'],
      ]),
      catalog,
    )
    expect(r.goals.find((g) => g.id === 'f')!.achieved).toBeCloseTo(20 / 3)
    expect(r.nodes.get('oil')!.activity).toBeCloseTo(30)
  })

  it('spare byproduct is used before a dedicated producer', () => {
    // 80 resin for 40 rubber: 30 spare from the fuel refinery, 50 from a Polymer Resin refinery.
    const r = solvePlan(
      plan(
        [goalNode('gf', 'Desc_LiquidFuel_C', 40), fuel, recipeNode('pr', 'Recipe_Alternate_PolymerResin_C', REFINERY), rubber, goalNode('gr', 'Desc_Rubber_C', 40)],
        [
          ['fu', 'gf', 'Desc_LiquidFuel_C'],
          ['fu', 'rr', RESIN],
          ['pr', 'rr', RESIN],
          ['rr', 'gr', 'Desc_Rubber_C'],
        ],
      ),
      catalog,
    )
    expect(r.nodes.get('fu')!.activity).toBeCloseTo(1)
    expect(r.edges.get('e1')!.perMin).toBeCloseTo(30)
    expect(r.edges.get('e2')!.perMin).toBeCloseTo(50)
    expect(r.goals.map((g) => g.achieved)).toEqual([40, expect.closeTo(40)])
  })

  it('a goal needing more than the spare byproduct falls short instead of growing its maker', () => {
    const r = solvePlan(
      plan([goalNode('gf', 'Desc_LiquidFuel_C', 40), fuel, rubber, goalNode('gr', 'Desc_Rubber_C', 100)], [
        ['fu', 'gf', 'Desc_LiquidFuel_C'],
        ['fu', 'rr', RESIN],
        ['rr', 'gr', 'Desc_Rubber_C'],
      ]),
      catalog,
    )
    expect(r.nodes.get('fu')!.activity).toBeCloseTo(1)
    expect(r.goals[1].achieved).toBeCloseTo(15)
    expect(r.nodes.get('fu')!.bottleneck).toBe(true)
  })

  it('a maker with nothing else to run for is still pulled by its byproduct', () => {
    // Only the residue belt is connected: the plastic refinery runs for it.
    const r = solvePlan(
      plan([plastic, residualFuel, goalNode('f', 'Desc_LiquidFuel_C', 20)], [
        ['pl', 'rf', HOR],
        ['rf', 'f', 'Desc_LiquidFuel_C'],
      ]),
      catalog,
    )
    expect(r.nodes.get('pl')!.activity).toBeCloseTo(3)
    expect(r.goals[0].achieved).toBe(20)
  })
})
