// Plan edits that need more than a field change: switching what a node makes
// drops belts whose item the node no longer has, removing nodes takes their
// belts along, and so on. All pure: they return a new plan.

import type { Catalog, ItemId, Machine, Recipe } from '../catalog'
import type { Plan, PlanEdge, PlanNode } from './types'

/** Items a node consumes and produces, or undefined if its content isn't loaded. */
export function portsOf(node: PlanNode, catalog: Catalog): { inputs: Set<ItemId>; outputs: Set<ItemId> } | undefined {
  switch (node.kind) {
    case 'recipe': {
      const r = catalog.recipes.get(node.recipe)
      if (!r) return undefined
      return { inputs: new Set(r.inputs.map((a) => a.item)), outputs: new Set(r.outputs.map((a) => a.item)) }
    }
    case 'extractor':
      return { inputs: new Set(), outputs: new Set([node.resource]) }
    case 'supply':
      return { inputs: new Set(), outputs: new Set([node.item]) }
    case 'goal':
      return { inputs: new Set([node.item]), outputs: new Set() }
  }
}

/** Drop belts whose item no longer matches a port on either end (unresolved nodes keep theirs). */
export function pruneEdges(plan: Plan, catalog: Catalog): Plan {
  const ports = new Map(plan.nodes.map((n) => [n.id, portsOf(n, catalog)]))
  const edges = plan.edges.filter((e) => {
    if (!ports.has(e.source) || !ports.has(e.target)) return false
    const s = ports.get(e.source)
    const t = ports.get(e.target)
    return (!s || s.outputs.has(e.item)) && (!t || t.inputs.has(e.item))
  })
  return edges.length === plan.edges.length ? plan : { ...plan, edges }
}

/** Fields that say what a node is. Changing one makes it something not built yet. */
const IDENTITY = ['recipe', 'machine', 'resource', 'item'] as const

/**
 * Patch a node, then drop belts its new ports can't carry. A new recipe,
 * machine, resource or item also clears its done mark.
 */
export function updateNode(plan: Plan, id: string, patch: Partial<PlanNode>, catalog: Catalog): Plan {
  const nodes = plan.nodes.map((n) => {
    if (n.id !== id) return n
    const next = { ...n, ...patch } as PlanNode
    const rec = n as unknown as Record<string, unknown>
    const changed = IDENTITY.some((k) => k in patch && (patch as Record<string, unknown>)[k] !== rec[k])
    if (changed && !('done' in patch)) delete next.done
    return next
  })
  return pruneEdges({ ...plan, nodes }, catalog)
}

/**
 * Mark nodes done in the build checklist, remembering how many machines each
 * had (`built`), or clear the mark when `built` is false.
 */
export function markDone(plan: Plan, ids: Iterable<string>, built: ((id: string) => number) | false): Plan {
  const pick = new Set(ids)
  const nodes = plan.nodes.map((n): PlanNode => {
    if (!pick.has(n.id)) return n
    if (built) return { ...n, done: { count: built(n.id) } }
    if (!n.done) return n
    const { done: _, ...rest } = n
    return rest as PlanNode
  })
  return { ...plan, nodes }
}

/**
 * Switch a recipe node to another recipe. Keeps the machine if the new recipe
 * runs in it, otherwise uses the recipe's first machine.
 */
export function setRecipe(plan: Plan, id: string, recipeId: string, catalog: Catalog): Plan {
  const recipe = catalog.recipes.get(recipeId)
  const node = plan.nodes.find((n) => n.id === id)
  if (!recipe || node?.kind !== 'recipe') return plan
  const machine = recipe.machines.includes(node.machine) ? node.machine : recipe.machines[0]
  const amp = catalog.machines.get(machine)?.amplifier
  return updateNode(plan, id, { recipe: recipeId, machine, sloops: Math.min(node.sloops, amp?.slots ?? 0) }, catalog)
}

const edgeId = (source: string, target: string, item: ItemId) => `${source}->${target}:${item}`

/**
 * Connect a port to whichever port of `to` carries the same item: dragging
 * from an output connects to `to`'s input, from an input to `to`'s output.
 * Returns the plan unchanged when `to` has no such port or the belt exists.
 */
export function connectPorts(plan: Plan, catalog: Catalog, from: string, item: ItemId, side: 'in' | 'out', to: string): Plan {
  const target = plan.nodes.find((n) => n.id === to)
  const ports = target && portsOf(target, catalog)
  if (!ports || from === to) return plan
  const [source, sink] = side === 'out' ? [from, to] : [to, from]
  if (!(side === 'out' ? ports.inputs : ports.outputs).has(item)) return plan
  if (plan.edges.some((e) => e.source === source && e.target === sink && e.item === item)) return plan
  return { ...plan, edges: [...plan.edges, { id: edgeId(source, sink, item), source, target: sink, item }] }
}

/**
 * Move the input end of belts to node `to` (which must take their item);
 * belts that would duplicate an existing one are dropped.
 */
export function retargetEdges(plan: Plan, catalog: Catalog, ids: Iterable<string>, to: string): Plan {
  const move = new Set(ids)
  const target = plan.nodes.find((n) => n.id === to)
  const ports = target && portsOf(target, catalog)
  if (!ports) return plan
  const kept = plan.edges.filter((e) => !move.has(e.id))
  const moved: PlanEdge[] = []
  for (const e of plan.edges) {
    if (!move.has(e.id) || !ports.inputs.has(e.item) || e.source === to) continue
    if ([...kept, ...moved].some((x) => x.source === e.source && x.target === to && x.item === e.item)) continue
    moved.push({ ...e, id: edgeId(e.source, to, e.item), target: to })
  }
  return moved.length ? { ...plan, edges: [...kept, ...moved] } : plan
}

export function removeEdges(plan: Plan, ids: Iterable<string>): Plan {
  const gone = new Set(ids)
  return { ...plan, edges: plan.edges.filter((e) => !gone.has(e.id)) }
}

export function removeNodes(plan: Plan, ids: Iterable<string>): Plan {
  const gone = new Set(ids)
  return {
    ...plan,
    nodes: plan.nodes.filter((n) => !gone.has(n.id)),
    edges: plan.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
  }
}

/** Nodes plus the belts running between them, ready to paste. */
export interface Clip {
  nodes: PlanNode[]
  edges: PlanEdge[]
}

export function copyNodes(plan: Plan, ids: Iterable<string>): Clip {
  const pick = new Set(ids)
  return {
    nodes: plan.nodes.filter((n) => pick.has(n.id)),
    edges: plan.edges.filter((e) => pick.has(e.source) && pick.has(e.target)),
  }
}

/** Add a copy of `clip` with fresh ids, shifted by `offset`. Returns the new plan and the new node ids. */
export function pasteClip(
  plan: Plan,
  clip: Clip,
  newId: () => string,
  offset = { x: 40, y: 40 },
): { plan: Plan; ids: string[] } {
  if (!clip.nodes.length) return { plan, ids: [] }
  const ids = new Map(clip.nodes.map((n) => [n.id, newId()]))
  // Copies are new machines: none of them is built yet.
  const nodes = clip.nodes.map(({ done: _, ...n }): PlanNode => ({
    ...n,
    id: ids.get(n.id)!,
    position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
  }))
  const edges = clip.edges.map((e) => {
    const source = ids.get(e.source)!
    const target = ids.get(e.target)!
    return { ...e, id: `${source}->${target}:${e.item}`, source, target }
  })
  return { plan: { ...plan, nodes: [...plan.nodes, ...nodes], edges: [...plan.edges, ...edges] }, ids: [...ids.values()] }
}

/** Copy nodes and the belts between them, offset so the copies are visible. */
export function duplicateNodes(plan: Plan, ids: Iterable<string>, newId: () => string): Plan {
  return pasteClip(plan, copyNodes(plan, ids), newId).plan
}

/**
 * Why a producer can't be split into one group per consumer of `item`, or
 * undefined when it can: only plain recipe nodes (not limited, no power
 * target) whose other outputs have no belts, with two or more belts of `item`.
 */
export function splitByConsumerBlocker(plan: Plan, nodeId: string, item: ItemId): string | undefined {
  const node = plan.nodes.find((n) => n.id === nodeId)
  if (!node || node.kind !== 'recipe') return 'Only machine groups making a recipe can be split.'
  if (node.limited) return 'The group is limited (⛔): clear the limit to split it.'
  if (node.power !== undefined) return 'Generators with a power target can\'t be split.'
  if (plan.edges.some((e) => e.source === nodeId && e.item !== item)) return 'Its other outputs have belts too.'
  if (plan.edges.filter((e) => e.source === nodeId && e.item === item).length < 2) return 'It feeds only one belt.'
  return undefined
}

/**
 * Dedicated machines: give each consumer of `item` its own copy of producer
 * `nodeId`, so nothing has to split that item. The first belt stays on the
 * node; every other belt moves to a copy stacked below it. Each copy gets the
 * node's input belts too (its suppliers now feed several groups, which
 * machines pull from like a manifold). The solver then sizes every group to
 * its consumer. Returns the plan unchanged when `splitByConsumerBlocker` says no.
 */
export function splitByConsumer(plan: Plan, nodeId: string, item: ItemId, newId: () => string, gapY = 200): { plan: Plan; ids: string[] } {
  if (splitByConsumerBlocker(plan, nodeId, item)) return { plan, ids: [] }
  const node = plan.nodes.find((n) => n.id === nodeId)!
  const outs = plan.edges.filter((e) => e.source === nodeId && e.item === item)
  const ins = plan.edges.filter((e) => e.target === nodeId)
  const nodes: PlanNode[] = []
  const edges: PlanEdge[] = []
  const moved = new Set<string>()
  outs.slice(1).forEach((out, k) => {
    const { done: _, ...rest } = node
    const id = newId()
    nodes.push({ ...rest, id, position: { x: node.position.x, y: node.position.y + (k + 1) * gapY } })
    moved.add(out.id)
    edges.push({ ...out, id: `${id}->${out.target}:${out.item}`, source: id })
    for (const e of ins) edges.push({ ...e, id: `${e.source}->${id}:${e.item}`, target: id })
  })
  return {
    plan: { ...plan, nodes: [...plan.nodes, ...nodes], edges: [...plan.edges.filter((e) => !moved.has(e.id)), ...edges] },
    ids: nodes.map((n) => n.id),
  }
}

/** The generator a recipe runs in, if it makes power. */
export function generatorOf(catalog: Catalog, recipe: Recipe): Machine | undefined {
  const machine = catalog.machines.get(recipe.machines[0])
  return machine?.generation ? machine : undefined
}

/** The item a recipe is shown by: its main product, or a generator's fuel. */
export function recipeItem(catalog: Catalog, recipe: Recipe): ItemId | undefined {
  return (generatorOf(catalog, recipe) ? recipe.inputs[0] : recipe.outputs[0])?.item
}

/**
 * Recipes that make the same main product as `recipeId` (for switching to an
 * alternate). For a generator: the other fuels it burns.
 */
export function sameProductRecipes(catalog: Catalog, recipeId: string): string[] {
  const recipe = catalog.recipes.get(recipeId)
  if (!recipe) return []
  const gen = generatorOf(catalog, recipe)
  if (gen) return [...catalog.recipes.values()].filter((r) => r.machines.includes(gen.id)).map((r) => r.id)
  const product = recipe.outputs[0]?.item
  if (!product) return []
  return (catalog.recipesProducing.get(product) ?? []).filter((id) => catalog.recipes.get(id)!.outputs[0].item === product)
}

/** Check that untrusted JSON looks like a plan; returns an error message if not. */
export function validatePlan(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return 'Not a plan file.'
  const p = data as Partial<Plan>
  if (p.schemaVersion === undefined) return 'Not a plan file.'
  if (p.schemaVersion !== 1) return 'Unsupported plan version.'
  if (!Array.isArray(p.nodes) || !Array.isArray(p.edges)) return 'Plan is missing nodes or edges.'
  if (!p.settings || typeof p.settings !== 'object') return 'Plan is missing settings.'
  const ids = new Set<string>()
  for (const n of p.nodes) {
    if (!n || typeof n.id !== 'string' || !['recipe', 'extractor', 'supply', 'goal'].includes(n.kind)) return 'Plan has an invalid node.'
    if (ids.has(n.id)) return `Duplicate node id "${n.id}".`
    ids.add(n.id)
  }
  for (const e of p.edges) {
    if (!e || typeof e.id !== 'string' || !ids.has(e.source) || !ids.has(e.target) || typeof e.item !== 'string') {
      return 'Plan has an invalid connection.'
    }
  }
  return undefined
}
