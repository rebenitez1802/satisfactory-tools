import { describe, expect, it } from 'vitest'
import { buildUpstream, chooseProducer, openInputs } from '../autobuild'
import { solvePlan } from '../solve'
import type { Plan, PlanNode, RecipeNode } from '../types'
import { catalog, extractorNode, goalNode, plan, recipeNode } from './fixtures'

const b = (id: string) => `base:${id}`

function ids() {
  let i = 0
  return () => `a${++i}`
}

/** Build every open input of a one-goal plan. */
function buildGoal(item: string, target: number | 'max', opts: Partial<Parameters<typeof buildUpstream>[3]> = {}, extra: PlanNode[] = []) {
  const start = plan([goalNode('goal', item, target), ...extra])
  return buildUpstream(start, catalog, openInputs(start, catalog, { node: 'goal' }), { newId: ids(), ...opts })
}

const recipesOf = (p: Plan) =>
  p.nodes.filter((n): n is RecipeNode => n.kind === 'recipe').map((n) => catalog.recipes.get(n.recipe)!)
const names = (p: Plan) => recipesOf(p).map((r) => r.name).sort()
const extracted = (p: Plan) =>
  p.nodes.flatMap((n) => (n.kind === 'extractor' ? [`${catalog.items.get(n.resource)!.name} ← ${catalog.machines.get(n.machine)!.name}`] : [])).sort()

/** The chain is complete: no missing inputs, and the goal gets what it asks for. */
function expectComplete(p: Plan, goal = 'goal') {
  const r = solvePlan(p, catalog)
  expect(openInputs(p, catalog)).toEqual([])
  expect(r.totals.missingInputs).toEqual([])
  const g = r.goals.find((x) => x.id === goal)!
  if (g.requested !== 'max') expect(g.achieved).toBeCloseTo(g.requested, 6)
  return r
}

describe('chooseProducer', () => {
  const pick = (item: string, opts = {}) => {
    const o = chooseProducer(catalog, b(item), opts)
    switch (o?.kind) {
      case 'recipe':
        return o.recipe.name
      case 'extractor':
        return `extract: ${o.machine.name}`
      default:
        return o?.kind
    }
  }

  it('mines raw resources with the best extractor that powers itself', () => {
    expect(pick('Desc_OreIron_C')).toBe('extract: Miner Mk.3')
    expect(pick('Desc_Water_C')).toBe('extract: Water Extractor')
    expect(pick('Desc_LiquidOil_C')).toBe('extract: Oil Extractor')
    expect(pick('Desc_NitrogenGas_C')).toBe('extract: Resource Well Extractor')
    // A remembered converter recipe doesn't beat mining.
    expect(pick('Desc_Coal_C', { preferred: { [b('Desc_Coal_C')]: b('Recipe_Coal_1_C') } })).toBe('extract: Miner Mk.3')
  })

  it('takes the simplest standard recipe, never unpackaging or residue ones', () => {
    expect(pick('Desc_IronPlate_C')).toBe('Iron Plate')
    expect(pick('Desc_LiquidFuel_C')).toBe('Fuel')
    expect(pick('Desc_Plastic_C')).toBe('Plastic')
    expect(pick('Desc_Rubber_C')).toBe('Rubber')
    expect(pick('Desc_NitricAcid_C')).toBe('Nitric Acid')
  })

  it("uses the player's remembered recipe, unless it is locked", () => {
    const preferred = { [b('Desc_IronScrew_C')]: b('Recipe_Alternate_Screw_C') }
    expect(pick('Desc_IronScrew_C', { preferred })).toBe('Cast Screw')
    expect(pick('Desc_IronScrew_C', { preferred, isRecipeHidden: (id: string) => id === b('Recipe_Alternate_Screw_C') })).toBe('Screw')
  })

  it('falls back to an unlocked alternate, then to a supply', () => {
    // Polymer Resin is only ever a main product of its alternate.
    expect(pick('Desc_PolymerResin_C')).toBe('Polymer Resin')
    expect(pick('Desc_PolymerResin_C', { isRecipeHidden: () => true })).toBe('supply')
    expect(pick('Desc_Leaves_C')).toBe('supply')
  })

  it('skips recipes that eat an item already being built', () => {
    expect(pick('Desc_IronIngot_C', { avoid: new Set([b('Desc_OreIron_C')]) })).not.toBe('Iron Ingot')
  })
})

describe('buildUpstream', () => {
  it('builds a Modular Frame goal down to Iron Ore, with nothing missing', () => {
    const { plan: p, added } = buildGoal('Desc_ModularFrame_C', 10)
    expect(added).toHaveLength(p.nodes.length - 1)
    expect(names(p)).toEqual(['Iron Ingot', 'Iron Plate', 'Iron Rod', 'Modular Frame', 'Reinforced Iron Plate', 'Screw'])
    expect(extracted(p)).toEqual(['Iron Ore ← Miner Mk.3'])
    // Iron Rod is reused by Screws and the frame; everything is flexible.
    expect(p.nodes.every((n) => n.kind === 'goal' || !('limited' in n) || !n.limited)).toBe(true)
    const r = expectComplete(p)
    const ore = p.nodes.find((n) => n.kind === 'extractor')!
    expect(r.nodes.get(ore.id)!.activity).toBeGreaterThan(0)
  })

  it('builds a Computer chain with fluids', () => {
    const { plan: p } = buildGoal('Desc_Computer_C', 2)
    expect(names(p)).toEqual(['Cable', 'Circuit Board', 'Computer', 'Copper Ingot', 'Copper Sheet', 'Plastic', 'Wire'])
    expect(extracted(p)).toEqual(['Copper Ore ← Miner Mk.3', 'Crude Oil ← Oil Extractor'])
    // One refinery feeds both the boards and the computers.
    expect(p.edges.filter((e) => e.item === b('Desc_Plastic_C'))).toHaveLength(2)
    expect(recipesOf(p).every((r) => !r.alternate)).toBe(true)
    expectComplete(p)
  })

  it('fuels a generator, water included', () => {
    const gen = recipeNode('gen', 'Recipe_GeneratorCoal_Coal_C', 'Build_GeneratorCoal_C', { power: 150 })
    const start = plan([gen])
    const { plan: p } = buildUpstream(start, catalog, openInputs(start, catalog), { newId: ids() })
    expect(extracted(p)).toEqual(['Coal ← Miner Mk.3', 'Water ← Water Extractor'])
    const r = solvePlan(p, catalog)
    expect(r.totals.missingInputs).toEqual([])
    expect(r.totals.generatedMw).toBeCloseTo(150, 6)
  })

  it('builds a nuclear fuel chain (deep, with water and acid)', () => {
    const gen = recipeNode('gen', 'Recipe_GeneratorNuclear_NuclearFuelRod_C', 'Build_GeneratorNuclear_C', { power: 2500 })
    const start = plan([gen])
    const { plan: p } = buildUpstream(start, catalog, openInputs(start, catalog), { newId: ids() })
    expect(names(p)).toEqual(expect.arrayContaining(['Encased Uranium Cell', 'Sulfuric Acid', 'Uranium Fuel Rod']))
    expect(extracted(p)).toEqual(expect.arrayContaining(['Uranium ← Miner Mk.3', 'Water ← Water Extractor', 'Sulfur ← Miner Mk.3']))
    expect(recipesOf(p).every((r) => !r.alternate)).toBe(true)
    const r = solvePlan(p, catalog)
    expect(r.totals.missingInputs).toEqual([])
    expect(r.totals.generatedMw).toBeCloseTo(2500, 6)
  })

  it('leaves byproducts unconnected (Plastic → Heavy Oil Residue)', () => {
    const { plan: p } = buildGoal('Desc_Plastic_C', 20)
    expect(names(p)).toEqual(['Plastic'])
    expect(extracted(p)).toEqual(['Crude Oil ← Oil Extractor'])
    const refinery = p.nodes.find((n) => n.kind === 'recipe')!
    expect(p.edges.filter((e) => e.source === refinery.id).map((e) => e.item)).toEqual([b('Desc_Plastic_C')])
    const r = expectComplete(p)
    expect(r.totals.surplus.map((s) => s.item)).toContain(b('Desc_HeavyOilResidue_C'))
  })

  it('stops at recipe loops (Packaged Water)', () => {
    const { plan: p } = buildGoal('Desc_PackagedWater_C', 30)
    expect(names(p)).toEqual(['Empty Canister', 'Packaged Water', 'Plastic'])
    expect(extracted(p)).toEqual(['Crude Oil ← Oil Extractor', 'Water ← Water Extractor'])
    expectComplete(p)
  })

  it('never picks locked alternates', () => {
    const locked = (id: string) => catalog.recipes.get(id)!.alternate
    for (const item of ['Desc_ModularFrame_C', 'Desc_Computer_C', 'Desc_MotorLightweight_C']) {
      const { plan: p } = buildGoal(item, 5, { isRecipeHidden: locked })
      expect(recipesOf(p).filter((r) => r.alternate)).toEqual([])
    }
  })

  it('reuses a recipe the player switched to', () => {
    const preferred = { [b('Desc_IronScrew_C')]: b('Recipe_Alternate_Screw_C') }
    const { plan: p } = buildGoal('Desc_IronPlateReinforced_C', 5, { preferred })
    expect(names(p)).toEqual(['Cast Screw', 'Iron Ingot', 'Iron Plate', 'Reinforced Iron Plate'])
    expectComplete(p)
  })

  it('running it twice adds nothing', () => {
    const { plan: once } = buildGoal('Desc_ModularFrame_C', 10)
    const twice = buildUpstream(once, catalog, openInputs(once, catalog), { newId: ids() })
    expect(twice.added).toEqual([])
    expect(twice.plan).toBe(once)
  })

  it('reuses sources the player has, even limited, but not limited machine groups', () => {
    const ore = extractorNode('ore', 'Build_MinerMk2_C', 'Desc_OreIron_C', [{ purity: 'base:normal', count: 1 }], { limited: true })
    const rods = recipeNode('rods', 'Recipe_IronRod_C', 'Build_ConstructorMk1_C', { limited: true, count: 1 })
    const { plan: p } = buildGoal('Desc_IronRod_C', 'max', {}, [ore, rods])
    expect(p.nodes.filter((n) => n.kind === 'extractor').map((n) => n.id)).toEqual(['ore'])
    expect(p.edges.some((e) => e.source === 'rods')).toBe(false)
    // Max with the miner's 120 ore/min as the only limit: 120 ingots → 120 rods.
    expect(solvePlan(p, catalog).goals[0].achieved).toBeCloseTo(120, 6)
  })

  it('without reuse, every input gets its own producer', () => {
    const shared = buildGoal('Desc_ModularFrame_C', 10).plan
    const own = buildGoal('Desc_ModularFrame_C', 10, { reuse: false }).plan
    expect(own.nodes.length).toBeGreaterThan(shared.nodes.length)
    expectComplete(own)
  })

  it('never connects into its own downstream (no accidental loops)', () => {
    // Iron Ingot feeds the goal through Iron Plate; building the plate's
    // missing ingot must not reuse anything downstream of the plate.
    const start = plan(
      [recipeNode('plate', 'Recipe_IronPlate_C', 'Build_ConstructorMk1_C'), goalNode('goal', 'Desc_IronPlate_C', 30)],
      [['plate', 'goal', 'Desc_IronPlate_C']],
    )
    const { plan: p } = buildUpstream(start, catalog, openInputs(start, catalog), { newId: ids() })
    expect(p.edges.some((e) => e.target === 'plate' && e.source !== 'goal')).toBe(true)
    expectComplete(p)
  })

  it('fills only the asked-for port, and a reused node’s own missing inputs', () => {
    const start = plan([
      recipeNode('rip', 'Recipe_IronPlateReinforced_C', 'Build_AssemblerMk1_C'),
      recipeNode('plate', 'Recipe_IronPlate_C', 'Build_ConstructorMk1_C'),
      goalNode('goal', 'Desc_IronPlateReinforced_C', 5),
    ], [['rip', 'goal', 'Desc_IronPlateReinforced_C']])
    const { plan: p } = buildUpstream(start, catalog, [{ node: 'rip', item: b('Desc_IronPlate_C') }], { newId: ids() })
    // The existing plate node is reused, and its ingot input gets built too.
    expect(p.edges.some((e) => e.source === 'plate' && e.target === 'rip')).toBe(true)
    expect(openInputs(p, catalog)).toEqual([{ node: 'rip', item: b('Desc_IronScrew_C') }])
  })
})
