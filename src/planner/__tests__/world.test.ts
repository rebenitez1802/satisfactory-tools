import { describe, expect, it } from 'vitest'
import { solvePlan } from '../solve'
import { defaultSites, fitSites, overText, siteRate, worldCapacity, worldSites, worldUsage } from '../world'
import type { ExtractorNode } from '../types'
import { catalog, extractorNode, goalNode, plan } from './fixtures'

describe('world sites', () => {
  const sites = defaultSites(catalog)

  it('gives the most each resource can yield, as the wiki counts it', () => {
    // Mk.3 at 250%: 300 / 600 / 1200 a minute per impure / normal / pure node.
    expect(siteRate(catalog, 'base:Desc_OreIron_C', 'node', 'base:pure')).toBe(1200)
    expect(worldCapacity(catalog, sites, 'base:Desc_OreIron_C')).toBe(92100)
    expect(worldCapacity(catalog, sites, 'base:Desc_OreUranium_C')).toBe(2100)
    expect(worldCapacity(catalog, sites, 'base:Desc_SAM_C')).toBe(10200)
    // Oil: 9900 from oil nodes, 2700 from wells.
    expect(worldCapacity(catalog, sites, 'base:Desc_LiquidOil_C', 'node')).toBe(9900)
    expect(worldCapacity(catalog, sites, 'base:Desc_LiquidOil_C', 'well')).toBe(2700)
    expect(worldCapacity(catalog, sites, 'base:Desc_NitrogenGas_C')).toBe(12000)
    // Water Extractors go anywhere: no limit, except on wells.
    expect(worldCapacity(catalog, sites, 'base:Desc_Water_C')).toBeUndefined()
    expect(worldCapacity(catalog, sites, 'base:Desc_Water_C', 'well')).toBe(13125)
  })

  it('uses the plan\'s own counts when it has them', () => {
    const own = [{ resource: 'base:Desc_OreIron_C', site: 'node', purity: 'base:pure', count: 2 }]
    expect(worldSites(plan([]), catalog)).toBe(sites)
    expect(worldSites(plan([], [], { settings: { machineMode: 'fractional', world: own } }), catalog)).toBe(own)
  })

  it('counts the sites a plan uses against the map', () => {
    const p = plan(
      [
        // Limited: the sites it lists. Flexible: as many as it needs, whole.
        extractorNode('a', 'Build_MinerMk3_C', 'Desc_OreUranium_C', [{ purity: 'base:impure', count: 4 }], { limited: true }),
        extractorNode('b', 'Build_MinerMk1_C', 'Desc_OreUranium_C', [{ purity: 'base:normal', count: 1 }]),
        extractorNode('w', 'Build_WaterPump_C', 'Desc_Water_C', [{ purity: 'base:normal', count: 1 }]),
        goalNode('g', 'Desc_OreUranium_C', 150),
        goalNode('gw', 'Desc_Water_C', 600),
      ],
      [
        ['a', 'g', 'Desc_OreUranium_C'],
        ['b', 'g', 'Desc_OreUranium_C'],
        ['w', 'gw', 'Desc_Water_C'],
      ],
    )
    // Half the 150 from each: miner b needs 1.25 normal nodes → 2.
    const use = worldUsage(p, solvePlan(p, catalog), catalog)
    expect(use).toEqual([
      {
        resource: 'base:Desc_OreUranium_C',
        site: 'node',
        purities: [
          { purity: 'base:impure', used: 4, available: 3 },
          { purity: 'base:normal', used: 2, available: 2 },
        ],
        used: 6,
        available: 5,
        over: true,
      },
    ])
    expect(overText(use[0], catalog)).toBe('Uranium: 4 impure nodes, the map has 3')
  })

  describe('fitting flexible groups onto purities the map has', () => {
    // A map with 2 pure, 3 normal and 4 impure iron nodes; Mk.1 miners make
    // 120 / 60 / 30 a minute on them.
    const world = [
      { resource: 'base:Desc_OreIron_C', site: 'node', purity: 'base:pure', count: 2 },
      { resource: 'base:Desc_OreIron_C', site: 'node', purity: 'base:normal', count: 3 },
      { resource: 'base:Desc_OreIron_C', site: 'node', purity: 'base:impure', count: 4 },
    ]
    const ironPlan = (perMin: number) =>
      plan([extractorNode('m', 'Build_MinerMk1_C', 'Desc_OreIron_C', [{ purity: 'base:normal', count: 1 }]), goalNode('g', 'Desc_OreIron_C', perMin)], [['m', 'g', 'Desc_OreIron_C']], {
        settings: { machineMode: 'fractional', world },
      })
    const fit = (p: ReturnType<typeof ironPlan>) => {
      const fitted = fitSites(p, catalog, solvePlan(p, catalog))
      const solved = solvePlan(fitted, catalog)
      return { m: fitted.nodes.find((n) => n.id === 'm') as ExtractorNode, solved, over: worldUsage(fitted, solved, catalog).some((u) => u.over) }
    }

    it('leaves a group that fits alone', () => {
      const p = ironPlan(150)
      expect(fitSites(p, catalog, solvePlan(p, catalog))).toBe(p)
    })

    it('moves a group to the best purity with room for it', () => {
      // 200/min: 4 normal nodes (the map has 3), or 2 pure ones.
      const { m, solved, over } = fit(ironPlan(200))
      expect(m.sites).toEqual([{ purity: 'base:pure', count: 1 }])
      expect(m.limited).toBe(false)
      expect(solved.goals[0].achieved).toBeCloseTo(200)
      expect(over).toBe(false)
    })

    it('spreads a group over purities, best first, when no one purity holds it', () => {
      // 400/min: 2 pure (240) + 3 normal (180) give 420 at 100%, so 95.2%.
      const { m, solved, over } = fit(ironPlan(400))
      expect(m.limited).toBe(true)
      expect(m.sites).toEqual([
        { purity: 'base:pure', count: 2 },
        { purity: 'base:normal', count: 3 },
      ])
      expect(m.clock).toBeCloseTo(400 / 420)
      expect(solved.goals[0].achieved).toBeCloseTo(400)
      expect(solved.totals.surplus).toEqual([])
      expect(over).toBe(false)
    })

    it('overclocks only when every site is needed', () => {
      // 600/min: all 9 nodes give 540 at 100%, so 111.1%.
      const { m, solved, over } = fit(ironPlan(600))
      expect(m.sites.reduce((n, s) => n + s.count, 0)).toBe(9)
      expect(m.clock).toBeCloseTo(600 / 540)
      expect(solved.goals[0].achieved).toBeCloseTo(600)
      expect(over).toBe(false)
    })
  })
})
