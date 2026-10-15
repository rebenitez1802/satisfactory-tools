import { describe, expect, it } from 'vitest'
import { beltPlan, groupEnd, machineRates, machinesOnBelts, transportOptions } from '../belts'
import { solvePlan } from '../solve'
import { catalog, extractorNode, goalNode, plan, recipeNode } from './fixtures'

const loads = (count: number, each: number, cap: number) => machinesOnBelts(count, each, cap)?.map((l) => [l.machines, l.perMin])

describe('machinesOnBelts', () => {
  it('splits a group evenly over the fewest belts', () => {
    expect(loads(20, 100, 1200)).toEqual([
      [10, 1000],
      [10, 1000],
    ])
    expect(loads(10, 100, 480)).toEqual([
      [4, 400],
      [3, 300],
      [3, 300],
    ])
  })

  it('puts the partly clocked machine on the lightest belt', () => {
    expect(loads(7.5, 100, 480)).toEqual([
      [4, 400],
      [3.5, 350],
    ])
    // 900 m³/min of water from 7.5 extractors on Mk.2 pipes (600).
    expect(loads(7.5, 120, 600)).toEqual([
      [4, 480],
      [3.5, 420],
    ])
  })

  it('adds a belt when whole machines do not fit evenly', () => {
    // 7.5 × 120 = 900 fits 3 pipes of 300 by rate, but not by whole machines.
    expect(loads(7.5, 120, 300)).toEqual([
      [2, 240],
      [2, 240],
      [2, 240],
      [1.5, 180],
    ])
  })

  it('one belt when it fits, nothing when one machine is too fast', () => {
    expect(loads(0.5, 100, 120)).toEqual([[0.5, 50]])
    expect(loads(3, 30, 120)).toEqual([[3, 90]])
    expect(machinesOnBelts(2, 300, 270)).toBeUndefined()
  })
})

describe('machineRates', () => {
  it('one rate per machine, with a partial one last', () => {
    expect(machineRates(3, 100)).toEqual([100, 100, 100])
    expect(machineRates(2.5, 100)).toEqual([100, 100, 50])
    expect(machineRates(0.25, 40)).toEqual([10])
  })
})

describe('transportOptions', () => {
  const belts = [...catalog.transportTiers.values()].filter((t) => t.kind === 'belt')
  it('counts belts per tier, fastest first', () => {
    const opts = transportOptions(2000, belts).map((o) => [o.tier.ratePerMin, o.count])
    expect(opts.slice(0, 3)).toEqual([
      [1200, 2],
      [780, 3],
      [480, 5],
    ])
  })
  it('leaves out tiers slower than one machine', () => {
    expect(transportOptions(2000, belts, 300).every((o) => o.tier.ratePerMin >= 300)).toBe(true)
  })
})

describe('beltPlan', () => {
  it('producers onto belts, consumers per belt', () => {
    // 20 machines at 100/min feeding consumers taking 150/min each.
    const belts = beltPlan(2000, 1200, { each: 100 }, { each: 150 })!
    expect(belts.map((b) => b.perMin)).toEqual([1000, 1000])
    expect(belts.map((b) => b.from)).toEqual([10, 10])
    expect(belts[0].to).toBeCloseTo(6.667, 3)
  })

  it('uses the end that needs fewer belts', () => {
    // 10 producers at 100 fit 3 belts of 480; 4 consumers at 250 need 4.
    expect(beltPlan(1000, 480, { each: 100 }, { each: 250 })).toHaveLength(3)
    expect(beltPlan(1000, 480, { each: 250 }, { each: 100 })).toHaveLength(3)
  })

  it('splits evenly without machines at either end', () => {
    expect(beltPlan(900, 600)?.map((b) => b.perMin)).toEqual([450, 450])
  })

  it('a split edge holds part of its group', () => {
    // 750 of a group of machines at 100: 7.5 machines' worth.
    expect(beltPlan(750, 480, { each: 100 })?.map((b) => b.from)).toEqual([4, 3.5])
  })

  it('nothing when one machine is faster than the belt', () => {
    expect(beltPlan(600, 270, { each: 300 })).toBeUndefined()
    expect(beltPlan(600, 270, { each: 100 }, { each: 300 })).toBeUndefined()
  })
})

describe('groupEnd', () => {
  it('reads the machine group of a solved node', () => {
    // 90 plates/min: 4.5 Constructors taking 30 ingots each, from 4.5 Smelters.
    const p = plan(
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
    )
    const r = solvePlan(p, catalog)
    expect(groupEnd(r.nodes.get('smelt'), 'base:Desc_IronIngot_C', 'out')).toEqual({ machine: 'base:Build_SmelterMk1_C', count: 4.5, each: 30 })
    expect(groupEnd(r.nodes.get('plate'), 'base:Desc_IronIngot_C', 'in')).toMatchObject({ count: 4.5, each: 30 })
    expect(groupEnd(r.nodes.get('goal'), 'base:Desc_IronPlate_C', 'in')).toBeUndefined()
  })
})
