// Build checklist and build cost: what the plan's buildings cost, and what's
// left to bring once some nodes are marked done (roadmap #20, #21).
//
// Costs are counted per node, in whole buildings: a group of 2.4 Smelters is
// 3 Smelters to build, whatever the machine mode shows. A done node has its
// buildings already. If the plan later needs more of its machines than it was
// marked done with (done with 6, now needs 8), it is no longer done: it is
// flagged, and only the 2 extra are still to build. The mark keeps its count,
// so the node is done again if the plan goes back to 6 or the player marks
// all 8 built. Machines without a known cost are listed rather than counted
// as free.

import type { Catalog, ItemAmount, ItemId, MachineId } from '../catalog'
import type { NodeResult, SolveResult } from './solve'
import type { Plan, PlanNode } from './types'

const EPS = 1e-6

const whole = (count: number) => Math.ceil(count - EPS)

/** How many of a node's own machines (or extractors) it needs, counted whole. */
export function builtCount(res: NodeResult | undefined): number {
  return whole(res?.buildings?.[0]?.count ?? 0)
}

/** A node marked done that now needs more machines than it was marked with: not done any more. */
export function doneShortfall(node: PlanNode, res: NodeResult | undefined): { built: number; needs: number } | undefined {
  if (!node.done) return undefined
  const needs = builtCount(res)
  return needs > node.done.count ? { built: node.done.count, needs } : undefined
}

/** Marked done, and still has every machine the plan needs. */
export function isDone(node: PlanNode, res: NodeResult | undefined): boolean {
  return !!node.done && !doneShortfall(node, res)
}

export interface BuildCost {
  /** Items to build every building the plan needs. */
  total: ItemAmount[]
  /** The same, leaving out what nodes marked done already have. */
  needed: ItemAmount[]
  /** Machines the plan uses whose cost isn't in the game data. */
  unknown: MachineId[]
  /** Nodes done, of all nodes. */
  done: number
  nodes: number
  /** Nodes marked done that need more machines since. */
  behind: number
}

export function buildCost(plan: Plan, result: SolveResult, catalog: Catalog): BuildCost {
  const total = new Map<ItemId, number>()
  const needed = new Map<ItemId, number>()
  const unknown = new Set<MachineId>()
  const add = (m: Map<ItemId, number>, machine: MachineId, count: number) => {
    const cost = catalog.machines.get(machine)?.buildCost
    if (!cost) return void (count > 0 && unknown.add(machine))
    for (const a of cost) if (count > 0) m.set(a.item, (m.get(a.item) ?? 0) + a.amount * count)
  }
  for (const n of plan.nodes) {
    const list = result.nodes.get(n.id)?.buildings ?? []
    list.forEach(({ machine, count }, i) => {
      const all = whole(count)
      add(total, machine, all)
      // Only the node's own machine can grow past its done mark.
      add(needed, machine, !n.done ? all : i === 0 ? Math.max(0, all - n.done.count) : 0)
    })
  }
  const list = (m: Map<ItemId, number>) => [...total.keys()].map((item) => ({ item, amount: m.get(item) ?? 0 }))
  return {
    total: list(total),
    needed: list(needed),
    unknown: [...unknown],
    done: plan.nodes.filter((n) => isDone(n, result.nodes.get(n.id))).length,
    nodes: plan.nodes.length,
    behind: plan.nodes.filter((n) => doneShortfall(n, result.nodes.get(n.id))).length,
  }
}
