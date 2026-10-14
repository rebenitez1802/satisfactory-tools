// Optimize (roadmap #6): pick the recipes for a plan with a linear program,
// then rebuild the plan's machine groups around them. The optimizer only
// chooses the structure; `solvePlan` stays the source of truth for rates.
//
// What stays and what is rebuilt:
// - Goals, extractors, supplies, generators and ⛔ limited machine groups are
//   kept: they are what the player wants or has. Flexible machine groups are
//   replaced by one group per recipe the program picks, belts are drawn anew,
//   and new extractors (or supplies, for items nothing makes) are added for
//   what the kept sources don't cover.
// - A raw resource the plan already has an extractor or supply for comes
//   only from those, as ⚡ Build chain reuses them. Otherwise new extractors
//   may take up to what the map's sites give (world.ts).
//
// The program, in machines (or items/min) per group:
// - Every item: made ≥ used. Byproducts may be left over.
// - Limits cap their groups. 🎯 targets are met together, scaled down by one
//   factor if the limits can't take them all, like the solver does. Max goals
//   (and Max generators) then get the same share of what each could reach
//   alone: a first program per Max goal finds that, a second one the share.
// - Objective: fewest raw resources (each weighed by how scarce the map
//   makes it, iron = 1), least power (MW at 100% clock), or fewest buildings.
//   A small second term breaks ties (buildings, or resources), so no pointless
//   loops (package, unpackage) make it in. Fractional machines are fine.
//
// Turning the answer into belts: each item's makers are matched with its
// users, byproducts first (the solver uses a spare byproduct before other
// producers), and an input fed by several pulled producers gets shares that
// reproduce the planned flows. Two solver rules need care:
// - A group is sized by its main product. When the program runs a recipe
//   further for its byproduct (more than its main product's users take), the
//   extra goes in a second group of that recipe whose main product is left
//   unconnected: with nothing else to run for, its byproduct is pulled.
// - A spare byproduct is handed out in the solver's order, not the plan's,
//   so an input that gets one also gets a belt from a pulled producer of the
//   item, if there is one, to make up whatever the spare doesn't cover.

import type { Catalog, ItemId, Machine, RecipeId, WorldSite } from '../catalog'
import { bestExtractor, isGenerator } from './autobuild'
import { createNode, type PickOption } from './create'
import { solveLp, type LpConstraint, type LpProblem } from './lp'
import { basePowerMw, extractorRate, generatedMw, machinePowerMw, outputMultiplier } from './rates'
import type { Plan, PlanEdge, PlanNode } from './types'
import { worldCapacity, worldSites } from './world'

export type Objective = 'resources' | 'power' | 'buildings'

export interface OptimizeOptions {
  objective?: Objective
  /** Recipes the player hasn't unlocked (locked alternates): never picked. */
  isRecipeHidden?: (id: RecipeId) => boolean
  /** Fresh node ids. */
  newId: () => string
  /** Resource sites new extractors may use. Default: the plan's (`worldSites`). */
  world?: WorldSite[]
}

export interface OptimizeResult {
  /** False when there's nothing to propose; `message` says why. */
  ok: boolean
  message?: string
  /** Share of the 🎯 targets the limits allow (1: all of them). */
  scale: number
  /** The proposed plan (the input plan when not ok). New nodes still need a layout. */
  plan: Plan
  added: string[]
  removed: string[]
}

const EPS = 1e-6
/** Weight of an item nothing makes and no extractor mines (leaves, mycelia…): only if there's no other way. */
const IMPORT_WEIGHT = 1000
/** Weight of resources with no limit (water from Water Extractors), against the most common ore. */
const UNLIMITED_WEIGHT = 0.1
/** Weight of the second objective, which only breaks ties. */
const TIE = 1e-3

/** A variable of the program: a kept node, or a node it may add. */
interface Column {
  /** Kept plan node. */
  node?: PlanNode
  /** What a new node would be. */
  make?: PickOption
  inputs: Map<ItemId, number>
  outputs: Map<ItemId, number>
  /** Outputs it isn't run for (a recipe's extra outputs, a generator's waste). */
  byproducts: Set<ItemId>
  /** Upper bound from a limit. */
  cap?: number
  /** Upper bound from the map's sites. */
  worldCap?: number
  /** Goals and generators with a power target: a fixed activity, or Max. */
  anchor?: number | 'max'
  cost: Record<Objective, number>
  /** Kept recipe nodes may not be split. */
  recipe?: boolean
}

const NO_COST: Record<Objective, number> = { resources: 0, power: 0, buildings: 0 }

/** Raw resources weighed by scarcity: the most common capped one is 1, unlimited ones a tenth of that. */
function resourceWeights(catalog: Catalog, sites: WorldSite[]): (item: ItemId) => number {
  const caps = new Map<ItemId, number | undefined>()
  for (const item of catalog.extractorsFor.keys()) caps.set(item, worldCapacity(catalog, sites, item))
  const ref = Math.max(0, ...[...caps.values()].map((c) => c ?? 0))
  return (item) => {
    if (!caps.has(item)) return IMPORT_WEIGHT
    const cap = caps.get(item)
    if (cap === undefined) return UNLIMITED_WEIGHT
    return ref > 0 && cap > 0 ? ref / cap : 1
  }
}

/** Per-unit cost of a source of `item` with `machine` making `rate` per unit of activity at 100%. */
function extractionCost(catalog: Catalog, weight: number, machine: Machine | undefined, rate: number): Record<Objective, number> {
  if (!machine || rate <= 0) return { ...NO_COST, resources: weight }
  const by = machine.extraction?.poweredBy ? catalog.machines.get(machine.extraction.poweredBy) : undefined
  return {
    resources: weight,
    power: (machinePowerMw(machine, 1) + (by ? machinePowerMw(by, 1) : 0)) / rate,
    buildings: 1 / rate,
  }
}

function keptColumn(node: PlanNode, catalog: Catalog, weight: (item: ItemId) => number): Column | undefined {
  switch (node.kind) {
    case 'recipe': {
      const recipe = catalog.recipes.get(node.recipe)
      const machine = catalog.machines.get(node.machine)
      if (!recipe || !machine) return undefined
      const perMachine = (60 / recipe.durationSec) * machine.speed
      const boost = outputMultiplier(machine, node.sloops)
      const gen = machine.generation
      const mwPerUnit = gen ? generatedMw(machine, 1) : 0
      const amp = machine.amplifier && node.sloops > 0 ? (1 + Math.min(node.sloops, machine.amplifier.slots) / machine.amplifier.slots) ** machine.amplifier.powerExponent : 1
      return {
        node,
        inputs: new Map(recipe.inputs.map((a) => [a.item, a.amount * perMachine])),
        outputs: new Map(recipe.outputs.map((a) => [a.item, a.amount * perMachine * boost])),
        byproducts: new Set((gen ? recipe.outputs : recipe.outputs.slice(1)).map((a) => a.item)),
        cap: node.limited ? node.count * node.clock : undefined,
        anchor: !mwPerUnit || node.power === undefined ? undefined : node.power === 'max' ? 'max' : Math.max(0, node.power) / mwPerUnit,
        cost: { resources: 0, power: basePowerMw(machine, recipe) * amp, buildings: 1 },
        recipe: true,
      }
    }
    case 'extractor': {
      const machine = catalog.machines.get(node.machine)
      if (!machine?.extraction || !catalog.items.has(node.resource)) return undefined
      const sites = node.sites.reduce((s, x) => s + x.count, 0)
      const one = sites > 0 ? node.sites : [{ purity: '', count: 1 }]
      const perExtractor = extractorRate(machine, { ...node, sites: one, clock: 1 }, catalog.purities) / Math.max(1, sites)
      return {
        node,
        inputs: new Map(),
        outputs: new Map([[node.resource, 1]]),
        byproducts: new Set(),
        cap: node.limited ? extractorRate(machine, node, catalog.purities) : undefined,
        cost: extractionCost(catalog, weight(node.resource), machine, perExtractor),
      }
    }
    case 'supply': {
      if (!catalog.items.has(node.item)) return undefined
      // What arrives from outside is what the player has: free, unless it's a raw resource.
      const raw = catalog.extractorsFor.has(node.item)
      return {
        node,
        inputs: new Map(),
        outputs: new Map([[node.item, 1]]),
        byproducts: new Set(),
        cap: node.limited ? node.perMin : undefined,
        cost: { ...NO_COST, resources: raw ? weight(node.item) : EPS },
      }
    }
    case 'goal':
      if (!catalog.items.has(node.item)) return undefined
      return {
        node,
        inputs: new Map([[node.item, 1]]),
        outputs: new Map(),
        byproducts: new Set(),
        anchor: node.target === 'max' ? 'max' : Math.max(0, node.target),
        cost: NO_COST,
      }
  }
}

/** Flexible machine groups that aren't generators: what the optimizer replaces. */
function replaceable(node: PlanNode, catalog: Catalog): boolean {
  if (node.kind !== 'recipe' || node.limited) return false
  const recipe = catalog.recipes.get(node.recipe)
  return !!recipe && !!catalog.machines.get(node.machine) && !isGenerator(catalog, recipe)
}

export function optimize(plan: Plan, catalog: Catalog, opts: OptimizeOptions): OptimizeResult {
  const objective = opts.objective ?? 'resources'
  const sites = opts.world ?? worldSites(plan, catalog)
  const weight = resourceWeights(catalog, sites)
  const fail = (message: string): OptimizeResult => ({ ok: false, message, scale: 0, plan, added: [], removed: [] })

  // Kept nodes, and the recipes the program may use.
  const removed = plan.nodes.filter((n) => replaceable(n, catalog)).map((n) => n.id)
  const gone = new Set(removed)
  const kept: Column[] = []
  for (const n of plan.nodes) {
    if (gone.has(n.id)) continue
    const c = keptColumn(n, catalog, weight)
    if (!c) continue
    // A flexible extractor group grows as needed, but only onto the sites the map has.
    const site = n.kind === 'extractor' && !n.limited ? catalog.machines.get(n.machine)?.extraction?.site : undefined
    if (n.kind === 'extractor' && site && sites.length) c.worldCap = worldCapacity(catalog, sites, n.resource, site)
    kept.push(c)
  }
  if (!kept.some((c) => c.anchor !== undefined)) {
    return fail('Add a goal (🎯 + Goal) or a generator with a power target first: the optimizer picks the recipes to make it.')
  }
  // Raw resources are mined, never made (as ⚡ Build chain does): the
  // Converter's ore recipes and unpackaging water or oil are left out, so a
  // ⛔ limit on iron ore means what it says.
  const recipes = [...catalog.recipes.values()].filter(
    (r) =>
      !isGenerator(catalog, r) &&
      !opts.isRecipeHidden?.(r.id) &&
      catalog.machines.has(r.machines[0]) &&
      !catalog.extractorsFor.has(r.outputs[0]?.item ?? ''),
  )

  // Items that matter: what the anchors need, and what goes into making those.
  const relevant = new Set<ItemId>()
  const need = (item: ItemId) => {
    if (relevant.has(item)) return false
    relevant.add(item)
    return true
  }
  for (const c of kept) if (c.anchor !== undefined) for (const item of c.inputs.keys()) need(item)
  for (let changed = true; changed; ) {
    changed = false
    for (const c of kept) if (c.anchor === undefined && [...c.outputs.keys()].some((i) => relevant.has(i))) for (const i of c.inputs.keys()) changed = need(i) || changed
    for (const r of recipes) if (r.outputs.some((a) => relevant.has(a.item))) for (const a of r.inputs) changed = need(a.item) || changed
  }

  const columns: Column[] = [...kept]
  for (const r of recipes) {
    if (!r.outputs.some((a) => relevant.has(a.item))) continue
    const machine = catalog.machines.get(r.machines[0])!
    const perMachine = (60 / r.durationSec) * machine.speed
    columns.push({
      make: { kind: 'recipe', recipe: r },
      inputs: new Map(r.inputs.map((a) => [a.item, a.amount * perMachine])),
      outputs: new Map(r.outputs.map((a) => [a.item, a.amount * perMachine])),
      byproducts: new Set(r.outputs.slice(1).map((a) => a.item)),
      cost: { resources: 0, power: basePowerMw(machine, r), buildings: 1 },
    })
  }
  const keptSource = new Set(kept.filter((c) => c.node!.kind === 'extractor' || c.node!.kind === 'supply').flatMap((c) => [...c.outputs.keys()]))
  const made = new Set(recipes.flatMap((r) => r.outputs.map((a) => a.item)))
  for (const item of relevant) {
    if (keptSource.has(item)) continue
    const it = catalog.items.get(item)!
    const machine = bestExtractor(catalog, item)
    if (machine) {
      const site = machine.extraction?.site
      columns.push({
        make: { kind: 'extractor', machine, resource: it },
        inputs: new Map(),
        outputs: new Map([[item, 1]]),
        byproducts: new Set(),
        worldCap: site && sites.length ? worldCapacity(catalog, sites, item, site) : undefined,
        cost: extractionCost(catalog, weight(item), machine, machine.extraction!.ratePerMin),
      })
    } else if (!made.has(item)) {
      columns.push({ make: { kind: 'supply', item: it }, inputs: new Map(), outputs: new Map([[item, 1]]), byproducts: new Set(), cost: { ...NO_COST, resources: IMPORT_WEIGHT } })
    }
  }

  // The programs. Column j is variable j; `extra` adds one more (the scale or share).
  const items = [...relevant]
  const anchors = columns.map((c, j) => ({ c, j })).filter(({ c }) => c.anchor !== undefined)
  const targets = anchors.filter(({ c }) => c.anchor !== 'max')
  const maxes = anchors.filter(({ c }) => c.anchor === 'max')
  const extra = columns.length
  const program = (o: {
    objective: number[]
    /** Numeric targets: × this scale, or × the extra variable. */
    scale: number | 'var'
    /** Max anchors: fixed at least to these values; others 0 unless `free`. */
    maxAt?: Map<number, number>
    free?: Set<number>
    /** Max anchors ≥ extra × these. */
    share?: Map<number, number>
    world: boolean
  }): LpProblem => {
    const constraints: LpConstraint[] = []
    for (const item of items) {
      const terms: [number, number][] = []
      columns.forEach((c, j) => {
        const net = (c.outputs.get(item) ?? 0) - (c.inputs.get(item) ?? 0)
        if (net) terms.push([j, net])
      })
      constraints.push({ terms, op: '>=', rhs: 0 })
    }
    columns.forEach((c, j) => {
      if (c.cap !== undefined) constraints.push({ terms: [[j, 1]], op: '<=', rhs: c.cap })
      if (o.world && c.worldCap !== undefined) constraints.push({ terms: [[j, 1]], op: '<=', rhs: c.worldCap })
    })
    for (const { c, j } of targets) {
      const a = c.anchor as number
      if (o.scale === 'var') constraints.push({ terms: [[j, 1], [extra, -a]], op: '=', rhs: 0 })
      else constraints.push({ terms: [[j, 1]], op: '=', rhs: a * o.scale })
    }
    for (const { j } of maxes) {
      if (o.free?.has(j)) continue
      if (o.share?.has(j)) constraints.push({ terms: [[j, 1], [extra, -o.share.get(j)!]], op: '>=', rhs: 0 })
      else if (o.maxAt?.has(j)) constraints.push({ terms: [[j, 1]], op: '>=', rhs: o.maxAt.get(j)! })
      else constraints.push({ terms: [[j, 1]], op: '<=', rhs: 0 })
    }
    if (o.scale === 'var') constraints.push({ terms: [[extra, 1]], op: '<=', rhs: 1 })
    if (o.share) constraints.push({ terms: [[extra, 1]], op: '<=', rhs: 1 })
    return { vars: extra + 1, objective: o.objective, constraints }
  }
  const maximize = (j: number) => Object.assign(new Array<number>(extra + 1).fill(0), { [j]: -1 })
  const name = (c: Column) => {
    const n = c.node!
    if (n.kind === 'goal') return catalog.items.get(n.item)?.name ?? n.item
    return n.kind === 'recipe' ? (catalog.recipes.get(n.recipe)?.name ?? n.recipe) : n.id
  }

  // 1. How much of the 🎯 targets the limits allow.
  let scale = 1
  if (targets.length) {
    const r = solveLp(program({ objective: maximize(extra), scale: 'var', world: true }))
    if (r.status !== 'optimal' || r.x[extra] <= EPS) {
      return fail(
        r.status === 'optimal' || r.status === 'infeasible'
          ? 'The limits (and the map) leave nothing to make the 🎯 targets with. Raise a limit, or remove it.'
          : 'The program could not be solved.',
      )
    }
    scale = Math.min(1, r.x[extra]) * (1 - 1e-9)
  }

  // 2. Max goals: what each could reach alone, then the same share of that for all.
  const maxAt = new Map<number, number>()
  if (maxes.length) {
    const best = new Map<number, number>()
    for (const { c, j } of maxes) {
      const free = new Set([j])
      const loose = solveLp(program({ objective: maximize(j), scale, free, world: false }))
      if (loose.status === 'unbounded') {
        return fail(`${name(c)}: a Max ${c.node!.kind === 'goal' ? 'goal' : 'generator'} needs a limit upstream. Set a ⛔ limit on a source or machine group, or give it a 🎯 target.`)
      }
      const r = solveLp(program({ objective: maximize(j), scale, free, world: true }))
      best.set(j, r.status === 'optimal' ? r.x[j] : 0)
    }
    let share = 1
    if (maxes.length > 1) {
      const weights = new Map([...best].filter(([, v]) => v > EPS))
      const r = solveLp(program({ objective: maximize(extra), scale, share: weights, world: true }))
      share = r.status === 'optimal' ? Math.min(1, r.x[extra]) : 0
    }
    for (const [j, v] of best) maxAt.set(j, v * share * (1 - 1e-9))
    if (!targets.length && [...maxAt.values()].every((v) => v <= EPS)) {
      return fail('The limits (and the map) leave nothing for the Max goals. Raise a limit, or remove it.')
    }
  }

  // 3. The cheapest way to make all that.
  const tie: Record<Objective, Objective> = { resources: 'buildings', power: 'resources', buildings: 'resources' }
  const cost = columns.map((c) => c.cost[objective] + TIE * c.cost[tie[objective]])
  const final = solveLp(program({ objective: [...cost, 0], scale, maxAt, world: true }))
  if (final.status !== 'optimal') return fail('The program could not be solved.')
  const built = buildPlan(plan, catalog, columns, final.x.slice(0, extra), gone, opts.newId)
  return {
    ok: true,
    scale: targets.length ? Math.min(1, scale / (1 - 1e-9)) : 1,
    message: scale < 1 - 1e-6 ? `The limits allow ${Math.round(scale * 100)}% of the 🎯 targets; the plan is built for that.` : undefined,
    plan: built.plan,
    added: built.added,
    removed,
  }
}

/** A node of the new plan with its activity, as a producer and consumer of items. */
interface Group {
  id: string
  col: Column
  activity: number
}

function buildPlan(plan: Plan, catalog: Catalog, columns: Column[], x: number[], gone: Set<string>, newId: () => string) {
  const scale = Math.max(1, ...x)
  const tol = EPS * scale
  const groups: Group[] = []
  const added: string[] = []
  const nodes: PlanNode[] = plan.nodes.filter((n) => !gone.has(n.id))
  const keptIds = new Set(nodes.map((n) => n.id))
  let slot = 0
  const addNode = (col: Column, activity: number): Group => {
    const id = newId()
    const at = { x: -260 * (1 + (slot % 6)), y: 140 * Math.floor(slot++ / 6) }
    nodes.push(createNode(col.make!, id, at, 'producer', catalog))
    added.push(id)
    const g = { id, col, activity }
    groups.push(g)
    return g
  }
  columns.forEach((col, j) => {
    if (col.node) groups.push({ id: col.node.id, col, activity: x[j] })
    else if (x[j] > tol) addNode(col, x[j])
  })

  // Flows per item: byproduct makers first, then main producers; users in plan order.
  type Flow = { from: Group; to: Group; item: ItemId; perMin: number }
  const flows: Flow[] = []
  const route = (item: ItemId, makers: { g: Group; amount: number }[], users: { g: Group; amount: number }[]) => {
    let m = 0
    let left = makers[0]?.amount ?? 0
    for (const u of users) {
      let want = u.amount
      while (want > tol && m < makers.length) {
        const f = Math.min(want, left)
        if (f > tol && makers[m].g !== u.g) flows.push({ from: makers[m].g, to: u.g, item, perMin: f })
        want -= f
        left -= f
        if (left <= tol) left = makers[++m]?.amount ?? 0
      }
    }
  }
  const itemsUsed = new Set(groups.flatMap((g) => [...g.col.inputs.keys()]))
  for (const item of itemsUsed) {
    const users = groups.filter((g) => g.activity > tol && g.col.inputs.has(item)).map((g) => ({ g, amount: g.activity * g.col.inputs.get(item)! }))
    const makers = groups
      .filter((g) => g.activity > tol && g.col.outputs.has(item))
      .map((g) => ({ g, amount: g.activity * g.col.outputs.get(item)!, by: g.col.byproducts.has(item) }))
      .sort((a, b) => Number(b.by) - Number(a.by))
    route(item, makers, users)
  }

  // A recipe run further than its main product's users take, for its
  // byproduct: the extra becomes a second group whose main product stays
  // unconnected, so the solver pulls its byproduct.
  const mainOf = (g: Group) => (g.col.recipe || g.col.make?.kind === 'recipe' ? g.col.outputs.keys().next().value : undefined)
  for (const g of [...groups]) {
    const main = mainOf(g)
    if (!main || g.col.node || !g.col.byproducts.size) continue
    const routed = flows.filter((f) => f.from === g && f.item === main).reduce((s, f) => s + f.perMin, 0)
    const byFlows = flows.filter((f) => f.from === g && g.col.byproducts.has(f.item))
    const made = g.activity * g.col.outputs.get(main)!
    if (made - routed <= tol * 10 || !byFlows.length) continue
    const keep = routed / g.col.outputs.get(main)!
    const extra: Group = keep > tol ? addNode(g.col, g.activity - keep) : g
    if (extra === g) continue
    // Inputs are shared out in proportion.
    for (const f of flows.filter((f) => f.to === g)) {
      const share = f.perMin * (1 - keep / g.activity)
      flows.push({ from: f.from, to: extra, item: f.item, perMin: share })
      f.perMin -= share
    }
    g.activity = keep
    // The first group's byproduct goes first, the extra group's makes up the rest.
    for (const item of g.col.byproducts) {
      let left = keep * g.col.outputs.get(item)!
      for (const f of flows.filter((f) => f.from === g && f.item === item)) {
        const stay = Math.min(f.perMin, Math.max(0, left))
        left -= stay
        if (stay < f.perMin - tol) flows.push({ from: extra, to: f.to, item, perMin: f.perMin - stay })
        f.perMin = stay
      }
    }
  }

  // Inputs fed by a spare byproduct also get a pulled producer, if there is one.
  const spare = (f: Flow) =>
    f.from.col.byproducts.has(f.item) &&
    (f.from.col.anchor !== undefined || flows.some((o) => o.from === f.from && !f.from.col.byproducts.has(o.item) && o.perMin > tol))
  const live = flows.filter((f) => f.perMin > tol)
  for (const item of itemsUsed) {
    const pulledMakers = groups.filter((g) => g.activity > tol && g.col.outputs.has(item) && !live.some((f) => f.from === g && f.item === item && spare(f)))
    if (!pulledMakers.length) continue
    const biggest = pulledMakers.reduce((a, b) => (b.activity * b.col.outputs.get(item)! > a.activity * a.col.outputs.get(item)! ? b : a))
    for (const to of new Set(live.filter((f) => f.item === item && spare(f)).map((f) => f.to))) {
      if (!live.some((f) => f.to === to && f.item === item && !spare(f)) && biggest !== to) live.push({ from: biggest, to, item, perMin: 0 })
    }
  }

  // Belts, one per producer and user of an item; shares where several pulled producers feed one input.
  const edges = new Map<string, PlanEdge & { perMin: number; pulled: boolean }>()
  for (const f of live) {
    const id = `${f.from.id}->${f.to.id}:${f.item}`
    const e = edges.get(id)
    if (e) e.perMin += f.perMin
    else edges.set(id, { id, source: f.from.id, target: f.to.id, item: f.item, perMin: f.perMin, pulled: !spare(f) })
  }
  const byInput = new Map<string, (PlanEdge & { perMin: number; pulled: boolean })[]>()
  for (const e of edges.values()) {
    if (!e.pulled) continue
    const k = `${e.target}\u0000${e.item}`
    byInput.set(k, [...(byInput.get(k) ?? []), e])
  }
  for (const list of byInput.values()) {
    if (list.length < 2) continue
    // The planned flow per minute, unrounded: a rounded share would leave a
    // byproduct loop a hair short.
    for (const e of list) e.share = Math.max(e.perMin, tol)
  }
  // Belts to and from nodes the optimizer can't read (content not loaded) stay.
  const unread = new Set([...keptIds].filter((id) => !groups.some((g) => g.id === id)))
  const unknown = plan.edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target) && (unread.has(e.source) || unread.has(e.target)))
  const planEdges: PlanEdge[] = [...unknown, ...[...edges.values()].map(({ perMin: _, pulled: __, ...e }) => e)]
  return { plan: { ...plan, nodes, edges: planEdges }, added }
}
