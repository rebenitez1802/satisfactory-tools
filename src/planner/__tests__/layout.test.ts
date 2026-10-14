import { describe, expect, it } from 'vitest'
import { samplePlan } from '../../components/planner/samplePlan'
import { DEFAULT_SIZE, layoutPlan, type Size } from '../layout'
import type { Plan } from '../types'
import { extractorNode, goalNode, plan, recipeNode } from './fixtures'

const noSizes = new Map<string, Size>()

/** The plan with the layout applied. */
function apply(p: Plan, pos: Map<string, { x: number; y: number }>): Plan {
  return { ...p, nodes: p.nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n)) }
}

function overlapping(p: Plan, sizes: Map<string, Size> = noSizes): [string, string][] {
  const rect = (id: string) => ({ ...p.nodes.find((n) => n.id === id)!.position, ...(sizes.get(id) ?? DEFAULT_SIZE) })
  const hits: [string, string][] = []
  for (let i = 0; i < p.nodes.length; i++)
    for (let j = i + 1; j < p.nodes.length; j++) {
      const a = rect(p.nodes[i].id)
      const b = rect(p.nodes[j].id)
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) hits.push([p.nodes[i].id, p.nodes[j].id])
    }
  return hits
}

/** Belts whose producer isn't fully left of its consumer. */
function backwards(p: Plan): string[] {
  const at = new Map(p.nodes.map((n) => [n.id, n.position]))
  return p.edges.filter((e) => at.get(e.source)!.x + DEFAULT_SIZE.w > at.get(e.target)!.x).map((e) => `${e.source}->${e.target}`)
}

const chain = (prefix: string) => [
  extractorNode(`${prefix}ore`, 'Build_MinerMk2_C', 'Desc_OreIron_C', [{ purity: 'base:normal', count: 1 }]),
  recipeNode(`${prefix}smelt`, 'Recipe_IngotIron_C', 'Build_SmelterMk1_C'),
  recipeNode(`${prefix}plates`, 'Recipe_IronPlate_C', 'Build_ConstructorMk1_C'),
  goalNode(`${prefix}goal`, 'Desc_IronPlate_C', 'max'),
]
const chainEdges = (prefix: string): [string, string, string][] => [
  [`${prefix}ore`, `${prefix}smelt`, 'Desc_OreIron_C'],
  [`${prefix}smelt`, `${prefix}plates`, 'Desc_IronIngot_C'],
  [`${prefix}plates`, `${prefix}goal`, 'Desc_IronPlate_C'],
]

describe('layoutPlan', () => {
  it('lays out the sample left to right with no overlaps', () => {
    const p = apply(samplePlan(), layoutPlan(samplePlan(), noSizes))
    expect(overlapping(p)).toEqual([])
    expect(backwards(p)).toEqual([])
  })

  it('respects measured sizes', () => {
    const sizes = new Map(samplePlan().nodes.map((n, i) => [n.id, { w: 150 + 40 * (i % 3), h: 80 + 50 * (i % 4) }]))
    const p = apply(samplePlan(), layoutPlan(samplePlan(), sizes))
    expect(overlapping(p, sizes)).toEqual([])
  })

  it('keeps the plan where it was and settles after one run', () => {
    const first = apply(samplePlan(), layoutPlan(samplePlan(), noSizes))
    const xs = first.nodes.map((n) => n.position.x)
    const ys = first.nodes.map((n) => n.position.y)
    const was = samplePlan().nodes.map((n) => n.position)
    expect(Math.min(...xs)).toBe(Math.min(...was.map((p) => p.x)))
    expect(Math.min(...ys)).toBe(Math.min(...was.map((p) => p.y)))
    expect(apply(first, layoutPlan(first, noSizes))).toEqual(first)
  })

  it('stacks separate chains in their current order', () => {
    const nodes = [...chain('a'), ...chain('b')]
    for (const n of nodes) n.position = { x: 0, y: n.id.startsWith('a') ? 500 : 0 }
    const p = apply(plan(nodes, [...chainEdges('a'), ...chainEdges('b')]), layoutPlan(plan(nodes, [...chainEdges('a'), ...chainEdges('b')]), noSizes))
    expect(overlapping(p)).toEqual([])
    const bottomOfB = Math.max(...p.nodes.filter((n) => n.id.startsWith('b')).map((n) => n.position.y + DEFAULT_SIZE.h))
    const topOfA = Math.min(...p.nodes.filter((n) => n.id.startsWith('a')).map((n) => n.position.y))
    expect(bottomOfB).toBeLessThan(topOfA)
  })

  it('draws only the belt that closes a loop backwards', () => {
    // Water → package → unpackage, with the empty canisters going back round.
    const p0 = plan(
      [
        extractorNode('water', 'Build_WaterPump_C', 'Desc_Water_C', [{ purity: 'base:normal', count: 1 }]),
        recipeNode('pack', 'Recipe_PackagedWater_C', 'Build_Packager_C'),
        recipeNode('unpack', 'Recipe_UnpackageWater_C', 'Build_Packager_C'),
        goalNode('goal', 'Desc_Water_C', 'max'),
      ],
      [
        ['water', 'pack', 'Desc_Water_C'],
        ['pack', 'unpack', 'Desc_PackagedWater_C'],
        ['unpack', 'pack', 'Desc_FluidCanister_C'],
        ['unpack', 'goal', 'Desc_Water_C'],
      ],
    )
    const p = apply(p0, layoutPlan(p0, noSizes))
    expect(overlapping(p)).toEqual([])
    expect(backwards(p)).toEqual(['unpack->pack'])
  })

  it('moves only the chosen nodes, anchored to the nodes they connect to', () => {
    const p0 = samplePlan()
    // Scramble the rods → screws pair, then tidy just those two.
    const messy = apply(p0, new Map([['rods', { x: 2000, y: 900 }], ['screws', { x: -500, y: 40 }]]))
    const pos = layoutPlan(messy, noSizes, { only: ['rods', 'screws'] })
    expect([...pos.keys()].sort()).toEqual(['rods', 'screws'])
    const p = apply(messy, pos)
    expect(backwards(p)).toEqual([])
    // Back between the smelter and the assembler.
    const x = (id: string) => p.nodes.find((n) => n.id === id)!.position.x
    expect(x('smelt')).toBeLessThan(x('rods'))
    expect(x('screws')).toBeLessThan(x('rip'))
  })

  it('steps a laid-out subset down past fixed cards it would cover', () => {
    const p0 = apply(samplePlan(), layoutPlan(samplePlan(), noSizes))
    // A stranger parked exactly where the tidied rods/screws pair will go.
    const rods = p0.nodes.find((n) => n.id === 'rods')!.position
    const blocker = goalNode('blocker', 'Desc_IronRod_C', 'max')
    blocker.position = { ...rods }
    const messy = apply({ ...p0, nodes: [...p0.nodes, blocker] }, new Map([['rods', { x: 3000, y: 0 }], ['screws', { x: 3300, y: 0 }]]))
    const p = apply(messy, layoutPlan(messy, noSizes, { only: ['rods', 'screws'] }))
    expect(overlapping(p)).toEqual([])
    expect(p.nodes.find((n) => n.id === 'blocker')!.position).toEqual(rods)
  })

  it('keeps an unconnected selection at its top-left corner', () => {
    const nodes = chain('a')
    nodes.forEach((n, i) => (n.position = { x: 300 - 100 * i, y: 200 + 10 * i }))
    const p = apply(plan(nodes, chainEdges('a')), layoutPlan(plan(nodes, chainEdges('a')), noSizes))
    expect(Math.min(...p.nodes.map((n) => n.position.x))).toBe(0)
    expect(Math.min(...p.nodes.map((n) => n.position.y))).toBe(200)
    expect(backwards(p)).toEqual([])
  })

  it('ignores unknown ids and empty selections', () => {
    expect(layoutPlan(samplePlan(), noSizes, { only: ['nope'] }).size).toBe(0)
  })
})
