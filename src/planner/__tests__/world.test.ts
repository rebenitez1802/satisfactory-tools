import { describe, expect, it } from 'vitest'
import { solvePlan } from '../solve'
import { defaultSites, siteRate, worldCapacity, worldSites, worldUsage } from '../world'
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
  })
})
