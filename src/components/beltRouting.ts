// Lane assignment for belt edges.
//
// React Flow draws each step edge on its own, so belts between nearby nodes
// often end up on the exact same line and become impossible to tell apart.
// Here we predict every belt's orthogonal path and greedily pick, per belt, a
// small sideways shift of its middle segment and a different lead-out length
// from its handles, minimising overlap with other belts and with node bodies.

import { getSmoothStepPath, Position } from '@xyflow/react'

export interface BeltLane {
  /** Sideways shift of the middle segment, in px. */
  shift: number
  /** How far the belt leaves its handles before the first turn, in px. */
  offset: number
}

export interface BeltGeom {
  id: string
  source: string
  target: string
  sx: number
  sy: number
  sp: Position
  tx: number
  ty: number
  tp: Position
}

export interface NodeRect {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export const DEFAULT_LANE: BeltLane = { shift: 0, offset: 20 }

const SHIFTS = [0, 12, -12, 24, -24, 36, -36]
const OFFSETS = [20, 32, 10, 44]
/** Parallel segments closer than this read as one line. */
const TOUCH = 5
const THROUGH_NODE_COST = 400

const DIR: Record<Position, { x: number; y: number }> = {
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
}

/**
 * SVG path for a belt, using React Flow's step routing with our lane tweaks,
 * plus the midpoint of its main segment (where the rate label goes).
 */
export function beltPath(
  sx: number,
  sy: number,
  sp: Position,
  tx: number,
  ty: number,
  tp: Position,
  lane: BeltLane,
  borderRadius: number,
): [path: string, labelX: number, labelY: number] {
  const sd = DIR[sp]
  const td = DIR[tp]
  const sgx = sx + sd.x * lane.offset
  const sgy = sy + sd.y * lane.offset
  const tgx = tx + td.x * lane.offset
  const tgy = ty + td.y * lane.offset
  // Only one of centerX/centerY is used, depending on which way the middle
  // segment runs, so shifting both moves exactly that segment.
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sp,
    targetX: tx,
    targetY: ty,
    targetPosition: tp,
    borderRadius,
    offset: lane.offset,
    centerX: (sgx + tgx) / 2 + lane.shift,
    centerY: (sgy + tgy) / 2 + lane.shift,
  })
  return [path, labelX, labelY]
}

type Pt = [number, number]
type Seg = [Pt, Pt]

function segments(path: string): Seg[] {
  const tokens = path.match(/[MLQ]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []
  const pts: Pt[] = []
  for (let i = 0; i < tokens.length; ) {
    const cmd = tokens[i++]
    if (cmd === 'Q') i += 2 // skip the control point
    const p: Pt = [Number(tokens[i++]), Number(tokens[i++])]
    const last = pts[pts.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p)
  }
  const segs: Seg[] = []
  for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]])
  return segs
}

const isVertical = ([a, b]: Seg) => Math.abs(a[0] - b[0]) < 0.5
const isHorizontal = ([a, b]: Seg) => Math.abs(a[1] - b[1]) < 0.5

function rangeOverlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2))
}

/** Length along which two belts run on (nearly) the same line. */
function overlapLength(a: Seg[], b: Seg[]): number {
  let total = 0
  for (const s of a) {
    for (const t of b) {
      if (isVertical(s) && isVertical(t) && Math.abs(s[0][0] - t[0][0]) < TOUCH) {
        total += Math.max(0, rangeOverlap(s[0][1], s[1][1], t[0][1], t[1][1]))
      } else if (isHorizontal(s) && isHorizontal(t) && Math.abs(s[0][1] - t[0][1]) < TOUCH) {
        total += Math.max(0, rangeOverlap(s[0][0], s[1][0], t[0][0], t[1][0]))
      }
    }
  }
  return total
}

/** Number of segments that run behind a node the belt isn't attached to. */
function throughNodes(belt: BeltGeom, segs: Seg[], nodes: NodeRect[]): number {
  let hits = 0
  for (const [a, b] of segs) {
    for (const n of nodes) {
      if (n.id === belt.source || n.id === belt.target) continue
      const crosses = isVertical([a, b])
        ? a[0] > n.x1 && a[0] < n.x2 && rangeOverlap(a[1], b[1], n.y1, n.y2) > 0
        : a[1] > n.y1 && a[1] < n.y2 && rangeOverlap(a[0], b[0], n.x1, n.x2) > 0
      if (crosses) hits++
    }
  }
  return hits
}

export function routeBelts(belts: BeltGeom[], nodes: NodeRect[]): Map<string, BeltLane> {
  const candidates: BeltLane[] = []
  for (const offset of OFFSETS) for (const shift of SHIFTS) candidates.push({ shift, offset })

  // Every candidate path per belt, precomputed once.
  const options = belts.map((b) =>
    candidates.map((lane) => {
      const [path] = beltPath(b.sx, b.sy, b.sp, b.tx, b.ty, b.tp, lane, 0)
      const segs = segments(path)
      const fixed =
        THROUGH_NODE_COST * throughNodes(b, segs, nodes) +
        0.3 * Math.abs(lane.shift) +
        0.3 * Math.abs(lane.offset - DEFAULT_LANE.offset)
      return { lane, segs, fixed }
    }),
  )

  const chosen: number[] = belts.map(() => -1)
  const cost = (i: number, c: number) => {
    const opt = options[i][c]
    let total = opt.fixed
    for (let j = 0; j < belts.length; j++) {
      if (j === i || chosen[j] < 0) continue
      total += overlapLength(opt.segs, options[j][chosen[j]].segs)
    }
    return total
  }

  // Greedy placement, longest belts first, then a couple of refinement passes
  // where each belt re-picks its lane against everyone else's final choice.
  const span = (b: BeltGeom) => Math.abs(b.sx - b.tx) + Math.abs(b.sy - b.ty)
  const order = belts.map((_, i) => i).sort((a, b) => span(belts[b]) - span(belts[a]))
  for (let pass = 0; pass < 3; pass++) {
    for (const i of order) {
      let best = 0
      let bestCost = Infinity
      for (let c = 0; c < candidates.length; c++) {
        const v = cost(i, c)
        if (v < bestCost - 1e-9) {
          bestCost = v
          best = c
        }
      }
      chosen[i] = best
    }
  }

  return new Map(belts.map((b, i) => [b.id, candidates[chosen[i]]]))
}
