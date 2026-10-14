import { describe, expect, it } from 'vitest'
import { nodeRate, recipeAtRate } from '../compare'
import { sameProductRecipes, setRecipe } from '../edit'
import { solvePlan } from '../solve'
import type { MachineMode, Plan, RecipeNode } from '../types'
import { catalog, goalNode, plan, recipeNode } from './fixtures'

const SCREW = 'Desc_IronScrew_C'

/** Every recipe for the node's product, sized at its rate, against solving the plan after switching to it. */
function expectMatchesSolve(p: Plan, id: string) {
  const node = p.nodes.find((n) => n.id === id) as RecipeNode
  const rate = nodeRate(catalog, node, solvePlan(p, catalog).nodes.get(id))!
  expect(rate).toBeGreaterThan(0)
  const options = sameProductRecipes(catalog, node.recipe)
  expect(options.length).toBeGreaterThan(1)
  for (const recipeId of options) {
    const at = recipeAtRate(catalog, node, catalog.recipes.get(recipeId)!, rate, p.settings.machineMode)!
    const res = solvePlan(setRecipe(p, id, recipeId, catalog), catalog).nodes.get(id)!
    expect(at.setup.count).toBeCloseTo(res.setup!.count)
    expect(at.setup.clock).toBeCloseTo(res.setup!.clock)
    expect(at.powerMw).toBeCloseTo(res.powerMw)
    for (const f of at.flows.inputs) expect(f.perMin).toBeCloseTo(res.inputs.find((i) => i.item === f.item)!.needed)
    for (const f of at.flows.outputs) expect(f.perMin).toBeCloseTo(res.outputs.find((o) => o.item === f.item)!.produced)
  }
}

const screws = (mode: MachineMode, o: Partial<RecipeNode> = {}) =>
  plan([recipeNode('screw', 'Recipe_Screw_C', 'Build_ConstructorMk1_C', o), goalNode('goal', SCREW, 90)], [['screw', 'goal', SCREW]], {
    settings: { machineMode: mode },
  })

describe('recipes at a node rate', () => {
  it('scales every screw recipe to 90 screws/min', () => {
    const p = screws('fractional')
    const node = p.nodes[0] as RecipeNode
    const at = (id: string) => recipeAtRate(catalog, node, catalog.recipes.get(`base:${id}`)!, 90, 'fractional')!
    expect(at('Recipe_Screw_C').flows.inputs).toEqual([{ item: 'base:Desc_IronRod_C', perMin: 22.5 }])
    // Cast Screw: 5 ingots → 20 screws; Steel Screw: 1 beam → 52 screws.
    expect(at('Recipe_Alternate_Screw_C').flows.inputs[0].perMin).toBeCloseTo(22.5)
    expect(at('Recipe_Alternate_Screw_2_C').flows.inputs[0].perMin).toBeCloseTo(90 / 52)
    for (const id of ['Recipe_Screw_C', 'Recipe_Alternate_Screw_C', 'Recipe_Alternate_Screw_2_C']) {
      expect(at(id).flows.outputs[0].perMin).toBeCloseTo(90)
    }
  })

  it('matches the node after switching, fractional or whole machines', () => {
    expectMatchesSolve(screws('fractional'), 'screw')
    expectMatchesSolve(screws('underclock'), 'screw')
    expectMatchesSolve(screws('fractional', { clock: 1.5, sloops: 1 }), 'screw')
  })

  it('compares a generator group by its machines', () => {
    const p = plan([recipeNode('gen', 'Recipe_GeneratorCoal_Coal_C', 'Build_GeneratorCoal_C', { power: 750 })], [])
    expect(nodeRate(catalog, p.nodes[0] as RecipeNode, solvePlan(p, catalog).nodes.get('gen'))).toBeCloseTo(10)
    expectMatchesSolve(p, 'gen')
  })

  it('has no rate for an idle node', () => {
    const p = plan([recipeNode('screw', 'Recipe_Screw_C', 'Build_ConstructorMk1_C')], [])
    expect(nodeRate(catalog, p.nodes[0] as RecipeNode, solvePlan(p, catalog).nodes.get('screw'))).toBeUndefined()
  })
})
