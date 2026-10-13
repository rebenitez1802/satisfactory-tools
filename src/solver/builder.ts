// Construct a compact splitter/merger graph that divides one input belt into
// the requested integer ratios.
//
// Strategy (see the project README for the full write-up):
//   1. The caller has already reduced the outputs to integer ratios r_i with
//      N = sum(r_i). We work in "units" where 1 unit = input / N.
//   2. Pick B = the smallest 3-smooth number (only factors 2 and 3) with B >= N.
//      The belt is grown to B units; the extra B - N units are looped back.
//   3. Recursively divide the B-unit trunk: at each belt carrying V units, split
//      evenly by 2 or 3, then partition the amounts it must still deliver across
//      the sub-belts, cutting an amount only where it crosses a sub-belt
//      boundary. Recurse until a sub-belt carries exactly one output's amount.
//   4. Each output collects its (few) delivered pieces through a small merger
//      tree. The looped-back units rejoin the input before the trunk.
//
// This keeps belts aggregated instead of fanning the whole belt out to N unit
// streams, so the graph stays small (a handful of nodes) even for awkward
// ratios. When N is itself 3-smooth there is no leftover and no loop.

import type { GEdge, GNode, Graph } from './types'

/** Smallest 3-smooth number (2^a * 3^b) that is >= n. */
export function smooth3AtLeast(n: number): number {
  if (n <= 1) return 1
  let best = Infinity
  // A power of two always lands in [n, 2n), so searching 3-smooth values below
  // 2n is guaranteed to find a candidate.
  for (let v2 = 1; v2 < n * 2; v2 *= 2) {
    for (let v = v2; v < n * 2; v *= 3) {
      if (v >= n && v < best) best = v
    }
  }
  return best
}

/** Decompose a 3-smooth number into a list of 2s and 3s (3s first). */
export function factorizeSmooth(b: number): number[] {
  const factors: number[] = []
  let x = b
  while (x % 3 === 0) {
    factors.push(3)
    x /= 3
  }
  while (x % 2 === 0) {
    factors.push(2)
    x /= 2
  }
  if (x !== 1) throw new Error(`${b} is not 3-smooth`)
  return factors
}

class Builder {
  nodes: GNode[] = []
  edges: GEdge[] = []
  private counters: Record<string, number> = {}

  private id(prefix: string): string {
    const n = this.counters[prefix] ?? 0
    this.counters[prefix] = n + 1
    return `${prefix}${n}`
  }

  addNode(kind: GNode['kind'], extra: Partial<GNode> = {}): string {
    const id = this.id(
      kind === 'splitter' ? 's' : kind === 'merger' ? 'm' : kind === 'sink' ? 'o' : 'src',
    )
    this.nodes.push({ id, kind, ...extra })
    return id
  }

  addEdge(source: string, target: string, feedback = false): void {
    this.edges.push({ id: `e${this.edges.length}`, source, target, feedback })
  }

  /**
   * Merge a set of producer ports down to a single belt using 3-in mergers.
   * Returns the id of the node whose single output carries the sum. A single
   * port is returned unchanged (no merger needed).
   */
  mergeStreams(ports: string[], feedback = false): string {
    let current = [...ports]
    while (current.length > 1) {
      const next: string[] = []
      for (let i = 0; i < current.length; i += 3) {
        const group = current.slice(i, i + 3)
        if (group.length === 1) {
          next.push(group[0])
          continue
        }
        const m = this.addNode('merger')
        for (const p of group) this.addEdge(p, m, feedback)
        next.push(m)
      }
      current = next
    }
    return current[0]
  }
}

/** A demand: `amt` units destined for the belt collector identified by `id`. */
interface Demand {
  id: string
  amt: number
}

/** Split `demands` into `f` bins each summing to `cap`, cutting minimally. */
function partition(demands: Demand[], f: number, cap: number): Demand[][] {
  const items = demands.map((d) => ({ id: d.id, amt: d.amt }))
  const bins: Demand[][] = []

  for (let k = 0; k < f; k++) {
    const bin: Demand[] = []
    let room = cap

    // Place whole items largest-first while they still fit.
    for (;;) {
      let best = -1
      for (let j = 0; j < items.length; j++) {
        if (items[j].amt > 0 && items[j].amt <= room && (best < 0 || items[j].amt > items[best].amt)) {
          best = j
        }
      }
      if (best < 0) break
      bin.push({ id: items[best].id, amt: items[best].amt })
      room -= items[best].amt
      items[best].amt = 0
    }

    // Top the bin off by cutting the largest remaining item.
    if (room > 0) {
      let best = -1
      for (let j = 0; j < items.length; j++) {
        if (items[j].amt > 0 && (best < 0 || items[j].amt > items[best].amt)) best = j
      }
      bin.push({ id: items[best].id, amt: room })
      items[best].amt -= room
      room = 0
    }

    bins.push(bin)
  }
  return bins
}

const countPieces = (bins: Demand[][]) => bins.reduce((s, b) => s + b.length, 0)

/** Pick a split factor (2 or 3) that divides V and yields the fewest pieces. */
function chooseFactor(v: number, demands: Demand[]): number {
  const can2 = v % 2 === 0
  const can3 = v % 3 === 0
  if (can2 && can3) {
    const p2 = countPieces(partition(demands, 2, v / 2))
    const p3 = countPieces(partition(demands, 3, v / 3))
    // Prefer 3 on a tie: a shallower tree with the same piece count.
    return p3 <= p2 ? 3 : 2
  }
  return can3 ? 3 : 2
}

/**
 * Recursively divide a belt of `v` units (produced by `producer`'s output) so
 * that it delivers exactly `demands`. Each time a whole belt lands on a single
 * demand, `deliver(id, producer)` records that producer as feeding that id.
 */
function distribute(
  b: Builder,
  producer: string,
  v: number,
  demands: Demand[],
  deliver: (id: string, producer: string) => void,
): void {
  if (demands.length === 1) {
    // The whole belt (v units) goes to this demand.
    deliver(demands[0].id, producer)
    return
  }

  const f = chooseFactor(v, demands)
  const cap = v / f
  const splitter = b.addNode('splitter')
  b.addEdge(producer, splitter)

  for (const bin of partition(demands, f, cap)) {
    distribute(b, splitter, cap, bin, deliver)
  }
}

export interface BuiltGraph {
  graph: Graph
  leafCount: number
  loopbacks: number
}

/**
 * Build the balancer graph for an already-reduced set of ratios.
 * `ratios` must be positive integers; N is their sum.
 */
export function buildBalancer(ratios: number[], outputLabels?: (string | undefined)[]): BuiltGraph {
  const N = ratios.reduce((s, r) => s + r, 0)
  const B = smooth3AtLeast(N)
  const feedback = B - N

  const b = new Builder()
  const source = b.addNode('source', { label: 'Input' })
  const sinkIds = ratios.map((_, i) => b.addNode('sink', { label: outputLabels?.[i] }))

  // Degenerate case: a single output equal to the whole input.
  if (B === 1) {
    b.addEdge(source, sinkIds[0])
    return { graph: { nodes: b.nodes, edges: b.edges }, leafCount: 1, loopbacks: 0 }
  }

  // Demands: one per output, plus the loopback remainder if N isn't 3-smooth.
  const demands: Demand[] = ratios.map((r, i) => ({ id: `out${i}`, amt: r }))
  if (feedback > 0) demands.push({ id: 'loop', amt: feedback })

  const collectors = new Map<string, string[]>()
  const deliver = (id: string, prod: string) => {
    const list = collectors.get(id)
    if (list) list.push(prod)
    else collectors.set(id, [prod])
  }

  // The trunk carries B units. With a loopback it is fed by a merger that
  // combines the source with the returned belts; otherwise the source feeds it.
  const trunkMerger = feedback > 0 ? b.addNode('merger') : null
  distribute(b, trunkMerger ?? source, B, demands, deliver)

  // Each output collects its delivered pieces through a merger tree.
  ratios.forEach((_, i) => {
    const prod = b.mergeStreams(collectors.get(`out${i}`) ?? [])
    b.addEdge(prod, sinkIds[i])
  })

  // Close the loop: returned belts merge back into the trunk alongside the input.
  if (trunkMerger) {
    const prod = b.mergeStreams(collectors.get('loop') ?? [], true)
    b.addEdge(source, trunkMerger)
    b.addEdge(prod, trunkMerger, true)
  }

  return { graph: { nodes: b.nodes, edges: b.edges }, leafCount: B, loopbacks: feedback }
}
