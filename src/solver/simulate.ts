// Steady-state flow simulator for a load-balancer graph.
//
// Every splitter divides its total inflow evenly across its outgoing belts and
// every merger sums its inflows, so the whole network is a linear system driven
// by the source. Because any cycle must pass through at least one splitter that
// only sends a fraction of its inflow around the loop, every loop has gain < 1
// and simple fixed-point iteration converges geometrically. We iterate edge
// flows until they stop changing, which doubles as a verifier for loop designs.

import type { Graph } from './types'

export interface SimResult {
  /** flow per edge id. */
  edgeFlow: Map<string, number>
  /** total inflow per node id. */
  nodeInflow: Map<string, number>
  converged: boolean
  iterations: number
}

export function simulate(
  graph: Graph,
  inputRate: number,
  opts: { maxIter?: number; eps?: number } = {},
): SimResult {
  const maxIter = opts.maxIter ?? 10_000
  const eps = opts.eps ?? 1e-9

  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  for (const n of graph.nodes) {
    outgoing.set(n.id, [])
    incoming.set(n.id, [])
  }
  for (const e of graph.edges) {
    outgoing.get(e.source)!.push(e.id)
    incoming.get(e.target)!.push(e.id)
  }

  const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind] as const))
  const edgeById = new Map(graph.edges.map((e) => [e.id, e] as const))
  const edgeFlow = new Map<string, number>(graph.edges.map((e) => [e.id, 0]))

  let converged = false
  let iterations = 0
  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1
    let maxDelta = 0

    for (const n of graph.nodes) {
      const kind = kindOf.get(n.id)!
      const outs = outgoing.get(n.id)!

      let outPerEdge: number
      if (kind === 'source') {
        // The source injects the fixed input rate, divided across its belts
        // (normally exactly one).
        outPerEdge = outs.length ? inputRate / outs.length : 0
      } else if (kind === 'sink') {
        continue // sinks have no outgoing belts
      } else {
        const inflow = incoming
          .get(n.id)!
          .reduce((s, id) => s + edgeFlow.get(id)!, 0)
        if (kind === 'splitter') {
          outPerEdge = outs.length ? inflow / outs.length : 0
        } else {
          // merger: single outgoing belt carries the whole inflow
          outPerEdge = outs.length ? inflow / outs.length : 0
        }
      }

      for (const id of outs) {
        const prev = edgeFlow.get(id)!
        if (Math.abs(prev - outPerEdge) > maxDelta) {
          maxDelta = Math.abs(prev - outPerEdge)
        }
        edgeFlow.set(id, outPerEdge)
      }
    }

    if (maxDelta < eps) {
      converged = true
      break
    }
  }

  const nodeInflow = new Map<string, number>()
  for (const n of graph.nodes) {
    nodeInflow.set(
      n.id,
      incoming.get(n.id)!.reduce((s, id) => s + edgeFlow.get(id)!, 0),
    )
  }

  // Keep edge objects in sync for consumers that read graph.edges directly.
  for (const [id, flow] of edgeFlow) edgeById.get(id)!.flow = flow

  return { edgeFlow, nodeInflow, converged, iterations }
}
