// Plan solver: targets and limits (see docs/production-planner.md).
//
// Every node has an *activity*: machines-at-100% for recipe nodes, items/min
// for extractors, supplies and goals. Its port rates are activity × a fixed
// per-unit rate, so the whole plan is driven by demand flowing upstream from
// the goals:
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

import type { Catalog, ItemId, Machine, MachineId, Recipe } from '../catalog'
import {
  extractorPowerMw,
  extractorRate,
  groupPowerMw,
  machineSetup,
  maxClock,
  outputMultiplier,
  shardsNeeded,
} from './rates'
import type { ItemRate, MachineSetup } from './rates'
import type { Plan, PlanEdge, PlanNode } from './types'

const EPS = 1e-9
const MAX_ITER = 1000

export interface InputPort {
  item: ItemId
  /** What the node consumes. */
  needed: number
  /** What its incoming edges deliver (0 when unconnected). */
  supplied: number
  connected: boolean
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
  /** Recipe nodes: machines and clock as they'd be built. */
  setup?: MachineSetup
  /** Extractor nodes: the clock the extractors actually need to run at. */
  clock?: number
  powerMw: number
  /** Limited nodes: the limit, in activity units. */
  limit?: number
  /**
   * Sources (extractors, limited supplies): what they can put out as
   * configured, whether or not anything downstream uses it yet.
   */
  capacity?: number
  /**
   * activity / limit for limited nodes. For flexible extractors it is relative
   * to what the configured sites give, so > 1 means more sites are needed.
   */
  utilization?: number
  bottleneck: boolean
}

export interface GoalResult {
  id: string
  item: ItemId
  requested: number | 'max'
  achieved: number
  /**
   * Set for an open end treated as a Max goal: the node whose unconnected
   * output it is. `id` is then not a plan node.
   */
  openEndOf?: string
}

export interface EdgeResult {
  perMin: number
  /** Throughput of the selected belt/pipe tier when this edge exceeds it. */
  overCapacity?: number
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
  powerMw: number
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
  /** Extractors: output of the configured sites at the configured clock. */
  configured?: number
}

const key = (node: string, item: ItemId) => `${node}\u0000${item}`

function unitOf(node: PlanNode, catalog: Catalog): Unit | undefined {
  switch (node.kind) {
    case 'recipe': {
      const recipe = catalog.recipes.get(node.recipe)
      const machine = catalog.machines.get(node.machine)
      if (!recipe || !machine) return undefined
      const perMachine = (60 / recipe.durationSec) * machine.speed
      const boost = outputMultiplier(machine, node.sloops)
      return {
        inputs: new Map(recipe.inputs.map((a) => [a.item, a.amount * perMachine])),
        outputs: new Map(recipe.outputs.map((a) => [a.item, a.amount * perMachine * boost])),
        limit: node.limited ? node.count * node.clock : undefined,
        recipe,
        machine,
      }
    }
    case 'extractor': {
      const machine = catalog.machines.get(node.machine)
      if (!machine?.extraction || !catalog.items.has(node.resource)) return undefined
      const configured = extractorRate(machine, node, catalog.purities)
      return {
        inputs: new Map(),
        outputs: new Map([[node.resource, 1]]),
        limit: node.limited ? configured : undefined,
        machine,
        configured,
      }
    }
    case 'supply':
      if (!catalog.items.has(node.item)) return undefined
      return { inputs: new Map(), outputs: new Map([[node.item, 1]]), limit: node.limited ? node.perMin : undefined }
    case 'goal':
      if (!catalog.items.has(node.item)) return undefined
      return { inputs: new Map([[node.item, 1]]), outputs: new Map() }
  }
}

interface Graph {
  nodes: PlanNode[]
  units: Map<string, Unit>
  edges: PlanEdge[]
  /** Valid edges by source port / target port. */
  out: Map<string, PlanEdge[]>
  in: Map<string, PlanEdge[]>
  /** Consumers before producers, so a DAG settles in one pass. */
  order: PlanNode[]
  component: Map<string, number>
}

function pushTo<K, V>(map: Map<K, V[]>, k: K, v: V) {
  const list = map.get(k)
  if (list) list.push(v)
  else map.set(k, [v])
}

function buildGraph(plan: Plan, catalog: Catalog, diagnostics: PlanDiagnostic[]): Graph {
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
  const successors = new Map<string, Set<string>>(plan.nodes.map((n) => [n.id, new Set()]))
  for (const e of edges) successors.get(e.source)!.add(e.target)
  const consumersLeft = new Map(plan.nodes.map((n) => [n.id, successors.get(n.id)!.size]))
  const predecessors = new Map<string, Set<string>>(plan.nodes.map((n) => [n.id, new Set()]))
  for (const e of edges) predecessors.get(e.target)!.add(e.source)
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

  return { nodes: plan.nodes, units, edges, out, in: inn, order, component }
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

  for (let iter = 0; iter < MAX_ITER && !converged; iter++) {
    let maxDelta = 0
    let scale = 1
    for (const n of g.order) {
      const unit = g.units.get(n.id)
      if (!unit) continue
      let a = 0
      if (n.kind === 'goal') a = goalValues.get(n.id) ?? 0
      else {
        for (const [item, perUnit] of unit.outputs) {
          const demand = (g.out.get(key(n.id, item)) ?? []).reduce((s, e) => s + edgeFlow.get(e.id)!, 0)
          if (perUnit > 0) a = Math.max(a, demand / perUnit)
        }
      }
      maxDelta = Math.max(maxDelta, Math.abs(a - (activity.get(n.id) ?? 0)))
      scale = Math.max(scale, a)
      activity.set(n.id, a)

      for (const [item, perUnit] of unit.inputs) {
        const feeding = g.in.get(key(n.id, item))
        if (!feeding) continue
        const shares = feeding.reduce((s, e) => s + (e.share ?? 1), 0)
        for (const e of feeding) edgeFlow.set(e.id, (a * perUnit * (e.share ?? 1)) / shares)
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
function withOpenEnds(plan: Plan, catalog: Catalog): Plan {
  const g = buildGraph(plan, catalog, [])
  const withGoal = new Set(plan.nodes.filter((n) => n.kind === 'goal').map((n) => g.component.get(n.id)))
  const withLimit = new Set(plan.nodes.filter((n) => g.units.get(n.id)?.limit !== undefined).map((n) => g.component.get(n.id)))
  const feeding = new Set(g.edges.map((e) => e.source))
  const nodes: PlanNode[] = []
  const edges: PlanEdge[] = []
  for (const n of plan.nodes) {
    const c = g.component.get(n.id)
    const main = g.units.get(n.id)?.outputs.keys().next().value
    if (n.kind === 'goal' || !main || feeding.has(n.id) || withGoal.has(c) || !withLimit.has(c)) continue
    const id = `${OPEN_END}${n.id}`
    nodes.push({ id, kind: 'goal', position: n.position, item: main, target: 'max' })
    edges.push({ id, source: n.id, target: id, item: main })
  }
  return nodes.length ? { ...plan, nodes: [...plan.nodes, ...nodes], edges: [...plan.edges, ...edges] } : plan
}

export function solvePlan(plan: Plan, catalog: Catalog): SolveResult {
  const augmented = withOpenEnds(plan, catalog)
  const result = solveAnchored(augmented, catalog)
  if (augmented === plan) return result
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

function solveAnchored(plan: Plan, catalog: Catalog): SolveResult {
  const diagnostics: PlanDiagnostic[] = []
  const g = buildGraph(plan, catalog, diagnostics)
  const goals = plan.nodes.filter((n) => n.kind === 'goal')
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
  for (const n of goals) if (n.kind === 'goal' && n.target !== 'max') targets.set(n.id, Math.max(0, n.target))
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
  const maxGoals = goals.filter((n) => n.kind === 'goal' && n.target === 'max')
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
        if (used > EPS) cost += limit > EPS ? used / limit : Infinity
      }
      if (cost > EPS) weight.set(n.id, 1 / cost)
      else {
        diagnostics.push({
          severity: 'warning',
          nodeId: n.id,
          message: 'Max goal has no limit upstream; set a limit on a source or machine group.',
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
  const final = demandPass(g, goalValues)
  if (!final.converged) {
    diagnostics.push({ severity: 'error', message: 'A loop in the plan never settles; its rates are not reliable.' })
  }
  return assemble(plan, catalog, g, final, goalValues, bottlenecks, diagnostics)
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
    for (const p of inputs) if (!p.connected) add(missing, p.item, p.needed)
    if (n.kind !== 'goal') for (const p of outputs) add(surplus, p.item, p.produced - p.used)

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
      res.powerMw = groupPowerMw(unit.machine, setup.count, setup.clock, n.sloops, unit.recipe)
      if (setup.count > EPS) {
        machines.set(unit.machine.id, (machines.get(unit.machine.id) ?? 0) + setup.count)
        const built = Math.ceil(setup.count - EPS)
        shards += setup.shards * built
        sloops += Math.min(n.sloops, unit.machine.amplifier?.slots ?? 0) * built
      }
      if (!setup.feasible) {
        diagnostics.push({
          severity: 'warning',
          nodeId: n.id,
          message: `Needs ${Math.round(setup.clock * 100)}% clock, above the machine's maximum.`,
        })
      }
    } else if (n.kind === 'extractor' && unit.machine) {
      const configured = unit.configured ?? 0
      const clock = configured > EPS ? (n.clock * a) / configured : 0
      res.clock = clock
      res.capacity = configured
      if (!n.limited && configured > EPS) res.utilization = a / configured
      const by = unit.machine.extraction?.poweredBy
      res.powerMw = a > EPS ? extractorPowerMw(unit.machine, { ...n, clock }, by ? catalog.machines.get(by) : undefined) : 0
      const sites = n.sites.reduce((s, x) => s + x.count, 0)
      if (a > EPS) {
        machines.set(unit.machine.id, (machines.get(unit.machine.id) ?? 0) + sites)
        if (by) machines.set(by, (machines.get(by) ?? 0) + 1)
        shards += shardsNeeded(unit.machine, clock) * sites
        sloops += Math.min(n.sloops, unit.machine.amplifier?.slots ?? 0) * sites
      }
      if (clock > maxClock(unit.machine) + EPS) {
        diagnostics.push({ severity: 'warning', nodeId: n.id, message: 'Needs more resource nodes than configured.' })
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

  // Edges, with belt/pipe capacity warnings.
  const tier = (id?: string) => (id ? catalog.transportTiers.get(id) : undefined)
  const belt = tier(plan.settings.beltTier)
  const pipe = tier(plan.settings.pipeTier)
  const edges = new Map<string, EdgeResult>()
  for (const e of g.edges) {
    const perMin = pass.edgeFlow.get(e.id)!
    const cap = catalog.items.get(e.item)?.form === 'solid' ? belt : pipe
    edges.set(e.id, cap && perMin > cap.ratePerMin + EPS ? { perMin, overCapacity: cap.ratePerMin } : { perMin })
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

  const goals: GoalResult[] = plan.nodes.flatMap((n) =>
    n.kind === 'goal' ? [{ id: n.id, item: n.item, requested: n.target, achieved: goalValues.get(n.id) ?? 0 }] : [],
  )
  const rates = (m: Map<ItemId, number>): ItemRate[] => [...m].map(([item, perMin]) => ({ item, perMin }))

  return {
    nodes,
    edges,
    goals,
    splits,
    merges,
    totals: {
      powerMw,
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
