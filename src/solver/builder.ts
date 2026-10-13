// Construct a splitter/merger graph that divides one input belt into the
// requested integer ratios.
//
// Strategy (see the project README for the full write-up):
//   1. The caller has already reduced the outputs to integer ratios r_i with
//      N = sum(r_i).
//   2. Pick B = the smallest 3-smooth number (only factors 2 and 3) with B >= N.
//   3. Split the belt evenly into B leaves with a plain splitter tree.
//   4. Give output i exactly r_i leaves (merged together); route the remaining
//      B - N leaves back into the belt feeding the tree root.
//   5. In steady state every leaf carries input/N, so output i carries
//      r_i * input / N, which is its target rate.
//
// When N is itself 3-smooth, B === N, there are no leftover leaves and the graph
// is a pure acyclic tree. Otherwise exactly one feedback loop is introduced.

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
    const id = this.id(kind === 'splitter' ? 's' : kind === 'merger' ? 'm' : kind === 'sink' ? 'o' : 'src')
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
  const feedbackCount = B - N

  const b = new Builder()
  const source = b.addNode('source', { label: 'Input' })

  // Degenerate case: a single output equal to the whole input.
  if (B === 1) {
    const sink = b.addNode('sink', { label: outputLabels?.[0], target: undefined })
    b.addEdge(source, sink)
    return { graph: { nodes: b.nodes, edges: b.edges }, leafCount: 1, loopbacks: 0 }
  }

  // --- 1. Splitter tree: one root splitter down to B equal leaf ports. ---
  const factors = factorizeSmooth(B)
  const root = b.addNode('splitter')
  let level: string[] = new Array(factors[0]).fill(root)
  for (let fi = 1; fi < factors.length; fi++) {
    const f = factors[fi]
    const next: string[] = []
    for (const producer of level) {
      const sp = b.addNode('splitter')
      b.addEdge(producer, sp)
      for (let k = 0; k < f; k++) next.push(sp)
    }
    level = next
  }
  const leaves = level // length B; each bottom splitter appears (last factor) times

  // --- 2. Hand out leaves: r_i per output, the remainder to feedback. ---
  let cursor = 0
  ratios.forEach((r, i) => {
    const group = leaves.slice(cursor, cursor + r)
    cursor += r
    const producer = b.mergeStreams(group)
    const sink = b.addNode('sink', { label: outputLabels?.[i] })
    b.addEdge(producer, sink)
  })
  const feedbackLeaves = leaves.slice(cursor) // length feedbackCount

  // --- 3. Feed the tree root with source + any feedback leaves. ---
  if (feedbackCount === 0) {
    b.addEdge(source, root)
  } else {
    const feedbackProducer = b.mergeStreams(feedbackLeaves, true)
    const rootMerger = b.addNode('merger')
    b.addEdge(source, rootMerger)
    b.addEdge(feedbackProducer, rootMerger, true)
    b.addEdge(rootMerger, root)
  }

  return {
    graph: { nodes: b.nodes, edges: b.edges },
    leafCount: B,
    loopbacks: feedbackCount,
  }
}
