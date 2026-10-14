import { buildCatalog } from '../../catalog'
import type { DataPack } from '../../catalog'
import { loadBasePack } from '../../catalog/__tests__/basePack'
import type { ExtractorNode, GoalNode, Plan, PlanEdge, PlanNode, RecipeNode, SupplyNode } from '../types'

export const base = loadBasePack()
export const { catalog } = buildCatalog([base])
export const withPacks = (...packs: DataPack[]) => buildCatalog([base, ...packs]).catalog

export const machine = (id: string) => catalog.machines.get(`base:${id}`)!
export const recipe = (id: string) => catalog.recipes.get(`base:${id}`)!

const at = { x: 0, y: 0 }

export function recipeNode(id: string, recipeId: string, machineId: string, o: Partial<RecipeNode> = {}): RecipeNode {
  return {
    id,
    kind: 'recipe',
    position: at,
    recipe: `base:${recipeId}`,
    machine: `base:${machineId}`,
    limited: false,
    count: 1,
    clock: 1,
    sloops: 0,
    ...o,
  }
}

export function extractorNode(
  id: string,
  machineId: string,
  resource: string,
  sites: ExtractorNode['sites'],
  o: Partial<ExtractorNode> = {},
): ExtractorNode {
  return {
    id,
    kind: 'extractor',
    position: at,
    machine: `base:${machineId}`,
    resource: `base:${resource}`,
    limited: false,
    sites,
    clock: 1,
    sloops: 0,
    ...o,
  }
}

export function supplyNode(id: string, item: string, perMin: number, limited = true): SupplyNode {
  return { id, kind: 'supply', position: at, item: `base:${item}`, perMin, limited }
}

export function goalNode(id: string, item: string, target: number | 'max'): GoalNode {
  return { id, kind: 'goal', position: at, item: `base:${item}`, target }
}

/** Edges written as [source, target, item]. */
export function plan(nodes: PlanNode[], edges: [string, string, string, number?][] = [], o: Partial<Plan> = {}): Plan {
  return {
    schemaVersion: 1,
    name: 'test',
    packs: [{ id: 'base', version: base.manifest.version }],
    settings: { machineMode: 'fractional' },
    nodes,
    edges: edges.map(
      ([source, target, item, share], i): PlanEdge => ({
        id: `e${i}`,
        source,
        target,
        item: `base:${item}`,
        ...(share !== undefined ? { share } : {}),
      }),
    ),
    ...o,
  }
}
