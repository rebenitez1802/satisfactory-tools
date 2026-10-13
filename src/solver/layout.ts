// Assign (x, y) positions to graph nodes using longest-path layering.
//
// Feedback edges are ignored when computing layers (otherwise the graph has
// cycles and no topological order); they simply render as belts looping back
// from a deeper layer to a shallower one.

import type { Graph } from './types'

export interface Positioned {
  id: string
  x: number
  y: number
  layer: number
}

const X_GAP = 240
const Y_GAP = 110

export function layoutGraph(graph: Graph): Map<string, Positioned> {
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

  // Kahn topological order over the acyclic (non-feedback) graph.
  const layer = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]))
  const queue = graph.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id)
  const workIndeg = new Map(indeg)
  const order: string[] = []
  while (queue.length) {
    const u = queue.shift()!
    order.push(u)
    for (const v of adj.get(u)!) {
      layer.set(v, Math.max(layer.get(v)!, layer.get(u)! + 1))
      workIndeg.set(v, workIndeg.get(v)! - 1)
      if (workIndeg.get(v) === 0) queue.push(v)
    }
  }

  // Group by layer and stack vertically, centered around 0.
  const byLayer = new Map<number, string[]>()
  for (const n of graph.nodes) {
    const l = layer.get(n.id)!
    if (!byLayer.has(l)) byLayer.set(l, [])
    byLayer.get(l)!.push(n.id)
  }

  const pos = new Map<string, Positioned>()
  for (const [l, ids] of byLayer) {
    const height = (ids.length - 1) * Y_GAP
    ids.forEach((id, i) => {
      pos.set(id, { id, layer: l, x: l * X_GAP, y: i * Y_GAP - height / 2 })
    })
  }
  return pos
}
