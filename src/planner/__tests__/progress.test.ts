import { describe, expect, it } from 'vitest'
import { hubTiers, needsLabel, recipeAccess, type GameProgress } from '../progress'
import { optimize } from '../optimize'
import { solvePlan } from '../solve'
import { catalog, goalNode, plan } from './fixtures'

const b = (id: string) => `base:${id}`
const at = (progress: GameProgress | undefined, locked: string[] = []) => {
  const access = recipeAccess(catalog, progress, new Set(locked.map(b)))
  return (id: string) => access(b(id))
}
const why = (a: ReturnType<ReturnType<typeof at>>) => (a.state === 'progress' ? needsLabel(a.needs) : a.state)

describe('game progress', () => {
  it('unlocks everything without progress, less what is locked by hand', () => {
    const a = at(undefined, ['Recipe_IronPlate_C'])
    expect(a('Recipe_Plastic_C').state).toBe('ok')
    expect(a('Recipe_Alternate_Diamond_Pink_C').state).toBe('ok')
    expect(a('Recipe_IronPlate_C').state).toBe('locked')
  })

  it('unlocks milestones up to the tier', () => {
    expect(hubTiers(catalog)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const t0 = at({ tier: 0, research: [] })
    expect(t0('Recipe_IngotIron_C').state).toBe('ok')
    expect(why(t0('Recipe_IngotSteel_C'))).toBe('Tier 3 (Basic Steel Production)')
    expect(why(at({ tier: 4, research: [] })('Recipe_Plastic_C'))).toBe('Tier 5 (Oil Processing)')
    expect(at({ tier: 5, research: [] })('Recipe_Plastic_C').state).toBe('ok')
  })

  it('unlocks research that is ticked', () => {
    expect(why(at({ tier: 9, research: [] })('Recipe_Quickwire_C'))).toBe('Research: Quickwire')
    expect(at({ tier: 0, research: [b('Research_Caterium_2_C')] })('Recipe_Quickwire_C').state).toBe('ok')
  })

  it('offers an alternate once what it needs is done, and a lock by hand still wins', () => {
    expect(why(at({ tier: 4, research: [] })('Recipe_Alternate_PureIronIngot_C'))).toBe('Tier 5 (Oil Processing)')
    expect(at({ tier: 5, research: [] })('Recipe_Alternate_PureIronIngot_C').state).toBe('ok')
    expect(at({ tier: 5, research: [] }, ['Recipe_Alternate_PureIronIngot_C'])('Recipe_Alternate_PureIronIngot_C').state).toBe('locked')
    expect(why(at({ tier: 9, research: [] })('Recipe_Alternate_RocketFuel_Nitro_C'))).toBe('Research: Rocket Fuel')
  })

  it('at Tier 4, ✨ Optimize has no plastic and says so; at Tier 5 it makes it', () => {
    let n = 0
    const run = (tier: number) => {
      const access = recipeAccess(catalog, { tier, research: [] }, new Set())
      return optimize(plan([goalNode('g', 'Desc_Plastic_C', 20)]), catalog, { newId: () => `p${n++}`, isRecipeHidden: (id) => access(id).state !== 'ok' })
    }
    const t4 = run(4)
    expect(t4.ok).toBe(true)
    expect(t4.message).toMatch(/No recipe you can use makes Plastic/)
    expect(t4.plan.nodes.some((x) => x.kind === 'supply' && x.item === b('Desc_Plastic_C'))).toBe(true)
    const t5 = run(5)
    expect(t5.message).toBeUndefined()
    expect(t5.plan.nodes.some((x) => x.kind === 'supply')).toBe(false)
    expect(solvePlan(t5.plan, catalog).goals[0].achieved).toBeCloseTo(20)
  })
})
