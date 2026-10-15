// How players actually divide one machine group's output among several
// consumers. An exact load balancer is rarely what gets built:
//   - a manifold (a splitter in front of each machine along the belt) works
//     whenever the consumers are machines: they take only what they need and,
//     once full, back up so the splitters pass items on. One output that takes
//     everything (a goal: storage, a sink, a train) also works, if it is last
//     on the line: it gets the overflow. Two or more of those need a balancer
//     to share the flow between them;
//   - dedicated machines: the producing group is cut into one sub-group per
//     consumer, so the item never splits at all. Exact and no splitters, for
//     at most one extra machine per sub-group.
// The ⑂ popup shows both next to the balancer, and recommends one.

import type { Catalog, ItemId, TransportTier } from '../catalog'
import { groupEnd, machinesOnBelts } from './belts'
import type { GroupEnd } from './belts'
import { splitByConsumerBlocker } from './edit'
import type { SolveResult, Split } from './solve'
import type { Plan } from './types'

/** One belt leaving the split: who takes it and how. */
export interface SplitBranch {
  edge: string
  target: string
  perMin: number
  /** The consumer's machines, when it is a machine group. */
  consumers?: GroupEnd
  /** True when it takes everything it gets (a goal), so it never backs up. */
  taker: boolean
}

export interface DedicatedGroup {
  edge: string
  perMin: number
  /** Producing machines for this consumer, possibly fractional. */
  machines: number
  /** Belts of the plan's tier the sub-group needs (one per belt), when a tier is set. */
  belts?: number
}

export interface SplitAdvice {
  branches: SplitBranch[]
  /** A manifold works: every branch pulls, or exactly one takes all and goes last. */
  manifold: boolean
  /** The branch to put last on the manifold: it gets the overflow. */
  overflow?: string
  /** One sub-group per consumer, when the producer is a machine group. */
  dedicated?: { groups: DedicatedGroup[]; producers: GroupEnd; built: number; shared: number; blocker?: string }
  recommend: 'manifold' | 'balancer'
}

export function adviseSplit(plan: Plan, result: SolveResult, split: Split, catalog: Catalog): SplitAdvice {
  const byId = new Map(plan.nodes.map((n) => [n.id, n]))
  const edgeOf = new Map(plan.edges.map((e) => [e.id, e]))
  const branches: SplitBranch[] = split.edges
    .filter((e) => e.perMin > 1e-6)
    .map((e) => {
      const target = edgeOf.get(e.id)!.target
      const consumers = groupEnd(result.nodes.get(target), split.item, 'in')
      return { edge: e.id, target, perMin: e.perMin, consumers, taker: byId.get(target)?.kind === 'goal' }
    })
  const takers = branches.filter((b) => b.taker)
  const manifold = takers.length <= 1
  const overflow = takers.length === 1 ? takers[0].edge : undefined

  const producers = groupEnd(result.nodes.get(split.node), split.item, 'out')
  let dedicated: SplitAdvice['dedicated']
  if (producers) {
    const item = catalog.items.get(split.item)
    const tier = catalog.transportTiers.get((item?.form === 'solid' ? plan.settings.beltTier : plan.settings.pipeTier) ?? '')
    const groups = branches.map((b) => {
      const machines = b.perMin / producers.each
      const belts = tier ? machinesOnBelts(machines, producers.each, tier.ratePerMin)?.length : undefined
      return { edge: b.edge, perMin: b.perMin, machines, ...(belts ? { belts } : {}) }
    })
    dedicated = {
      groups,
      producers,
      built: groups.reduce((s, g) => s + Math.ceil(g.machines - 1e-6), 0),
      shared: Math.ceil(producers.count - 1e-6),
      blocker: splitByConsumerBlocker(plan, split.node, split.item),
    }
  }
  return { branches, manifold, overflow, dedicated, recommend: manifold ? 'manifold' : 'balancer' }
}

/** A stop along a manifold line: a consumer group (or part of one) and how it branches off. */
export interface ManifoldStop {
  edge: string
  perMin: number
  /** Consumer machines at this stop (whole, unless the group's own count isn't). */
  machines?: number
  /** Slowest tier that carries one machine's intake: the branch belt or pipe. */
  branch?: TransportTier
  /** Takes everything: it goes last and gets the line's overflow. */
  taker: boolean
  /** Part `part` of `parts` when a consumer group is spread over several lines. */
  part?: number
  parts?: number
}

export interface ManifoldLine {
  perMin: number
  /** Producer machines merging onto this line (possibly fractional). */
  producers?: number
  stops: ManifoldStop[]
  /** One per machine, except the last machine of a line without a taker, which takes the belt's end. */
  splitters: number
}

export interface ManifoldPlan {
  /** The plan's tier for this item; unset means one line, whatever it carries. */
  tier?: TransportTier
  lines: ManifoldLine[]
  splitters: number
}

/**
 * Lay out the manifold for a split. A line is a real belt or pipe, so it
 * carries at most the plan's tier: whole consumer groups go onto as few lines
 * as fit (biggest first), and a group bigger than a line is cut into even
 * chunks of whole machines. The producers are shared out to match each line.
 * Each branch gets the slowest tier that carries one machine's intake, so it
 * can't grab more than that while the line fills (a player's trick: a Mk.1
 * branch off a Mk.5 line). A goal that takes everything goes last.
 */
export function manifoldPlan(advice: SplitAdvice, catalog: Catalog, plan: Plan, item: ItemId): ManifoldPlan {
  const form = catalog.items.get(item)?.form
  const tier = catalog.transportTiers.get((form === 'solid' ? plan.settings.beltTier : plan.settings.pipeTier) ?? '')
  const kind = form === 'solid' ? 'belt' : 'pipe'
  const tiers = [...catalog.transportTiers.values()].filter((t) => t.kind === kind).sort((a, b) => a.ratePerMin - b.ratePerMin)
  const cap = tier?.ratePerMin ?? Infinity
  const branchFor = (each?: number) => (each ? tiers.find((t) => t.ratePerMin >= each - 1e-9) : undefined)

  // Chunks no bigger than a line: whole consumer groups when they fit.
  type Chunk = ManifoldStop
  const chunks: Chunk[] = []
  for (const b of advice.branches) {
    const each = b.consumers?.each
    const loads = b.perMin > cap + 1e-9 ? (each ? machinesOnBelts(b.perMin / each, each, cap) : undefined) : undefined
    const pieces = loads
      ? loads.map((l) => ({ perMin: l.perMin, machines: l.machines }))
      : b.perMin > cap + 1e-9
        ? Array.from({ length: Math.ceil(b.perMin / cap - 1e-9) }, () => ({ perMin: b.perMin / Math.ceil(b.perMin / cap - 1e-9), machines: undefined }))
        : [{ perMin: b.perMin, machines: b.consumers ? b.perMin / b.consumers.each : undefined }]
    pieces.forEach((p, i) =>
      chunks.push({
        edge: b.edge,
        perMin: p.perMin,
        ...(p.machines !== undefined ? { machines: p.machines } : {}),
        ...(branchFor(each) ? { branch: branchFor(each) } : {}),
        taker: b.taker,
        ...(pieces.length > 1 ? { part: i + 1, parts: pieces.length } : {}),
      }),
    )
  }

  // First fit, biggest first; the taker's chunks go last onto lines with room.
  const lines: { perMin: number; stops: Chunk[] }[] = []
  const place = (c: Chunk) => {
    const line = lines.find((l) => l.perMin + c.perMin <= cap + 1e-9)
    if (line) {
      line.stops.push(c)
      line.perMin += c.perMin
    } else lines.push({ perMin: c.perMin, stops: [c] })
  }
  chunks
    .filter((c) => !c.taker)
    .sort((a, b) => b.perMin - a.perMin)
    .forEach(place)
  chunks.filter((c) => c.taker).forEach(place)

  const each = advice.dedicated?.producers.each
  const out = lines.map((l) => {
    const taker = l.stops.some((s) => s.taker)
    const machines = l.stops.reduce((s, x) => s + (x.taker ? 0 : Math.ceil((x.machines ?? 1) - 1e-6)), 0)
    return {
      perMin: l.perMin,
      ...(each ? { producers: l.perMin / each } : {}),
      // Machines in the order they sit on the line, the taker at the end.
      stops: [...l.stops].sort((a, b) => Number(a.taker) - Number(b.taker)),
      splitters: Math.max(0, taker ? machines : machines - 1),
    }
  })
  return { ...(tier ? { tier } : {}), lines: out, splitters: out.reduce((s, l) => s + l.splitters, 0) }
}
