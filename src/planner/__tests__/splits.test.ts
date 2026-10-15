import { describe, expect, it } from 'vitest'
import { splitByConsumer, splitByConsumerBlocker } from '../edit'
import { solvePlan } from '../solve'
import { adviseSplit, manifoldPlan } from '../splits'
import type { Plan } from '../types'
import { catalog, goalNode, plan, recipeNode, supplyNode } from './fixtures'

const INGOT = 'base:Desc_IronIngot_C'

// 1300 ore → 43⅓ Smelters → 900 ingots to plates (600/min), 400 to rods (400/min).
const twoWay = (o: Partial<Plan> = {}, rodGoal = false) =>
  plan(
    [
      supplyNode('ore', 'Desc_OreIron_C', 1300, false),
      recipeNode('smelt', 'Recipe_IngotIron_C', 'Build_SmelterMk1_C'),
      recipeNode('plate', 'Recipe_IronPlate_C', 'Build_ConstructorMk1_C'),
      ...(rodGoal ? [goalNode('rod', 'Desc_IronIngot_C', 400)] : [recipeNode('rod', 'Recipe_IronRod_C', 'Build_ConstructorMk1_C')]),
      goalNode('gp', 'Desc_IronPlate_C', 600),
      ...(rodGoal ? [] : [goalNode('gr', 'Desc_IronRod_C', 400)]),
    ],
    [
      ['ore', 'smelt', 'Desc_OreIron_C'],
      ['smelt', 'plate', 'Desc_IronIngot_C'],
      ['smelt', 'rod', 'Desc_IronIngot_C'],
      ['plate', 'gp', 'Desc_IronPlate_C'],
      ...(rodGoal ? [] : ([['rod', 'gr', 'Desc_IronRod_C']] as [string, string, string][])),
    ],
    o,
  )

const advise = (p: Plan) => {
  const r = solvePlan(p, catalog)
  const split = r.splits.find((s) => s.node === 'smelt' && s.item === INGOT)!
  return adviseSplit(p, r, split, catalog)
}

describe('adviseSplit', () => {
  it('machines on every branch: a manifold works', () => {
    const a = advise(twoWay())
    expect(a.manifold).toBe(true)
    expect(a.overflow).toBeUndefined()
    expect(a.recommend).toBe('manifold')
    expect(a.branches.map((b) => b.perMin)).toEqual([900, 400])
    expect(a.branches[0].consumers?.count).toBeCloseTo(30, 6)
  })

  it('one goal goes last on the manifold and gets the overflow', () => {
    const a = advise(twoWay({}, true))
    expect(a.manifold).toBe(true)
    expect(a.overflow).toBe(a.branches.find((b) => b.target === 'rod')!.edge)
  })

  it('dedicated machines: one sub-group per consumer', () => {
    const a = advise(twoWay({ settings: { machineMode: 'fractional', beltTier: 'base:Build_ConveyorBeltMk4_C' } }))
    const d = a.dedicated!
    expect(d.groups.map((g) => g.machines)).toEqual([30, expect.closeTo(13.333, 3)])
    expect(d.groups.map((g) => g.belts)).toEqual([2, 1])
    expect(d.built).toBe(44)
    expect(d.shared).toBe(44)
    expect(d.blocker).toBeUndefined()
  })
})

describe('splitByConsumer', () => {
  it('moves every belt but the first to its own copy, inputs included', () => {
    const p = twoWay()
    const { plan: next, ids } = splitByConsumer(p, 'smelt', INGOT, () => 'smelt2')
    expect(ids).toEqual(['smelt2'])
    const out = (id: string) => next.edges.filter((e) => e.source === id && e.item === INGOT).map((e) => e.target)
    expect(out('smelt')).toEqual(['plate'])
    expect(out('smelt2')).toEqual(['rod'])
    expect(next.edges.filter((e) => e.target === 'smelt2').map((e) => e.source)).toEqual(['ore'])
    // The solver sizes each group to its consumer; totals don't change.
    const r = solvePlan(next, catalog)
    expect(r.nodes.get('smelt')!.activity).toBeCloseTo(30, 6)
    expect(r.nodes.get('smelt2')!.activity).toBeCloseTo(40 / 3, 6)
    expect(r.splits.some((s) => s.node === 'smelt' && s.item === INGOT)).toBe(false)
  })

  it('refuses limited groups, other belted outputs and single belts', () => {
    const limited = twoWay()
    limited.nodes = limited.nodes.map((n) => (n.id === 'smelt' ? { ...n, limited: true } : n))
    expect(splitByConsumerBlocker(limited, 'smelt', INGOT)).toMatch(/limited/)
    expect(splitByConsumer(limited, 'smelt', INGOT, () => 'x').ids).toEqual([])
    expect(splitByConsumerBlocker(twoWay(), 'plate', 'base:Desc_IronPlate_C')).toMatch(/one belt/)
    expect(splitByConsumerBlocker(twoWay(), 'ore', 'base:Desc_OreIron_C')).toMatch(/recipe/)
  })
})

describe('manifoldPlan', () => {
  const layout = (p: Plan) => manifoldPlan(advise(p), catalog, p, INGOT)
  const mk = (n: number) => ({ settings: { machineMode: 'fractional' as const, beltTier: `base:Build_ConveyorBeltMk${n}_C` } })

  it('lines never carry more than the tier; a big group is cut into even chunks', () => {
    const m = layout(twoWay(mk(4)))
    expect(m.tier?.ratePerMin).toBe(480)
    expect(m.lines.map((l) => l.perMin)).toEqual([450, 450, 400])
    expect(m.lines[0].stops[0]).toMatchObject({ machines: 15, part: 1, parts: 2 })
    expect(m.lines.map((l) => l.producers)).toEqual([15, 15, expect.closeTo(13.333, 3)])
  })

  it('whole groups share a line when they fit', () => {
    const m = layout(twoWay(mk(6)))
    expect(m.lines.map((l) => l.stops.length)).toEqual([1, 1])
    const one = layout(twoWay())
    expect(one.tier).toBeUndefined()
    expect(one.lines).toHaveLength(1)
    // 30 + 27 machines; the last on the line takes the belt's end.
    expect(one.splitters).toBe(56)
  })

  it('branches on the slowest tier that carries one machine', () => {
    const m = layout(twoWay(mk(6)))
    for (const l of m.lines) for (const s of l.stops) expect(s.branch?.ratePerMin).toBe(60)
  })

  it('a goal goes last and needs no splitter of its own', () => {
    const m = layout(twoWay(mk(6), true))
    const last = m.lines[m.lines.length - 1]
    expect(last.stops[last.stops.length - 1].taker).toBe(true)
    expect(m.lines.flatMap((l) => l.stops).find((s) => s.taker)?.branch).toBeUndefined()
    const one = layout(twoWay({}, true))
    expect(one.lines[0].stops.map((s) => s.taker)).toEqual([false, true])
    expect(one.splitters).toBe(30)
  })
})
