// Assign (x, y) positions to graph nodes using longest-path layering.
//
// Feedback edges are ignored when computing layers (otherwise the graph has
// cycles and no topological order); they simply render as belts looping back
// from a deeper layer to a shallower one.
//
// Two ranks are pinned so the input and outputs are visually isolated:
//   - the sources sit alone in rank 0 (they are the only nodes with no inputs);
//   - every sink is pushed to one shared final rank, aligned together, even if
//     some outputs could be tapped earlier.
// `direction` controls whether ranks run left-to-right or bottom-to-top.

import type { Graph } from './types'

export type Direction = 'LR' | 'BT'

export interface Positioned {
  id: string
  x: number
  y: number
  rank: number
}

// Distance between ranks: the tightest spacing that keeps nodes, belt labels
// and output captions from overlapping. Horizontal needs more room because
// captions and labels are wider than they are tall.
const MAJOR_GAP: Record<Direction, number> = { LR: 140, BT: 80 }
const MINOR_GAP = 130 // distance between nodes within a rank

export function layoutGraph(graph: Graph, direction: Direction = 'LR'): Map<string, Positioned> {
  const forward = graph.edges.filter((e) => !e.feedback)

  const indeg = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const n of graph.nodes) {
    indeg.set(n.id, 0)
    adj.set(n.id, [])
  }
  for (const e of forward) {
    adj.get(e.source)!.push(e.target)
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
  }

  // Kahn topological order over the acyclic (non-feedback) graph, tracking the
  // longest path to each node as its rank.
  const rank = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]))
  const workIndeg = new Map(indeg)
  const queue = graph.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id)
  while (queue.length) {
    const u = queue.shift()!
    for (const v of adj.get(u)!) {
      rank.set(v, Math.max(rank.get(v)!, rank.get(u)! + 1))
      workIndeg.set(v, workIndeg.get(v)! - 1)
      if (workIndeg.get(v) === 0) queue.push(v)
    }
  }

  // Pin all sinks to a shared final rank, one past the deepest non-sink node,
  // so the outputs line up together and sit alone in the last rank.
  const isSink = new Set(graph.nodes.filter((n) => n.kind === 'sink').map((n) => n.id))
  let maxNonSink = 0
  for (const n of graph.nodes) {
    if (!isSink.has(n.id)) maxNonSink = Math.max(maxNonSink, rank.get(n.id)!)
  }
  const finalRank = maxNonSink + 1
  for (const id of isSink) rank.set(id, finalRank)

  // Group by rank and lay nodes out, centered on the cross axis.
  const byRank = new Map<number, string[]>()
  for (const n of graph.nodes) {
    const r = rank.get(n.id)!
    if (!byRank.has(r)) byRank.set(r, [])
    byRank.get(r)!.push(n.id)
  }

  // Minor-axis offset per node. One input: every rank centered. Several
  // inputs: each later rank sits under the nodes that feed it (the mean of
  // their offsets), pushed apart just enough to keep the gap, so merger trees
  // stand over the inputs they collect instead of belts crossing the graph.
  const minor = new Map<string, number>()
  const sources = graph.nodes.filter((n) => n.kind === 'source').length
  const preds = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]))
  for (const e of forward) preds.get(e.target)!.push(e.source)
  const ranks = [...byRank.keys()].sort((a, b) => a - b)
  for (const r of ranks) {
    let ids = byRank.get(r)!
    if (sources > 1 && r > 0) {
      const want = new Map(
        ids.map((id) => {
          const from = preds.get(id)!.filter((p) => minor.has(p))
          return [id, from.length ? from.reduce((s, p) => s + minor.get(p)!, 0) / from.length : 0] as const
        }),
      )
      ids = [...ids].sort((a, b) => want.get(a)! - want.get(b)!)
      const at = ids.map((id) => want.get(id)!)
      for (let i = 1; i < at.length; i++) at[i] = Math.max(at[i], at[i - 1] + MINOR_GAP)
      // Pushing only goes right; shift back so the rank keeps its mean.
      const drift = at.reduce((s, x, i) => s + x - want.get(ids[i])!, 0) / at.length
      ids.forEach((id, i) => minor.set(id, at[i] - drift))
    } else {
      const span = (ids.length - 1) * MINOR_GAP
      ids.forEach((id, i) => minor.set(id, i * MINOR_GAP - span / 2))
    }
  }

  const pos = new Map<string, Positioned>()
  for (const [r, ids] of byRank) {
    for (const id of ids) {
      const major = r * MAJOR_GAP[direction]
      // Bottom-to-top: the source (rank 0) sits at the bottom, so higher ranks
      // move up the screen (negative y, since React Flow's y grows downward).
      const x = direction === 'BT' ? minor.get(id)! : major
      const y = direction === 'BT' ? -major : minor.get(id)!
      pos.set(id, { id, rank: r, x, y })
    }
  }
  return pos
}
