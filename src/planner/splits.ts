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
//     at most one partly clocked machine per sub-group.
// The ⑂ popup shows both next to the balancer, and recommends one.

import type { Catalog } from '../catalog'
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
