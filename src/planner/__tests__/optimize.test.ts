import { describe, expect, it } from 'vitest'
import type { RecipeId } from '../../catalog'
import { optimize, resourceWeights, type OptimizeOptions } from '../optimize'
import { solvePlan } from '../solve'
import { defaultSites } from '../world'
import type { Plan } from '../types'
import { catalog, extractorNode, goalNode, plan, recipe, recipeNode, supplyNode } from './fixtures'

let counter = 0
const newId = () => `o${counter++}`

/** Only standard recipes, plus the alternates listed. */
const unlocked =
  (...alternates: string[]) =>
  (id: RecipeId) =>
    catalog.recipes.get(id)!.alternate && !alternates.map((a) => `base:${a}`).includes(id)

function run(p: Plan, opts: Partial<OptimizeOptions> = {}) {
  const r = optimize(p, catalog, { newId, ...opts })
  const solved = solvePlan(r.plan, catalog)
  /** Machines (or items/min) per recipe name, summed over groups. */
  const groups = new Map<string, number>()
  for (const n of r.plan.nodes) {
    const name = n.kind === 'recipe' ? catalog.recipes.get(n.recipe)!.name : `${n.kind} ${n.kind === 'extractor' ? n.resource : n.kind === 'goal' || n.kind === 'supply' ? n.item : ''}`
    groups.set(name, (groups.get(name) ?? 0) + solved.nodes.get(n.id)!.activity)
  }
  const raw = (item: string) => solved.totals.rawResources.find((x) => x.item === `base:${item}`)?.perMin ?? 0
  return { ...r, solved, groups, raw }
}

const achieved = (s: ReturnType<typeof solvePlan>, id: string) => s.goals.find((g) => g.id === id)!.achieved

describe('optimize', () => {
  it('weighs resources by scarcity, and water not at all', () => {
    const w = resourceWeights(catalog, defaultSites(catalog))
    expect(w('base:Desc_OreIron_C')).toBe(1)
    expect(w('base:Desc_OreUranium_C')).toBeCloseTo(92100 / 2100)
    expect(w('base:Desc_Water_C')).toBe(0)
  })

  it('builds the standard chain when no alternates are unlocked', () => {
    const r = run(plan([goalNode('g', 'Desc_IronPlate_C', 120)]), { isRecipeHidden: unlocked() })
    expect(r.ok).toBe(true)
    expect(r.groups.get('Iron Ingot')).toBeCloseTo(6)
    expect(r.groups.get('Iron Plate')).toBeCloseTo(6)
    expect(r.raw('Desc_OreIron_C')).toBeCloseTo(180)
    expect(achieved(r.solved, 'g')).toBeCloseTo(120)
    expect(r.solved.diagnostics).toEqual([])
    expect(r.solved.totals.missingInputs).toEqual([])
  })

  it('picks an unlocked alternate that saves resources', () => {
    // 180 ingots: Pure Iron Ingot makes 65/min from 35 ore and 20 water, so
    // 36/13 refineries, 1260/13 ore and 720/13 water. Weighted, that's
    // 96.9 (water is free) against 180 ore for smelting.
    const r = run(plan([goalNode('g', 'Desc_IronPlate_C', 120)]), { isRecipeHidden: unlocked('Recipe_Alternate_PureIronIngot_C') })
    expect(r.groups.get('Pure Iron Ingot')).toBeCloseTo(36 / 13)
    expect(r.groups.has('Iron Ingot')).toBe(false)
    expect(r.raw('Desc_OreIron_C')).toBeCloseTo(1260 / 13)
    expect(r.raw('Desc_Water_C')).toBeCloseTo(720 / 13)
    expect(achieved(r.solved, 'g')).toBeCloseTo(120)
  })

  it('weighs power or buildings instead', () => {
    // Least power: smelters (24 MW) and 0.75 Mk.3 miners (34 MW) beat 2.8
    // refineries (83 MW), their water (9 MW) and miners (18 MW).
    const opts = { isRecipeHidden: unlocked('Recipe_Alternate_PureIronIngot_C') }
    const power = run(plan([goalNode('g', 'Desc_IronPlate_C', 120)]), { ...opts, objective: 'power' })
    expect(power.groups.get('Iron Ingot')).toBeCloseTo(6)
    expect(power.groups.has('Pure Iron Ingot')).toBe(false)
    // Fewest buildings: 2.8 refineries and their water extractors (0.46) and
    // miners (0.4) beat 6 smelters and 0.75 miners.
    const buildings = run(plan([goalNode('g', 'Desc_IronPlate_C', 120)]), { ...opts, objective: 'buildings' })
    expect(buildings.groups.get('Pure Iron Ingot')).toBeCloseTo(36 / 13)
  })

  it('never uses a locked alternate', () => {
    const r = run(plan([goalNode('g', 'Desc_Computer_C', 5)]), { isRecipeHidden: unlocked() })
    for (const n of r.plan.nodes) if (n.kind === 'recipe') expect(catalog.recipes.get(n.recipe)!.alternate).toBe(false)
    expect(achieved(r.solved, 'g')).toBeCloseTo(5)
  })

  it('meets every goal with all alternates, loops and byproducts included', () => {
    for (const item of ['Desc_IronPlateReinforced_C', 'Desc_Computer_C', 'Desc_AluminumIngot_C', 'Desc_SpaceElevatorPart_9_C']) {
      const r = run(plan([goalNode('g', item, 2)]))
      expect(r.ok).toBe(true)
      expect(achieved(r.solved, 'g')).toBeCloseTo(2)
      expect(r.solved.totals.missingInputs).toEqual([])
      expect(r.solved.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
    }
  })

  it('uses a byproduct that feeds its maker\'s own goal', () => {
    // Alumina Solution for 60 ingots also makes 25 silica: the quartz line
    // only makes the other 50, from 30 quartz.
    const r = run(plan([goalNode('g', 'Desc_AluminumIngot_C', 60)]), { isRecipeHidden: unlocked() })
    expect(r.raw('Desc_RawQuartz_C')).toBeCloseTo(30)
    expect(achieved(r.solved, 'g')).toBeCloseTo(60)
  })

  it('splits off a group run for its byproduct', () => {
    // 10 rubber and 40 heavy oil residue: 2 Rubber refineries make 40 of
    // each. Half a machine is run for the rubber goal; the other 1.5 only for
    // their residue, so their rubber is left unconnected and the residue pulled.
    const r = run(plan([goalNode('rubber', 'Desc_Rubber_C', 10), goalNode('hor', 'Desc_HeavyOilResidue_C', 40)]), { isRecipeHidden: unlocked() })
    const rubber = r.plan.nodes.filter((n) => n.kind === 'recipe' && n.recipe === recipe('Recipe_Rubber_C').id)
    expect(rubber.map((n) => r.solved.nodes.get(n.id)!.activity).sort()).toEqual([expect.closeTo(0.5), expect.closeTo(1.5)])
    expect(r.raw('Desc_LiquidOil_C')).toBeCloseTo(60)
    expect(achieved(r.solved, 'rubber')).toBeCloseTo(10)
    expect(achieved(r.solved, 'hor')).toBeCloseTo(40)
  })

  it('keeps sources, goals, generators and limits, and replaces flexible groups', () => {
    const p = plan(
      [
        extractorNode('ore', 'Build_MinerMk1_C', 'Desc_OreIron_C', [{ purity: 'base:normal', count: 1 }]),
        recipeNode('smelt', 'Recipe_IngotIron_C', 'Build_SmelterMk1_C'),
        recipeNode('plates', 'Recipe_IronPlate_C', 'Build_ConstructorMk1_C', { limited: true, count: 2 }),
        goalNode('g', 'Desc_IronPlate_C', 40),
      ],
      [
        ['ore', 'smelt', 'Desc_OreIron_C'],
        ['smelt', 'plates', 'Desc_IronIngot_C'],
        ['plates', 'g', 'Desc_IronPlate_C'],
      ],
    )
    const r = run(p, { isRecipeHidden: unlocked() })
    expect(r.removed).toEqual(['smelt'])
    expect(r.plan.nodes.map((n) => n.id)).toEqual(['ore', 'plates', 'g', ...r.added])
    // The flexible miner is reused: no new iron extractor.
    expect(r.plan.nodes.filter((n) => n.kind === 'extractor')).toHaveLength(1)
    expect(r.solved.nodes.get('plates')!.activity).toBeCloseTo(2)
    expect(r.raw('Desc_OreIron_C')).toBeCloseTo(60)
  })

  it('builds for what the limits allow, and says so', () => {
    const p = plan([supplyNode('ore', 'Desc_OreIron_C', 90), goalNode('g', 'Desc_IronPlate_C', 120)])
    const r = run(p, { isRecipeHidden: unlocked() })
    expect(r.ok).toBe(true)
    expect(r.scale).toBeCloseTo(0.5)
    expect(r.message).toMatch(/50%/)
    expect(achieved(r.solved, 'g')).toBeCloseTo(60)
    expect(r.plan.nodes.filter((n) => n.kind === 'extractor')).toHaveLength(0)
  })

  it('uses an intermediate supply before making it', () => {
    const p = plan([supplyNode('ingots', 'Desc_IronIngot_C', 60), goalNode('g', 'Desc_IronPlate_C', 120)])
    const r = run(p, { isRecipeHidden: unlocked() })
    expect(r.solved.nodes.get('ingots')!.activity).toBeCloseTo(60)
    expect(r.raw('Desc_OreIron_C')).toBeCloseTo(120)
  })

  it('fills Max goals from the limits, sharing them', () => {
    const one = run(plan([supplyNode('ore', 'Desc_OreIron_C', 90), goalNode('g', 'Desc_IronPlate_C', 'max')]), { isRecipeHidden: unlocked() })
    expect(achieved(one.solved, 'g')).toBeCloseTo(60)
    // Rods alone could take 90 ore → 45 rods; plates 60. Each gets the same share: half.
    const two = run(
      plan([supplyNode('ore', 'Desc_OreIron_C', 90), goalNode('p', 'Desc_IronPlate_C', 'max'), goalNode('r', 'Desc_IronRod_C', 'max')]),
      { isRecipeHidden: unlocked() },
    )
    expect(two.ok).toBe(true)
    expect(achieved(two.solved, 'p')).toBeCloseTo(30)
    expect(achieved(two.solved, 'r')).toBeCloseTo(45)
  })

  it('reports what it can\'t do', () => {
    expect(run(plan([])).message).toMatch(/goal/)
    const unbounded = run(plan([goalNode('g', 'Desc_IronPlate_C', 'max')]))
    expect(unbounded.ok).toBe(false)
    expect(unbounded.message).toMatch(/limit/)
    const none = run(plan([supplyNode('ore', 'Desc_OreIron_C', 0), goalNode('g', 'Desc_IronPlate_C', 10)]), { isRecipeHidden: unlocked() })
    expect(none.ok).toBe(false)
  })

  it('sizes a generator\'s fuel chain from its power target', () => {
    // 500 MW is 2 Fuel-Powered Generators burning 40 fuel/min: 1 refinery on 60 crude.
    const gen = recipeNode('gen', 'Recipe_GeneratorFuel_LiquidFuel_C', 'Build_GeneratorFuel_C', { power: 500 })
    const r = run(plan([gen]), { isRecipeHidden: unlocked() })
    expect(r.groups.get('Fuel')).toBeCloseTo(1)
    expect(r.raw('Desc_LiquidOil_C')).toBeCloseTo(60)
    expect(r.solved.goals[0].achieved).toBeCloseTo(500)
  })

  describe('how much power one uranium node makes', () => {
    // A Miner Mk.3 on a normal node: 240 uranium/min, ⛔ limited.
    const node = () => extractorNode('u', 'Build_MinerMk3_C', 'Desc_OreUranium_C', [{ purity: 'base:normal', count: 1 }], { limited: true })
    const plant = (id: string, rod: string) => recipeNode(id, `Recipe_GeneratorNuclear_${rod}_C`, 'Build_GeneratorNuclear_C', { power: 'max' })
    const mw = (r: ReturnType<typeof run>, id: string) => r.solved.goals.find((g) => g.id === id)!.achieved

    it('uranium plants alone', () => {
      // 240 uranium → 120 cells → 2.4 rods/min → 12 plants at 0.2 rods each.
      const r = run(plan([node(), plant('u235', 'NuclearFuelRod')]), { isRecipeHidden: unlocked() })
      expect(mw(r, 'u235')).toBeCloseTo(30000)
      expect(r.solved.nodes.get('u235')!.activity).toBeCloseTo(12)
      // Everything else the rods need comes from new, unlimited extractors.
      expect(r.raw('Desc_OreUranium_C')).toBeCloseTo(240)
      expect(r.raw('Desc_Stone_C')).toBeGreaterThan(0)
    })

    it('plutonium plants burning their waste, for the most power together', () => {
      // 120 waste/min: a pellet takes 2.5 through Non-Fissile Uranium and
      // 0.83 more, so 36 pellets → 18 cells → 0.6 rods → 6 plants, 15 GW.
      const r = run(plan([node(), plant('u235', 'NuclearFuelRod'), plant('pu', 'PlutoniumFuelRod')]), { isRecipeHidden: unlocked() })
      expect(r.ok).toBe(true)
      expect(mw(r, 'u235')).toBeCloseTo(30000)
      expect(mw(r, 'pu')).toBeCloseTo(15000)
      expect(r.solved.totals.surplus.map((x) => x.item)).not.toContain('base:Desc_NuclearWaste_C')
      expect(r.solved.totals.missingInputs).toEqual([])
    })

    it('with every alternate and a Ficsonium plant, nothing is left short', () => {
      const r = run(plan([node(), plant('u235', 'NuclearFuelRod'), plant('pu', 'PlutoniumFuelRod'), plant('fx', 'FicsoniumFuelRod')]))
      expect(r.ok).toBe(true)
      expect(mw(r, 'u235') + mw(r, 'pu') + mw(r, 'fx')).toBeGreaterThan(136000)
      expect(r.solved.totals.missingInputs).toEqual([])
      expect(r.solved.diagnostics).toEqual([])
    })
  })

  it('stays within the map\'s sites', () => {
    // 3 impure + 2 normal uranium nodes give at most 2100/min.
    const r = run(plan([goalNode('g', 'Desc_OreUranium_C', 3000)]))
    expect(r.scale).toBeCloseTo(0.7)
    const custom = run(plan([goalNode('g', 'Desc_OreUranium_C', 3000)]), {
      world: [{ resource: 'base:Desc_OreUranium_C', site: 'node', purity: 'base:pure', count: 3 }],
    })
    expect(custom.scale).toBeCloseTo(1)
  })
})
