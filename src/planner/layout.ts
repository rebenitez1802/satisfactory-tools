// Tidy layout: arranges plan nodes left to right, resources → goals, with
// dagre's layered layout (rank by belt direction, order each column to cut
// crossings, then place). It only moves nodes; the plan stays the same.
//
// - Each connected chain is laid out on its own and the chains are stacked
//   top to bottom in their current vertical order, so separate lines never
//   interleave.
// - Columns are our own (`rankLeft`), not dagre's default network simplex:
//   that one minimises total belt length but breaks ties arbitrarily, e.g. it
//   may put Iron Plates right before the assembler instead of beside the
//   rods. Here every node starts as far left as its inputs allow, then moves
//   only if that shortens its belts: resource nodes slide right up to their
//   first consumer, a node feeding several far-off consumers slides toward
//   them.
// - Loops (recycling, packaging) are broken by a depth-first search that
//   starts from the chain's sources, so the belt that closes a loop is the
//   one drawn backwards, not a belt of the main line.
// - Laying out a subset (Tidy selection, auto-built nodes) keeps every other
//   node where it is. Fixed nodes that touch the subset are laid out with it,
//   so columns and order respect them, and the one with the most belts to
//   the subset (a consumer, on a tie) is the anchor: the subset is moved so
//   the anchor lands where it really is. With no anchor it keeps its top-left
//   corner. Either way it then steps down past any fixed card it would cover.
//
// Node sizes come from the caller (React Flow's measured sizes), so this
// stays free of the UI.

import dagre, { type EdgeLabel, type Graph, type NodeLabel } from '@dagrejs/dagre'
import type { Plan } from './types'

export interface Size {
  w: number
  h: number
}

export interface LayoutOptions {
  /** Lay out only these nodes; the others stay put. Default: every node. */
  only?: Iterable<string>
  /** Gap between columns, wide enough for a belt label. */
  rankSep?: number
  /** Gap between cards in a column. */
  nodeSep?: number
  /** Gap between separate chains stacked vertically. */
  chainSep?: number
}

/** Used for nodes that haven't been measured yet. */
export const DEFAULT_SIZE: Size = { w: 170, h: 100 }

type Pos = { x: number; y: number }

/** New top-left positions for the laid-out nodes (only those that move). */
export function layoutPlan(plan: Plan, sizes: ReadonlyMap<string, Size>, opts: LayoutOptions = {}): Map<string, Pos> {
  const { rankSep = 90, nodeSep = 36, chainSep = 70 } = opts
  const sizeOf = (id: string) => sizes.get(id) ?? DEFAULT_SIZE
  const byId = new Map(plan.nodes.map((n) => [n.id, n]))
  const moving = new Set(opts.only ? [...opts.only].filter((id) => byId.has(id)) : byId.keys())
  if (!moving.size) return new Map()

  // Belts between moving nodes, and the fixed nodes they touch, scored to
  // pick the anchor: one point per belt, a little more for consumers.
  const anchors = new Map<string, number>()
  const links: [string, string][] = []
  for (const e of plan.edges) {
    if (e.source === e.target || !byId.has(e.source) || !byId.has(e.target)) continue
    const s = moving.has(e.source)
    const t = moving.has(e.target)
    if (!s && !t) continue
    if (!s) anchors.set(e.source, (anchors.get(e.source) ?? 0) + 1)
    if (!t) anchors.set(e.target, (anchors.get(e.target) ?? 0) + 1.1)
    links.push([e.source, e.target])
  }
  // Plan order, but sources first, so loop breaking starts from them.
  const hasInput = new Set(links.map(([, t]) => t))
  const members = plan.nodes
    .map((n) => n.id)
    .filter((id) => moving.has(id) || anchors.has(id))
    .sort((a, b) => Number(hasInput.has(a)) - Number(hasInput.has(b)))

  const chains = components(members, links)
  // Keep the chains' current top-to-bottom order.
  const top = (chain: string[]) => Math.min(...chain.map((id) => byId.get(id)!.position.y))
  chains.sort((a, b) => top(a) - top(b))

  const placed = new Map<string, Pos>()
  let y = 0
  for (const chain of chains) {
    const inChain = new Set(chain)
    const local = layoutChain(chain, links.filter(([s]) => inChain.has(s)), sizeOf, rankSep, nodeSep)
    const box = bounds([...local].map(([id, p]) => ({ ...p, ...sizeOf(id) })))
    for (const [id, p] of local) placed.set(id, { x: p.x - box.x, y: p.y - box.y + y })
    y += box.h + chainSep
  }

  // Move the result into place.
  let dx: number
  let dy: number
  const anchor = [...anchors].reduce<[string, number] | undefined>((best, a) => (!best || a[1] > best[1] ? a : best), undefined)
  if (anchor) {
    dx = byId.get(anchor[0])!.position.x - placed.get(anchor[0])!.x
    dy = byId.get(anchor[0])!.position.y - placed.get(anchor[0])!.y
  } else {
    const was = bounds([...moving].map((id) => ({ ...byId.get(id)!.position, ...sizeOf(id) })))
    dx = was.x
    dy = was.y
  }
  const rect = (id: string, p: Pos) => ({ x: p.x + dx, y: p.y + dy, ...sizeOf(id) })
  const fixedRects = plan.nodes.filter((n) => !moving.has(n.id)).map((n) => ({ ...n.position, ...sizeOf(n.id) }))
  for (let i = 0; i < 100; i++) {
    let hit: (Pos & Size) | undefined
    let over: (Pos & Size) | undefined
    for (const id of moving) {
      over = rect(id, placed.get(id)!)
      hit = fixedRects.find((f) => overlaps(over!, f, CLEARANCE))
      if (hit) break
    }
    if (!hit || !over) break
    dy += hit.y + hit.h + CLEARANCE - over.y
  }
  const out = new Map<string, Pos>()
  for (const id of moving) {
    const p = placed.get(id)!
    out.set(id, { x: Math.round(p.x + dx), y: Math.round(p.y + dy) })
  }
  return out
}

/** Space kept between a laid-out subset and the cards around it. */
const CLEARANCE = 24

const overlaps = (a: Pos & Size, b: Pos & Size, margin: number) =>
  a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin

/** One connected chain through dagre; top-left positions. */
function layoutChain(
  ids: string[],
  links: [string, string][],
  sizeOf: (id: string) => Size,
  rankSep: number,
  nodeSep: number,
): Map<string, Pos> {
  const g = new dagre.graphlib.Graph()
  // dagre accepts a ranking function at runtime; its types only list the built-in names.
  g.setGraph({ rankdir: 'LR', ranksep: rankSep, nodesep: nodeSep, ranker: rankLeft as unknown as 'network-simplex' })
  g.setDefaultEdgeLabel(() => ({}))
  for (const id of ids) {
    const { w, h } = sizeOf(id)
    g.setNode(id, { width: w, height: h })
  }
  // Several belts between the same two nodes pull them together harder.
  for (const [s, t] of links) {
    const label = g.edge(s, t) as { weight?: number } | undefined
    g.setEdge(s, t, { weight: (label?.weight ?? 0) + 1, minlen: 1 })
  }
  dagre.layout(g)
  const out = new Map<string, Pos>()
  for (const id of ids) {
    const n = g.node(id) as { x: number; y: number; width: number; height: number }
    out.set(id, { x: n.x - n.width / 2, y: n.y - n.height / 2 })
  }
  return out
}

/**
 * Assigns `rank` (column) to every node of dagre's ranking graph, which is
 * acyclic by then and may hold helper nodes and zero-weight edges of its own.
 * Start as far left as the inputs allow; then, from the right, move a node
 * toward whichever side has more belt weight (inputs → left, outputs →
 * right). Each move shortens the belts, so it settles.
 */
function rankLeft(g: Graph<unknown, NodeLabel, EdgeLabel>): void {
  const order = topoOrder(g)
  const rank = new Map<string, number>()
  const minlen = (e: { v: string; w: string; name?: string }) => g.edge(e)?.minlen ?? 1
  const weight = (e: { v: string; w: string; name?: string }) => g.edge(e)?.weight ?? 1
  for (const v of order) rank.set(v, Math.max(0, ...(g.inEdges(v) ?? []).map((e) => rank.get(e.v)! + minlen(e))))
  for (let pass = 0; pass < 20; pass++) {
    let moved = false
    for (const v of [...order].reverse()) {
      const ins = g.inEdges(v) ?? []
      const outs = g.outEdges(v) ?? []
      const inW = ins.reduce((a, e) => a + weight(e), 0)
      const outW = outs.reduce((a, e) => a + weight(e), 0)
      const lo = Math.max(0, ...ins.map((e) => rank.get(e.v)! + minlen(e)))
      const hi = outs.length ? Math.min(...outs.map((e) => rank.get(e.w)! - minlen(e))) : rank.get(v)!
      const next = outW > inW ? hi : inW > outW ? lo : rank.get(v)!
      if (next !== rank.get(v)) {
        rank.set(v, next)
        moved = true
      }
    }
    if (!moved) break
  }
  // Ends of the line (goals, open ends) share the last column, so a goal
  // never sits in the way of belts running past it.
  const last = Math.max(...rank.values())
  for (const v of order) if (!(g.outEdges(v) ?? []).length && (g.inEdges(v) ?? []).length) rank.set(v, last)
  for (const v of order) g.node(v).rank = rank.get(v)
}

function topoOrder(g: Graph<unknown, NodeLabel, EdgeLabel>): string[] {
  const indeg = new Map(g.nodes().map((v) => [v, (g.inEdges(v) ?? []).length]))
  const queue = g.nodes().filter((v) => indeg.get(v) === 0)
  const out: string[] = []
  while (queue.length) {
    const v = queue.shift()!
    out.push(v)
    for (const e of g.outEdges(v) ?? []) {
      indeg.set(e.w, indeg.get(e.w)! - 1)
      if (indeg.get(e.w) === 0) queue.push(e.w)
    }
  }
  return out
}

/** Connected components, each in `ids` order, ordered by first member. */
function components(ids: string[], links: [string, string][]): string[][] {
  const parent = new Map(ids.map((id) => [id, id]))
  const find = (id: string): string => {
    let r = id
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(id, r)
    return r
  }
  for (const [s, t] of links) parent.set(find(s), find(t))
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const r = find(id)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r)!.push(id)
  }
  return [...groups.values()]
}

function bounds(rects: (Pos & Size)[]): Pos & Size {
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  const right = Math.max(...rects.map((r) => r.x + r.w))
  const bottom = Math.max(...rects.map((r) => r.y + r.h))
  return { x, y, w: right - x, h: bottom - y }
}
