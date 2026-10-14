// Auto-build ("⚡ Build chain"): fills a plan's unconnected inputs with
// producers, all the way back to raw resources. Pure, like the other edit
// helpers: it returns a new plan plus the ids of the nodes it added, and the
// UI lays those out with `layoutPlan` and applies it as one undo step.
//
// - Everything it adds is flexible (sized by the plan's targets and limits),
//   because it creates nodes the way dragging back from an input does.
// - It reuses before it adds: an input connects to a node that already makes
//   its item, if there is one. Sources (extractors, supplies) are reused even
//   when ⛔ limited, since they are what the player has; recipe nodes only
//   when flexible, so a "4 Constructors" limit never quietly caps a new chain.
//   Nodes downstream of the input are skipped, so reuse never closes a loop.
// - What makes an item is picked by `chooseProducer`: mine raw resources, then
//   the player's remembered recipe, then the simplest standard recipe, then
//   the simplest unlocked alternate, else a supply node. "Simplest" counts
//   the recipe steps down to raw resources, which steers clear of
//   unpackaging (Unpackage Fuel needs Packaged Fuel, which needs Fuel) and
//   residue recipes when a direct one exists.
// - Resources the plan avoids (`PlanSettings.avoid`, "build this without
//   oil") are never mined anew: recipes whose chain can do without them come
//   first, in the same order, and an avoided resource the chain still needs
//   ends at a supply node, so it shows as brought in. The plan's own
//   extractors and supplies of it are what the player has, and still count.
// - Byproducts are left unconnected: they show up as spare output.
// - Recipe loops can't recurse forever: a recipe that eats an item already
//   being built further down the line is skipped, and the walk stops at
//   MAX_DEPTH with a supply node.

import type { Catalog, ItemId, Machine, Recipe, RecipeId } from '../catalog'
import { createNode, type PickOption } from './create'
import { connectPorts, portsOf } from './edit'
import { shortfall, type SolveResult } from './solve'
import type { Plan, PlanNode } from './types'

export interface BuildOptions {
  /** Fresh node ids. */
  newId: () => string
  /** Recipes the player hasn't unlocked (locked alternates). */
  isRecipeHidden?: (id: RecipeId) => boolean
  /** The player's remembered recipe per item, tried before the standard one. */
  preferred?: Readonly<Record<ItemId, RecipeId>>
  /** Connect to nodes already making an item instead of adding new ones. Default true. */
  reuse?: boolean
}

/** An input port, by node and item. */
export interface PortRef {
  node: string
  item: ItemId
  /**
   * The port has belts, but they bring too little (a byproduct loop that
   * gives back less than it takes): add a producer next to them.
   */
  topUp?: boolean
}

const MAX_DEPTH = 25
/** Where new nodes start, relative to their consumer, before layout moves them. */
const STEP = { x: 250, y: 130 }

/** Main product of a node: what reuse matches on. Generators make power, not items. */
function mainProduct(node: PlanNode, catalog: Catalog): ItemId | undefined {
  switch (node.kind) {
    case 'recipe': {
      const r = catalog.recipes.get(node.recipe)
      return r && !isGenerator(catalog, r) ? r.outputs[0]?.item : undefined
    }
    case 'extractor':
      return node.resource
    case 'supply':
      return node.item
    case 'goal':
      return undefined
  }
}

export const isGenerator = (catalog: Catalog, r: Recipe) => !!catalog.machines.get(r.machines[0])?.generation

/** Inputs with no belt yet, optionally only on one node or for one item. */
export function openInputs(plan: Plan, catalog: Catalog, only: { node?: string; item?: ItemId } = {}): PortRef[] {
  const out: PortRef[] = []
  for (const node of plan.nodes) {
    if (only.node !== undefined && node.id !== only.node) continue
    for (const item of portsOf(node, catalog)?.inputs ?? []) {
      if (only.item !== undefined && item !== only.item) continue
      if (!plan.edges.some((e) => e.target === node.id && e.item === item)) out.push({ node: node.id, item })
    }
  }
  return out
}

/**
 * Inputs that need a producer: those with no belt yet, and those whose belts
 * bring too little (see `shortfall`), optionally only on one node or for one
 * item.
 */
export function missingInputs(
  plan: Plan,
  catalog: Catalog,
  result: SolveResult,
  only: { node?: string; item?: ItemId } = {},
): PortRef[] {
  const short: PortRef[] = []
  for (const res of result.nodes.values()) {
    if (only.node !== undefined && res.id !== only.node) continue
    for (const port of res.inputs) {
      if (only.item !== undefined && port.item !== only.item) continue
      if (shortfall(port)) short.push({ node: res.id, item: port.item, topUp: true })
    }
  }
  return [...openInputs(plan, catalog, only), ...short]
}

/**
 * Recipe steps from raw resources to each item, over the recipes the player
 * can use: 0 for mined resources, 1 for anything only brought in, and for a
 * recipe 1 + the sum over its inputs. Items whose every recipe loops back on
 * itself stay at Infinity.
 */
function itemCosts(catalog: Catalog, usable: (r: Recipe) => boolean): Map<ItemId, number> {
  const cost = new Map<ItemId, number>()
  const recipes = [...catalog.recipes.values()].filter(usable)
  const made = new Set(recipes.map((r) => r.outputs[0]?.item))
  for (const id of catalog.items.keys()) cost.set(id, catalog.extractorsFor.has(id) ? 0 : made.has(id) ? Infinity : 1)
  for (let pass = 0; pass < 100; pass++) {
    let changed = false
    for (const r of recipes) {
      const item = r.outputs[0]?.item
      if (!item) continue
      const c = recipeCost(r, cost)
      if (c < cost.get(item)!) {
        cost.set(item, c)
        changed = true
      }
    }
    if (!changed) break
  }
  return cost
}

const recipeCost = (r: Recipe, cost: ReadonlyMap<ItemId, number>) => r.inputs.reduce((s, a) => s + (cost.get(a.item) ?? 1), 1)

/** The extractor new nodes use: one with its own power (not a well satellite), fastest first. */
export function bestExtractor(catalog: Catalog, item: ItemId): Machine | undefined {
  const ms = (catalog.extractorsFor.get(item) ?? []).map((id) => catalog.machines.get(id)!)
  const rank = (m: Machine) => (m.extraction?.poweredBy ? 0 : 1e9) + (m.extraction?.ratePerMin ?? 0)
  return ms.sort((a, b) => rank(b) - rank(a))[0]
}

/**
 * Raw resources the plan says not to use (`PlanSettings.avoid`), less those
 * it has its own extractor or supply for: those are what the player has.
 */
export function avoidedResources(plan: Plan, catalog: Catalog): Set<ItemId> {
  const list = Array.isArray(plan.settings.avoid) ? plan.settings.avoid : []
  const has = new Set(plan.nodes.flatMap((n) => (n.kind === 'extractor' ? [n.resource] : n.kind === 'supply' ? [n.item] : [])))
  return new Set(list.filter((item) => catalog.extractorsFor.has(item) && !has.has(item)))
}

/**
 * Items a chain can get without the avoided resources: other raw resources,
 * items no usable recipe makes (they come from supply nodes), and the main
 * products of recipes whose inputs can all be had.
 */
function obtainable(catalog: Catalog, usable: (r: Recipe) => boolean, avoid: ReadonlySet<ItemId>): Set<ItemId> {
  const recipes = [...catalog.recipes.values()].filter(usable)
  const made = new Set(recipes.map((r) => r.outputs[0]?.item))
  const got = new Set([...catalog.items.keys()].filter((id) => (catalog.extractorsFor.has(id) ? !avoid.has(id) : !made.has(id))))
  for (let changed = true; changed; ) {
    changed = false
    for (const r of recipes) {
      const item = r.outputs[0]?.item
      if (item && !got.has(item) && r.inputs.every((a) => got.has(a.item))) {
        got.add(item)
        changed = true
      }
    }
  }
  return got
}

export interface ChooseOptions extends Pick<BuildOptions, 'isRecipeHidden' | 'preferred'> {
  /** Items being built further down the line; recipes eating them would loop. */
  path?: ReadonlySet<ItemId>
  /** Raw resources not to mine (`avoidedResources`). */
  avoid?: ReadonlySet<ItemId>
  /** Precomputed `itemCosts`, reused across calls in one build. */
  costs?: ReadonlyMap<ItemId, number>
  /** Precomputed `obtainable` for `avoid`, reused across calls in one build. */
  clean?: ReadonlySet<ItemId>
}

/**
 * What a new node making `item` should be: an extractor for raw resources
 * (a supply node if the resource is avoided), else the player's remembered
 * recipe, the simplest standard recipe whose main product is the item, the
 * simplest unlocked alternate, or a supply node. With resources to avoid,
 * recipes that can do without them go first, in that same order.
 */
export function chooseProducer(catalog: Catalog, item: ItemId, opts: ChooseOptions = {}): PickOption | undefined {
  const it = catalog.items.get(item)
  if (!it) return undefined
  const machine = bestExtractor(catalog, item)
  if (machine) return opts.avoid?.has(item) ? { kind: 'supply', item: it } : { kind: 'extractor', machine, resource: it }

  const usable = (r: Recipe) => !isGenerator(catalog, r) && !opts.isRecipeHidden?.(r.id)
  const costs = opts.costs ?? itemCosts(catalog, usable)
  const fits = (r: Recipe | undefined): r is Recipe =>
    !!r && r.outputs[0]?.item === item && usable(r) && r.inputs.every((a) => a.item !== item && !opts.path?.has(a.item))

  const preferred = catalog.recipes.get(opts.preferred?.[item] ?? '')
  const candidates = (catalog.recipesProducing.get(item) ?? []).map((id) => catalog.recipes.get(id)).filter(fits)
  // Stable sort: equally simple recipes keep the catalog's order.
  const simplest = (rs: Recipe[]) => [...rs].sort((a, b) => recipeCost(a, costs) - recipeCost(b, costs))[0]
  const clean = opts.avoid?.size ? (opts.clean ?? obtainable(catalog, usable, opts.avoid)) : undefined
  const tiers: ((r: Recipe) => boolean)[] = [...(clean ? [(r: Recipe) => r.inputs.every((a) => clean.has(a.item))] : []), () => true]
  for (const ok of tiers) {
    if (fits(preferred) && ok(preferred)) return { kind: 'recipe', recipe: preferred }
    const rs = candidates.filter(ok)
    const recipe = simplest(rs.filter((r) => !r.alternate)) ?? simplest(rs.filter((r) => r.alternate))
    if (recipe) return { kind: 'recipe', recipe }
  }
  return { kind: 'supply', item: it }
}

/** Nodes reachable from `id` along belts (its consumers, theirs, …), including itself. */
function downstreamOf(plan: Plan, id: string): Set<string> {
  const seen = new Set([id])
  const queue = [id]
  while (queue.length) {
    const cur = queue.pop()!
    for (const e of plan.edges) {
      if (e.source === cur && !seen.has(e.target)) {
        seen.add(e.target)
        queue.push(e.target)
      }
    }
  }
  return seen
}

/**
 * Give every port in `start` a producer, and those producers theirs, down to
 * raw resources. Ports that already have a belt are left alone, so building
 * twice adds nothing, unless they are marked `topUp`.
 */
export function buildUpstream(
  plan: Plan,
  catalog: Catalog,
  start: PortRef[],
  opts: BuildOptions,
): { plan: Plan; added: string[] } {
  const reuse = opts.reuse ?? true
  const usable = (r: Recipe) => !isGenerator(catalog, r) && !opts.isRecipeHidden?.(r.id)
  const costs = itemCosts(catalog, usable)
  const avoid = avoidedResources(plan, catalog)
  const clean = avoid.size ? obtainable(catalog, usable, avoid) : undefined
  let p = plan
  const added: string[] = []

  const reusable = (item: ItemId, consumer: string): string | undefined => {
    const below = downstreamOf(p, consumer)
    const feeding = new Set(p.edges.filter((e) => e.target === consumer && e.item === item).map((e) => e.source))
    return p.nodes.find(
      (n) =>
        !below.has(n.id) &&
        !feeding.has(n.id) &&
        mainProduct(n, catalog) === item &&
        (n.kind !== 'recipe' || !n.limited),
    )?.id
  }

  const fillNode = (id: string, path: ReadonlySet<ItemId>, depth: number) => {
    for (const { item } of openInputs(p, catalog, { node: id })) fill(id, item, path, depth)
  }

  const fill = (consumer: string, item: ItemId, path: ReadonlySet<ItemId>, depth: number, topUp = false) => {
    if (!topUp && p.edges.some((e) => e.target === consumer && e.item === item)) return
    const existing = reuse ? reusable(item, consumer) : undefined
    if (existing) {
      p = connectPorts(p, catalog, existing, item, 'out', consumer)
      // A reused node may be missing inputs of its own; the chain runs through it now.
      fillNode(existing, new Set([...path, item]), depth + 1)
      return
    }
    const option =
      depth >= MAX_DEPTH
        ? catalog.items.has(item) && ({ kind: 'supply', item: catalog.items.get(item)! } as const)
        : chooseProducer(catalog, item, { ...opts, costs, path, avoid, clean })
    if (!option) return
    const at = p.nodes.find((n) => n.id === consumer)!.position
    const siblings = p.edges.filter((e) => e.target === consumer).length
    const node = createNode(option, opts.newId(), { x: at.x - STEP.x, y: at.y + siblings * STEP.y }, 'producer', catalog)
    p = connectPorts({ ...p, nodes: [...p.nodes, node] }, catalog, node.id, item, 'out', consumer)
    added.push(node.id)
    fillNode(node.id, new Set([...path, item]), depth + 1)
  }

  for (const { node, item, topUp } of start) {
    if (p.nodes.some((n) => n.id === node)) fill(node, item, new Set(), 0, topUp)
  }
  return { plan: p, added }
}
