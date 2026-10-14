// Plan solver: targets and limits (see docs/production-planner.md).
//
// Every node has an *activity*: machines-at-100% for recipe nodes, items/min
// for extractors, supplies and goals. Its port rates are activity × a fixed
// per-unit rate, so the whole plan is driven by demand flowing upstream from
// its anchors: goals, and generator groups with a power target:
//
//   1. Demand pass with the numeric targets. In each connected chain, if a
//      limited node would exceed its limit, scale that chain's targets by the
//      tightest ratio: that limit is the bottleneck.
//   2. Max goals get whatever the limits have left: a second demand pass with
//      each Max goal at 1/min tells how much of every limit a unit costs.
//   3. A final demand pass with the settled goal values gives every rate.
//
// A node with several outputs is sized by its most-demanded one, so a demand
// pass is positively homogeneous but not linear. That makes step 2
// conservative (never over a limit), not always exactly tight. Loops in the
// graph are handled by iterating the demand pass until it settles.
//
// Byproducts break the pull model: a refinery making plastic for a goal
// shouldn't grow because something downstream wants more of its heavy oil
// residue, and a chain fed only by that residue has no demand at all. So the
// plan is solved in *stages*. Belts carrying a byproduct (a recipe's second
// output, or a generator's waste) are cut where the maker's main products
// lead to an anchor. Stages are solved producers first, and each cut belt
// arrives in the next stage as a limited supply of what the maker has spare,
// used before any other producer of that item. Open ends then fill the
// downstream chain from it. A byproduct whose maker has nothing else to run
// for is still pulled like a main product. Stages can share nodes upstream
// (one Water Extractor for the reactors and their waste chain): a later stage
// adds its demand to theirs and gets what is left of their limits.
//
// A byproduct belt that loops back into its maker's own chain (aluminum
// scrap's water piped to the Alumina Solution that feeds it) can't be cut
// into a later stage, but pulling it makes the loop run away: more water
// wanted, more scrap made, more alumina needed, more water wanted. So it
// stays in the stage as a *spare* belt: it doesn't pull, it carries what the
// maker makes, used first, and the other producers make up the rest. When
// nothing else feeds that input, the rest is reported as missing, like an
// unconnected input. With spare belts left out, the pulled part of the loop
// is acyclic, so the demand pass settles in a couple of rounds.

import type { Catalog, Item, ItemId, Machine, MachineId, Recipe, TransportTierId } from '../catalog'
import {
  extractorPowerMw,
  extractorRate,
  generatedMw,
  groupPowerMw,
  machinePowerMw,
  machineSetup,
  outputMultiplier,
  shardsNeeded,
} from './rates'
import type { ItemRate, MachineSetup } from './rates'
import type { Plan, PlanEdge, PlanNode, SupplyNode } from './types'

const EPS = 1e-9
const MAX_ITER = 1000

export interface InputPort {
  item: ItemId
  /** What the node consumes. */
  needed: number
  /**
   * What its incoming edges deliver (0 when unconnected). Less than needed
   * only when spare belts are all that feed it (see `shortfall`).
   */
  supplied: number
  connected: boolean
}

/**
 * What a connected input lacks: its belts are all spare byproducts looping
 * back, and they bring less than it needs. 0 otherwise.
 */
export function shortfall(port: InputPort): number {
  const short = port.needed - port.supplied
  return port.connected && short > EPS * Math.max(1, port.needed) ? short : 0
}

export interface OutputPort {
  item: ItemId
  produced: number
  /** What its outgoing edges carry away. */
  used: number
  connected: boolean
}

export interface NodeResult {
  id: string
  /** False when the node references content missing from the catalog. */
  resolved: boolean
  /** Machines at 100% (recipe nodes) or items/min (other nodes). */
  activity: number
  inputs: InputPort[]
  outputs: OutputPort[]
  /**
   * Recipe nodes, and flexible extractor nodes: machines (one per resource
   * node) and clock as they'd be built.
   */
  setup?: MachineSetup
  /** Limited extractor nodes: the clock the extractors actually need to run at. */
  clock?: number
  /**
   * Buildings the node needs, by machine, counted as in `totals.machines`
   * (fractional in fractional mode). The node's own machine comes first; a
   * resource well's pressurizer follows its satellites. Absent: none.
   */
  buildings?: { machine: MachineId; count: number }[]
  /**
   * Power shards and Somersloops in each machine (or extractor) as built, and
   * how many are built (whole). Totals are `each × built`. Absent when the
   * group builds nothing.
   */
  upgrades?: { shardsEach: number; sloopsEach: number; built: number }
  /** Power drawn, in MW. */
  powerMw: number
  /** Generators: power made, in MW. */
  generatedMw?: number
  /** Limited nodes: the limit, in activity units. */
  limit?: number
  /**
   * Sources (extractors, limited supplies): what they can put out as
   * configured, whether or not anything downstream uses it yet.
   */
  capacity?: number
  /** activity / limit for limited nodes. */
  utilization?: number
  bottleneck: boolean
}

export interface GoalResult {
  id: string
  /** The goal's item; for a generator, its fuel. */
  item: ItemId
  /** Items/min, or MW for a generator group (`power`). */
  requested: number | 'max'
  achieved: number
  /** A generator group's power target rather than an item goal. */
  power?: boolean
  /**
   * Set for an open end treated as a Max goal: the node whose unconnected
   * output it is. `id` is then not a plan node.
   */
  openEndOf?: string
}

export interface EdgeResult {
  perMin: number
  /**
   * With a belt or pipe tier set: that tier and how many of them the flow
   * needs side by side. An edge joins two machine groups, so it can be
   * several belts, as long as each machine fits on one (see tooFast).
   */
  belts?: { tier: TransportTierId; count: number }
  /**
   * Set instead of `belts` when one machine at either end makes or takes
   * more than a single belt or pipe of the tier carries. A machine puts out
   * (or takes in) an item through one port, so no number of slower belts
   * can carry it: the edge can't be built on that tier.
   */
  tooFast?: {
    /** What that one machine makes or takes, per minute. */
    perMin: number
    /** The producing ('out') or consuming ('in') end. */
    end: 'out' | 'in'
    /** The slowest tier of the same kind that carries it; unset if none does. */
    needs?: TransportTierId
  }
}

/** An output port feeding several edges: a candidate for a load balancer. */
export interface Split {
  node: string
  item: ItemId
  produced: number
  edges: { id: string; perMin: number }[]
  /** Produced but not carried away by any edge. */
  leftover: number
}

/** An input port fed by several edges. */
export interface Merge {
  node: string
  item: ItemId
  edges: { id: string; perMin: number }[]
}

export interface PlanTotals {
  /** Power drawn by machines, in MW. */
  powerMw: number
  /** Power made by generators, in MW. Net power is generatedMw − powerMw. */
  generatedMw: number
  /** Machines per type, as counted by the plan's machine mode. */
  machines: Map<MachineId, number>
  shards: number
  sloops: number
  /** Extracted or supplied into the plan. */
  rawResources: ItemRate[]
  /** Delivered to goals. */
  delivered: ItemRate[]
  /** Produced but not used by any edge. */
  surplus: ItemRate[]
  /** Needed by unconnected inputs: things to bring in. */
  missingInputs: ItemRate[]
}

export interface PlanDiagnostic {
  severity: 'error' | 'warning' | 'info'
  message: string
  nodeId?: string
  edgeId?: string
}

export interface SolveResult {
  nodes: Map<string, NodeResult>
  edges: Map<string, EdgeResult>
  goals: GoalResult[]
  splits: Split[]
  merges: Merge[]
  totals: PlanTotals
  diagnostics: PlanDiagnostic[]
}

/** Per-unit-of-activity port rates of a node, plus its limit. */
interface Unit {
  inputs: Map<ItemId, number>
  outputs: Map<ItemId, number>
  limit?: number
  recipe?: Recipe
  machine?: Machine
  /** Limited extractors: output of the configured sites at the configured clock. */
  configured?: number
  /**
   * Flexible extractors: output of one at 100% on one site. They are sized
   * like machines, more sites at the preferred clock, instead of overclocking
   * the configured ones.
   */
  perExtractor?: number
  /** Outputs the node isn't run for: a recipe's extra outputs, a generator's waste. */
  byproducts: Set<ItemId>
  /**
   * Goals and generators with a power target: the activity is set (a number,
   * in activity units) or as high as the limits allow, not derived.
   */
  anchor?: number | 'max'
  /** Generators: MW per unit of activity. */
  mwPerUnit?: number
  /** A byproduct arriving from an earlier stage: consumers use it first. */
  spare?: boolean
}

const key = (node: string, item: ItemId) => `${node}\u0000${item}`
const num = (v: number) => Number(v.toFixed(2))
const perMin = (item?: Item) => (item && item.form !== 'solid' ? ' m³/min' : '/min')

const NONE = new Set<ItemId>()
const SPARE = '~spare:'

function unitOf(node: PlanNode, catalog: Catalog): Unit | undefined {
  switch (node.kind) {
    case 'recipe': {
      const recipe = catalog.recipes.get(node.recipe)
      const machine = catalog.machines.get(node.machine)
      if (!recipe || !machine) return undefined
      const perMachine = (60 / recipe.durationSec) * machine.speed
      const boost = outputMultiplier(machine, node.sloops)
      const gen = machine.generation
      const mwPerUnit = gen ? generatedMw(machine, 1) : undefined
      return {
        inputs: new Map(recipe.inputs.map((a) => [a.item, a.amount * perMachine])),
        outputs: new Map(recipe.outputs.map((a) => [a.item, a.amount * perMachine * boost])),
        limit: node.limited ? node.count * node.clock : undefined,
        recipe,
        machine,
        byproducts: new Set((gen ? recipe.outputs : recipe.outputs.slice(1)).map((a) => a.item)),
        mwPerUnit,
        anchor:
          !mwPerUnit || node.power === undefined
            ? undefined
            : node.power === 'max'
              ? 'max'
              : Math.max(0, node.power) / mwPerUnit,
      }
    }
    case 'extractor': {
      const machine = catalog.machines.get(node.machine)
      if (!machine?.extraction || !catalog.items.has(node.resource)) return undefined
      const configured = extractorRate(machine, node, catalog.purities)
      // A flexible group's sites only say which purity to count in; a mixed
      // group (saved before mixing needed a limit) counts in its average.
      const sites = node.sites.reduce((s, x) => s + x.count, 0)
      const one = sites > 0 ? node.sites : [{ purity: '', count: 1 }]
      const perExtractor = extractorRate(machine, { ...node, sites: one, clock: 1 }, catalog.purities) / Math.max(1, sites)
      return {
        inputs: new Map(),
        outputs: new Map([[node.resource, 1]]),
        limit: node.limited ? configured : undefined,
        machine,
        configured: node.limited ? configured : undefined,
        perExtractor: node.limited ? undefined : perExtractor,
        byproducts: NONE,
      }
    }
    case 'supply':
      if (!catalog.items.has(node.item)) return undefined
      return {
        inputs: new Map(),
        outputs: new Map([[node.item, 1]]),
        limit: node.limited ? node.perMin : undefined,
        byproducts: NONE,
        spare: node.id.startsWith(SPARE),
      }
    case 'goal':
      if (!catalog.items.has(node.item)) return undefined
      return {
        inputs: new Map([[node.item, 1]]),
        outputs: new Map(),
        byproducts: NONE,
        anchor: node.target === 'max' ? 'max' : Math.max(0, node.target),
      }
  }
}

interface Graph {
  nodes: PlanNode[]
  units: Map<string, Unit>
  edges: PlanEdge[]
  /** Valid edges by source port / target port. */
  out: Map<string, PlanEdge[]>
  in: Map<string, PlanEdge[]>
  /** Byproduct belts looping back into their maker's chain: they carry what's spare, not what's wanted. */
  spare: Set<string>
  /** Consumers before producers (spare belts aside), so a DAG settles in one pass. */
  order: PlanNode[]
  component: Map<string, number>
}

function pushTo<K, V>(map: Map<K, V[]>, k: K, v: V) {
  const list = map.get(k)
  if (list) list.push(v)
  else map.set(k, [v])
}

function buildGraph(plan: Plan, catalog: Catalog, diagnostics: PlanDiagnostic[], spare = new Set<string>()): Graph {
  const units = new Map<string, Unit>()
  for (const n of plan.nodes) {
    const u = unitOf(n, catalog)
    if (u) units.set(n.id, u)
    else diagnostics.push({ severity: 'warning', nodeId: n.id, message: 'Node uses content that is not loaded.' })
  }

  const edges: PlanEdge[] = []
  const out = new Map<string, PlanEdge[]>()
  const inn = new Map<string, PlanEdge[]>()
  for (const e of plan.edges) {
    const s = units.get(e.source)
    const t = units.get(e.target)
    if (!s || !t) continue
    if (!s.outputs.has(e.item) || !t.inputs.has(e.item)) {
      diagnostics.push({ severity: 'warning', edgeId: e.id, message: 'Connection does not match its ports; ignored.' })
      continue
    }
    edges.push(e)
    pushTo(out, key(e.source, e.item), e)
    pushTo(inn, key(e.target, e.item), e)
  }

  // Order: a node comes after all of its consumers (reverse topological).
  // Spare belts don't pull, so the order ignores them.
  const pulling = edges.filter((e) => !spare.has(e.id))
  const successors = new Map<string, Set<string>>(plan.nodes.map((n) => [n.id, new Set()]))
  for (const e of pulling) successors.get(e.source)!.add(e.target)
  const consumersLeft = new Map(plan.nodes.map((n) => [n.id, successors.get(n.id)!.size]))
  const predecessors = new Map<string, Set<string>>(plan.nodes.map((n) => [n.id, new Set()]))
  for (const e of pulling) predecessors.get(e.target)!.add(e.source)
  const byId = new Map(plan.nodes.map((n) => [n.id, n]))
  const order: PlanNode[] = []
  const queue = plan.nodes.filter((n) => consumersLeft.get(n.id) === 0).map((n) => n.id)
  const placed = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (placed.has(id)) continue
    placed.add(id)
    order.push(byId.get(id)!)
    for (const p of predecessors.get(id)!) {
      const left = consumersLeft.get(p)! - 1
      consumersLeft.set(p, left)
      if (left === 0) queue.push(p)
    }
  }
  for (const n of plan.nodes) if (!placed.has(n.id)) order.push(n) // nodes on loops

  // Connected components (undirected) for per-chain scaling.
  const parent = new Map(plan.nodes.map((n) => [n.id, n.id]))
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  for (const e of edges) parent.set(find(e.source), find(e.target))
  const roots = new Map<string, number>()
  const component = new Map<string, number>()
  for (const n of plan.nodes) {
    const r = find(n.id)
    if (!roots.has(r)) roots.set(r, roots.size)
    component.set(n.id, roots.get(r)!)
  }

  return { nodes: plan.nodes, units, edges, out, in: inn, spare, order, component }
}

interface Pass {
  activity: Map<string, number>
  edgeFlow: Map<string, number>
  converged: boolean
}

/** Propagate demand upstream from the given goal values. */
function demandPass(g: Graph, goalValues: Map<string, number>): Pass {
  const activity = new Map<string, number>()
  const edgeFlow = new Map<string, number>(g.edges.map((e) => [e.id, 0]))
  let converged = false
  const fromStage = (e: PlanEdge) => !!g.units.get(e.source)!.spare

  for (let iter = 0; iter < MAX_ITER && !converged; iter++) {
    let maxDelta = 0
    let scale = 1
    /** Flow handed out so far this round by each spare port. */
    const taken = new Map<string, number>()
    const take = (e: PlanEdge, f: number) => {
      edgeFlow.set(e.id, f)
      if (g.spare.has(e.id) || fromStage(e)) taken.set(key(e.source, e.item), (taken.get(key(e.source, e.item)) ?? 0) + f)
    }
    const left = (e: PlanEdge, available: number) => Math.max(0, available - (taken.get(key(e.source, e.item)) ?? 0))
    for (const n of g.order) {
      const unit = g.units.get(n.id)
      if (!unit) continue
      let a = 0
      if (unit.anchor !== undefined) a = goalValues.get(n.id) ?? 0
      else {
        for (const [item, perUnit] of unit.outputs) {
          const demand = (g.out.get(key(n.id, item)) ?? []).reduce((s, e) => (g.spare.has(e.id) ? s : s + edgeFlow.get(e.id)!), 0)
          if (perUnit > 0) a = Math.max(a, demand / perUnit)
        }
      }
      maxDelta = Math.max(maxDelta, Math.abs(a - (activity.get(n.id) ?? 0)))
      scale = Math.max(scale, a)
      activity.set(n.id, a)

      for (const [item, perUnit] of unit.inputs) {
        const feeding = g.in.get(key(n.id, item))
        if (!feeding) continue
        let need = a * perUnit
        // Spare byproducts go first: those looping back, at what their maker
        // makes this round, then those from earlier stages if other producers
        // can make up the rest. The others share what is still needed.
        for (const e of feeding) {
          if (!g.spare.has(e.id)) continue
          const src = g.units.get(e.source)!
          const f = Math.min(need, left(e, (activity.get(e.source) ?? 0) * src.outputs.get(e.item)!))
          take(e, f)
          need -= f
        }
        const rest = feeding.filter((e) => !g.spare.has(e.id) && !fromStage(e))
        const staged = feeding.filter(fromStage)
        if (rest.length) {
          for (const e of staged) {
            const f = Math.min(need, left(e, g.units.get(e.source)!.limit!))
            take(e, f)
            need -= f
          }
        }
        // A stage's lone spare supply is pulled in full, so the targets scale
        // to it. With only spare belts, what they can't bring is missing.
        const split = rest.length ? rest : staged
        const shares = split.reduce((s, e) => s + (e.share ?? 1), 0)
        for (const e of split) take(e, (need * (e.share ?? 1)) / shares)
      }
    }
    converged = maxDelta <= EPS * scale
  }
  return { activity, edgeFlow, converged }
}

const OPEN_END = '~open:'

/**
 * A chain with a limit but no goal answers "what can I make from this?": each
 * node with nothing connected downstream gets an implicit Max goal on its main
 * output, so a lone miner, or miner → smelter, shows its full output.
 */
function withOpenEnds(plan: Plan, catalog: Catalog, feeds: Set<string>): Plan {
  const g = buildGraph(plan, catalog, [])
  const feeding = new Set([...feeds, ...g.edges.map((e) => e.source)])
  const withGoal = new Set(plan.nodes.filter((n) => g.units.get(n.id)?.anchor !== undefined).map((n) => g.component.get(n.id)))
  const withLimit = new Set(plan.nodes.filter((n) => g.units.get(n.id)?.limit !== undefined).map((n) => g.component.get(n.id)))
  const nodes: PlanNode[] = []
  const edges: PlanEdge[] = []
  for (const n of plan.nodes) {
    const c = g.component.get(n.id)
    const unit = g.units.get(n.id)
    const main = unit?.outputs.keys().next().value
    if (unit?.anchor !== undefined || !main || feeding.has(n.id) || withGoal.has(c) || !withLimit.has(c)) continue
    const id = `${OPEN_END}${n.id}`
    nodes.push({ id, kind: 'goal', position: n.position, item: main, target: 'max' })
    edges.push({ id, source: n.id, target: id, item: main })
  }
  return nodes.length ? { ...plan, nodes: [...plan.nodes, ...nodes], edges: [...plan.edges, ...edges] } : plan
}

interface Stage {
  /** The nodes the stage solves: its own, and what they draw on from earlier stages. */
  nodes: string[]
  /** Nodes of earlier stages that this one draws on too (a shared extractor, say). */
  borrowed: Set<string>
}

/**
 * Cut the plan into stages (see the top of this file), in solving order.
 * `cross` are the byproduct belts that were cut, `spare` the ones that loop
 * back into their maker's chain instead (by id).
 *
 * A node's stage is how many cut belts lie on its longest way in, so a
 * byproduct's consumers always come after its maker. The stages are not
 * separate parts of the plan: a stage also takes in every node upstream of
 * its own, so a Water Extractor or a smelter line feeding both a reactor and
 * its waste chain serves both, and adds up what each asks of it.
 */
function splitStages(g: Graph): { stages: Stage[]; cross: PlanEdge[]; spare: Set<string> } {
  const ids = g.nodes.filter((n) => g.units.has(n.id)).map((n) => n.id)
  const byproduct = (e: PlanEdge) => g.units.get(e.source)!.byproducts.has(e.item)
  const reachable = (from: string[], next: Map<string, string[]>) => {
    const seen = new Set(from)
    const queue = [...from]
    while (queue.length) for (const t of next.get(queue.pop()!) ?? []) if (!seen.has(t)) seen.add(t), queue.push(t)
    return seen
  }
  const downstream = new Map<string, string[]>()
  for (const e of g.edges) pushTo(downstream, e.source, e.target)
  // A byproduct only arrives as spare when its maker has an anchor to run for
  // down its main products; otherwise the consumer's demand is what runs the
  // maker. Belts that loop back into their maker's own chain stay in its
  // stage, as spare belts.
  const feeders = new Map<string, string[]>()
  for (const e of g.edges) if (!byproduct(e)) pushTo(feeders, e.target, e.source)
  const runsFor = reachable(ids.filter((id) => g.units.get(id)!.anchor !== undefined), feeders)
  const cross: PlanEdge[] = []
  const spare = new Set<string>()
  for (const e of g.edges) {
    if (!byproduct(e) || !runsFor.has(e.source)) continue
    if (reachable([e.target], downstream).has(e.source)) spare.add(e.id)
    else cross.push(e)
  }
  const cut = new Set(cross)

  // Longest way in, counting cut belts. No loop holds a cut belt, so it settles.
  const depth = new Map(ids.map((id) => [id, 0]))
  for (let changed = true; changed; ) {
    changed = false
    for (const e of g.edges) {
      const d = depth.get(e.source)! + (cut.has(e) ? 1 : 0)
      if (d > depth.get(e.target)!) depth.set(e.target, d), (changed = true)
    }
  }
  const upstream = new Map<string, string[]>()
  for (const e of g.edges) if (!cut.has(e)) pushTo(upstream, e.target, e.source)
  const stages: Stage[] = []
  for (let k = 0; k <= Math.max(0, ...depth.values()); k++) {
    const own = ids.filter((id) => depth.get(id) === k)
    if (!own.length) continue
    const nodes = [...reachable(own, upstream)]
    stages.push({ nodes, borrowed: new Set(nodes.filter((id) => depth.get(id)! < k)) })
  }
  return { stages, cross, spare }
}

export function solvePlan(plan: Plan, catalog: Catalog): SolveResult {
  const diagnostics: PlanDiagnostic[] = []
  const whole = buildGraph(plan, catalog, diagnostics)
  const { stages, cross, spare } = splitStages(whole)

  const pass: Pass = { activity: new Map(), edgeFlow: new Map(whole.edges.map((e) => [e.id, 0])), converged: true }
  const goalValues = new Map<string, number>()
  const bottlenecks = new Set<string>()
  const openEnds: Plan = { ...plan, nodes: [], edges: [] }
  const portFlow = (node: string, item: ItemId) =>
    (whole.out.get(key(node, item)) ?? []).reduce((s, e) => s + (pass.edgeFlow.get(e.id) ?? 0), 0)
  const add = (m: Map<string, number>, id: string, v: number) => m.set(id, (m.get(id) ?? 0) + v)
  const cutEdges = new Set(cross)
  // Only nodes with nothing connected downstream, in the whole plan, are open ends.
  const feeds = new Set(whole.edges.map((e) => e.source))

  for (const { nodes: stage, borrowed } of stages) {
    const inStage = new Set(stage)
    // Byproducts from earlier stages arrive as limited supplies of what's spare.
    const spares = new Map<string, SupplyNode>()
    const makerOf = new Map<string, string>()
    const arriving: PlanEdge[] = []
    for (const e of cross) {
      if (!inStage.has(e.target)) continue
      const id = `${SPARE}${e.source}\u0000${e.item}`
      if (!spares.has(id)) {
        const produced = (pass.activity.get(e.source) ?? 0) * whole.units.get(e.source)!.outputs.get(e.item)!
        const perMin = Math.max(0, produced - portFlow(e.source, e.item))
        spares.set(id, { id, kind: 'supply', position: { x: 0, y: 0 }, item: e.item, limited: true, perMin })
        makerOf.set(id, e.source)
      }
      arriving.push({ ...e, source: id })
    }
    // A node borrowed from an earlier stage runs for this one on top of what
    // it already does: a limit only has its room left, and an anchor was
    // already met there.
    const sub: Plan = {
      ...plan,
      nodes: [
        ...whole.nodes.filter((n) => inStage.has(n.id)).map((n) => (borrowed.has(n.id) && n.kind === 'recipe' ? { ...n, power: undefined } : n)),
        ...spares.values(),
      ],
      edges: [...whole.edges.filter((e) => !cutEdges.has(e) && inStage.has(e.target)), ...arriving],
    }
    const real = (id: string) => makerOf.get(id) ?? id
    const sol = solveStage(sub, catalog, feeds, pass.activity, spare)
    for (const [id, a] of sol.pass.activity) if (!makerOf.has(id)) add(pass.activity, id, a)
    for (const [id, f] of sol.pass.edgeFlow) add(pass.edgeFlow, id, f)
    pass.converged &&= sol.pass.converged
    for (const [id, v] of sol.goalValues) goalValues.set(id, v)
    for (const id of sol.bottlenecks) bottlenecks.add(real(id))
    for (const d of sol.diagnostics) diagnostics.push(d.nodeId ? { ...d, nodeId: real(d.nodeId) } : d)
    for (const n of sol.plan.nodes) if (n.id.startsWith(OPEN_END)) openEnds.nodes.push(n)
    for (const e of sol.plan.edges) if (e.id.startsWith(OPEN_END)) openEnds.edges.push(e)
  }

  const augmented = { ...plan, nodes: [...plan.nodes, ...openEnds.nodes], edges: [...plan.edges, ...openEnds.edges] }
  const result = assemble(augmented, catalog, buildGraph(augmented, catalog, []), pass, goalValues, bottlenecks, diagnostics)
  if (augmented.nodes.length === plan.nodes.length) return result
  // Hide the implicit goals and their belts; keep them as goals marked open-end.
  for (const id of [...result.nodes.keys()]) if (id.startsWith(OPEN_END)) result.nodes.delete(id)
  for (const id of [...result.edges.keys()]) if (id.startsWith(OPEN_END)) result.edges.delete(id)
  // An open end's output has no real belt; its flow still counts as used.
  for (const e of augmented.edges) {
    if (!e.id.startsWith(OPEN_END)) continue
    const port = result.nodes.get(e.source)?.outputs.find((p) => p.item === e.item)
    if (port) port.connected = false
  }
  result.goals = result.goals.map((g) => (g.id.startsWith(OPEN_END) ? { ...g, openEndOf: g.id.slice(OPEN_END.length) } : g))
  result.diagnostics = result.diagnostics.map((d) =>
    d.nodeId?.startsWith(OPEN_END) ? { ...d, nodeId: d.nodeId.slice(OPEN_END.length) } : d,
  )
  return result
}

interface StageSolution {
  /** The stage's plan with its open-end goals added. */
  plan: Plan
  pass: Pass
  goalValues: Map<string, number>
  bottlenecks: Set<string>
  diagnostics: PlanDiagnostic[]
}

/**
 * `feeds`: nodes with anything connected downstream in the whole plan.
 * `usedBefore`: what earlier stages already take of each node.
 * `spare`: byproduct belts looping back into their maker's chain.
 */
function solveStage(
  stage: Plan,
  catalog: Catalog,
  feeds: Set<string>,
  usedBefore: Map<string, number>,
  spare: Set<string>,
): StageSolution {
  const plan = withOpenEnds(stage, catalog, feeds)
  const diagnostics: PlanDiagnostic[] = []
  const g = buildGraph(plan, catalog, [], spare)
  for (const [id, u] of g.units) if (u.limit !== undefined) u.limit = Math.max(0, u.limit - (usedBefore.get(id) ?? 0))
  const goals = plan.nodes.filter((n) => g.units.get(n.id)?.anchor !== undefined)
  const anchor = (id: string) => g.units.get(id)!.anchor!
  const limited = plan.nodes.filter((n) => g.units.get(n.id)?.limit !== undefined)

  /** Smallest limit / usage ratio per component, and the nodes achieving it. */
  const tightest = (usage: Map<string, number>, room: (id: string) => number) => {
    const best = new Map<number, { ratio: number; nodes: string[] }>()
    for (const n of limited) {
      const used = usage.get(n.id) ?? 0
      if (used <= EPS) continue
      const ratio = Math.max(0, room(n.id)) / used
      const c = g.component.get(n.id)!
      const cur = best.get(c)
      if (!cur || ratio < cur.ratio - EPS) best.set(c, { ratio, nodes: [n.id] })
      else if (Math.abs(ratio - cur.ratio) <= EPS) cur.nodes.push(n.id)
    }
    return best
  }

  // 1. Numeric targets, scaled down per chain if a limit binds.
  const targets = new Map<string, number>()
  for (const n of goals) {
    const a = anchor(n.id)
    if (a !== 'max') targets.set(n.id, a)
  }
  const t = demandPass(g, targets)
  const r = tightest(t.activity, (id) => g.units.get(id)!.limit!)
  const bottlenecks = new Set<string>()
  const constrained = new Set<number>()
  const goalValues = new Map<string, number>()
  for (const [id, v] of targets) {
    const c = r.get(g.component.get(id)!)
    goalValues.set(id, c && c.ratio < 1 ? v * c.ratio : v)
  }
  for (const [comp, c] of r) {
    if (c.ratio < 1 - EPS) {
      constrained.add(comp)
      c.nodes.forEach((id) => bottlenecks.add(id))
    }
  }

  // 2. Max goals share what the limits have left, fairly: each goal is
  //    weighted so it uses the same share of the limits as the others. Two
  //    open ends behind one miner therefore split its ore evenly.
  const maxGoals = goals.filter((n) => anchor(n.id) === 'max')
  if (maxGoals.length) {
    const room = (id: string) => g.units.get(id)!.limit! - (t.activity.get(id) ?? 0)
    const weight = new Map<string, number>()
    for (const n of maxGoals) {
      if (constrained.has(g.component.get(n.id)!)) continue // targets already fall short
      const alone = demandPass(g, new Map([[n.id, 1]]))
      let cost = 0
      for (const l of limited) {
        const used = alone.activity.get(l.id) ?? 0
        const limit = g.units.get(l.id)!.limit!
        if (used <= EPS) continue
        cost += limit > EPS ? used / limit : Infinity
        // Nothing left of it (an earlier stage took it all): it's what stops the goal.
        if (limit <= EPS) bottlenecks.add(l.id)
      }
      if (cost > EPS) weight.set(n.id, 1 / cost)
      else {
        diagnostics.push({
          severity: 'warning',
          nodeId: n.id,
          message:
            n.kind === 'goal'
              ? 'Max goal has no limit upstream; set a limit on a source or machine group.'
              : 'Max power has no limit upstream; set a limit on a fuel source or machine group.',
        })
      }
    }
    const m = demandPass(g, weight)
    const s = tightest(m.activity, room)
    for (const n of maxGoals) {
      const comp = g.component.get(n.id)!
      const c = s.get(comp)
      const w = weight.get(n.id)
      if (!c || !w) {
        goalValues.set(n.id, 0)
        continue
      }
      goalValues.set(n.id, c.ratio * w)
      c.nodes.forEach((id) => bottlenecks.add(id))
    }
  }

  // 3. Final rates.
  const pass = demandPass(g, goalValues)
  if (!pass.converged) {
    diagnostics.push({ severity: 'error', message: 'A loop in the plan never settles; its rates are not reliable.' })
  }
  return { plan, pass, goalValues, bottlenecks, diagnostics }
}

function assemble(
  plan: Plan,
  catalog: Catalog,
  g: Graph,
  pass: Pass,
  goalValues: Map<string, number>,
  bottlenecks: Set<string>,
  diagnostics: PlanDiagnostic[],
): SolveResult {
  const mode = plan.settings.machineMode
  const nodes = new Map<string, NodeResult>()
  const machines = new Map<MachineId, number>()
  let powerMw = 0
  let generated = 0
  let shards = 0
  let sloops = 0
  const raw = new Map<ItemId, number>()
  const delivered = new Map<ItemId, number>()
  const surplus = new Map<ItemId, number>()
  const missing = new Map<ItemId, number>()
  const add = (m: Map<ItemId, number>, item: ItemId, v: number) => {
    if (v > EPS) m.set(item, (m.get(item) ?? 0) + v)
  }
  const flowOf = (edges: PlanEdge[] | undefined) => (edges ?? []).reduce((s, e) => s + pass.edgeFlow.get(e.id)!, 0)
  // Activity of one machine (or extractor) of a group, for belt warnings.
  const oneMachine = new Map<string, number>()
  const build = (res: NodeResult, machine: MachineId, count: number) => {
    res.buildings = [...(res.buildings ?? []), { machine, count }]
    machines.set(machine, (machines.get(machine) ?? 0) + count)
  }
  const upgrade = (res: NodeResult, machine: Machine, shardsEach: number, sloopsEach: number, built: number) => {
    res.upgrades = { shardsEach, sloopsEach: Math.min(sloopsEach, machine.amplifier?.slots ?? 0), built }
    shards += res.upgrades.shardsEach * built
    sloops += res.upgrades.sloopsEach * built
  }

  for (const n of plan.nodes) {
    const unit = g.units.get(n.id)
    if (!unit) {
      nodes.set(n.id, { id: n.id, resolved: false, activity: 0, inputs: [], outputs: [], powerMw: 0, bottleneck: false })
      continue
    }
    const a = pass.activity.get(n.id) ?? 0
    const inputs: InputPort[] = [...unit.inputs].map(([item, per]) => {
      const feeding = g.in.get(key(n.id, item))
      return { item, needed: a * per, supplied: flowOf(feeding), connected: !!feeding }
    })
    const outputs: OutputPort[] = [...unit.outputs].map(([item, per]) => {
      const leaving = g.out.get(key(n.id, item))
      return { item, produced: a * per, used: flowOf(leaving), connected: !!leaving }
    })
    for (const p of inputs) {
      if (!p.connected) {
        add(missing, p.item, p.needed)
        continue
      }
      // Only spare belts feed it, and they bring too little: the rest is missing too.
      const short = shortfall(p)
      if (!pass.converged || !short) continue
      add(missing, p.item, short)
      const item = catalog.items.get(p.item)
      diagnostics.push({
        severity: 'warning',
        nodeId: n.id,
        message: `${item?.name ?? p.item} is ${num(short)}${perMin(item)} short: the loop brings back ${num(p.supplied)} of the ${num(p.needed)} it needs. Connect another producer for the rest.`,
      })
    }
    if (n.kind !== 'goal') for (const p of outputs) add(surplus, p.item, p.produced - p.used)
    for (const p of outputs) {
      const item = catalog.items.get(p.item)
      const left = p.produced - p.used
      if (pass.converged && item?.radioactive && !item.sinkPoints && left > EPS * Math.max(1, p.produced)) {
        diagnostics.push({
          severity: 'warning',
          nodeId: n.id,
          message: `${num(left)} ${item.name}/min is left over and can't be sunk: process it or store it, or the machines stop when storage fills.`,
        })
      }
    }

    const res: NodeResult = {
      id: n.id,
      resolved: true,
      activity: a,
      inputs,
      outputs,
      powerMw: 0,
      bottleneck: bottlenecks.has(n.id),
    }
    if (unit.limit !== undefined) {
      res.limit = unit.limit
      res.utilization = unit.limit > EPS ? a / unit.limit : undefined
    }

    if (n.kind === 'recipe' && unit.machine && unit.recipe) {
      const setup = n.limited
        ? { ...machineSetup(unit.machine, a, mode, { count: n.count }), shards: shardsNeeded(unit.machine, n.clock) }
        : machineSetup(unit.machine, a, mode, { clock: n.clock })
      res.setup = setup
      oneMachine.set(n.id, Math.min(a, setup.clock))
      res.powerMw = groupPowerMw(unit.machine, setup.count, setup.clock, n.sloops, unit.recipe)
      if (unit.mwPerUnit !== undefined) {
        res.generatedMw = a * unit.mwPerUnit
        generated += res.generatedMw
      }
      if (setup.count > EPS) {
        build(res, unit.machine.id, setup.count)
        upgrade(res, unit.machine, setup.shards, n.sloops, Math.ceil(setup.count - EPS))
      }
      if (!setup.feasible) {
        diagnostics.push({
          severity: 'warning',
          nodeId: n.id,
          message: `Needs ${Math.round(setup.clock * 100)}% clock, above the machine's maximum.`,
        })
      }
    } else if (n.kind === 'extractor' && unit.machine && unit.perExtractor !== undefined) {
      // As many sites as the demand needs, like a flexible recipe node.
      const setup = machineSetup(unit.machine, unit.perExtractor > EPS ? a / unit.perExtractor : 0, mode, { clock: n.clock })
      res.setup = setup
      oneMachine.set(n.id, Math.min(a, unit.perExtractor * setup.clock))
      const by = unit.machine.extraction?.poweredBy
      const driver = by ? catalog.machines.get(by) : undefined
      res.powerMw = groupPowerMw(unit.machine, setup.count, setup.clock, n.sloops) + (driver && a > EPS ? machinePowerMw(driver, setup.clock) : 0)
      if (setup.count > EPS) {
        build(res, unit.machine.id, setup.count)
        if (by) build(res, by, 1)
        upgrade(res, unit.machine, setup.shards, n.sloops, Math.ceil(setup.count - EPS))
      }
      add(raw, n.resource, a)
    } else if (n.kind === 'extractor' && unit.machine) {
      // Limited: the configured sites, at the clock the demand needs (≤ theirs).
      const configured = unit.configured ?? 0
      const clock = configured > EPS ? (n.clock * a) / configured : 0
      res.clock = clock
      res.capacity = configured
      const best = Math.max(0, ...n.sites.map((s) => extractorRate(unit.machine!, { sites: [{ ...s, count: 1 }], clock, sloops: n.sloops }, catalog.purities)))
      oneMachine.set(n.id, Math.min(a, best))
      const by = unit.machine.extraction?.poweredBy
      res.powerMw = a > EPS ? extractorPowerMw(unit.machine, { ...n, clock }, by ? catalog.machines.get(by) : undefined) : 0
      const sites = n.sites.reduce((s, x) => s + x.count, 0)
      if (a > EPS) {
        build(res, unit.machine.id, sites)
        if (by) build(res, by, 1)
        upgrade(res, unit.machine, shardsNeeded(unit.machine, clock), n.sloops, sites)
      }
      add(raw, n.resource, a)
    } else if (n.kind === 'supply') {
      if (n.limited) res.capacity = n.perMin
      add(raw, n.item, a)
    } else if (n.kind === 'goal') {
      add(delivered, n.item, a)
    }
    powerMw += res.powerMw
    nodes.set(n.id, res)
  }

  // Edges: how many belts or pipes of the plan's tier each one needs, if
  // every machine at both ends fits on one.
  const tier = (id?: string) => (id ? catalog.transportTiers.get(id) : undefined)
  const tiers = [...catalog.transportTiers.values()].sort((x, y) => x.ratePerMin - y.ratePerMin)
  const belt = tier(plan.settings.beltTier)
  const pipe = tier(plan.settings.pipeTier)
  const edges = new Map<string, EdgeResult>()
  for (const e of g.edges) {
    const perMin = pass.edgeFlow.get(e.id)!
    const cap = catalog.items.get(e.item)?.form === 'solid' ? belt : pipe
    if (!cap || cap.ratePerMin <= EPS) {
      edges.set(e.id, { perMin })
      continue
    }
    const out = (oneMachine.get(e.source) ?? 0) * (g.units.get(e.source)!.outputs.get(e.item) ?? 0)
    const inn = (oneMachine.get(e.target) ?? 0) * (g.units.get(e.target)!.inputs.get(e.item) ?? 0)
    const one = Math.max(out, inn)
    if (perMin > EPS && one > cap.ratePerMin + EPS) {
      const needs = tiers.find((t) => t.kind === cap.kind && t.ratePerMin >= one - EPS)?.id
      edges.set(e.id, { perMin, tooFast: { perMin: one, end: out >= inn ? 'out' : 'in', ...(needs ? { needs } : {}) } })
    } else {
      edges.set(e.id, { perMin, belts: { tier: cap.id, count: Math.max(1, Math.ceil(perMin / cap.ratePerMin - EPS)) } })
    }
  }

  // Splits and merges.
  const splits: Split[] = []
  const merges: Merge[] = []
  const flows = (list: PlanEdge[]) => list.map((e) => ({ id: e.id, perMin: pass.edgeFlow.get(e.id)! }))
  for (const n of plan.nodes) {
    const res = nodes.get(n.id)!
    for (const p of res.outputs) {
      const list = g.out.get(key(n.id, p.item))
      if (list && list.length > 1) {
        splits.push({ node: n.id, item: p.item, produced: p.produced, edges: flows(list), leftover: Math.max(0, p.produced - p.used) })
      }
    }
    for (const p of res.inputs) {
      const list = g.in.get(key(n.id, p.item))
      if (list && list.length > 1) merges.push({ node: n.id, item: p.item, edges: flows(list) })
    }
  }

  const goals: GoalResult[] = plan.nodes.flatMap((n): GoalResult[] => {
    if (n.kind === 'goal') return [{ id: n.id, item: n.item, requested: n.target, achieved: goalValues.get(n.id) ?? 0 }]
    const unit = g.units.get(n.id)
    if (n.kind !== 'recipe' || n.power === undefined || unit?.anchor === undefined) return []
    const fuel = unit.recipe!.inputs[0]?.item ?? ''
    return [{ id: n.id, item: fuel, requested: n.power, achieved: (goalValues.get(n.id) ?? 0) * unit.mwPerUnit!, power: true }]
  })
  const rates = (m: Map<ItemId, number>): ItemRate[] => [...m].map(([item, perMin]) => ({ item, perMin }))

  return {
    nodes,
    edges,
    goals,
    splits,
    merges,
    totals: {
      powerMw,
      generatedMw: generated,
      machines,
      shards,
      sloops,
      rawResources: rates(raw),
      delivered: rates(delivered),
      surplus: rates(surplus),
      missingInputs: rates(missing),
    },
    diagnostics,
  }
}
