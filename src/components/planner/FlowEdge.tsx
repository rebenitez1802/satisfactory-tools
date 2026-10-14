import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useInternalNode,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'
import type { ItemId } from '../../catalog'
import { fmt } from './format'
import { Icon } from './Icon'
import { usePlanner } from './plannerContext'

/** How far before its consumer an angled belt turns (about half a tidy-layout column gap). */
const TURN_BEFORE = 40

/** How far a belt running back to an earlier card sticks out sideways and below. */
const LOOP_OUT = 18
const LOOP_BELOW = 26

export type FlowEdgeData = { item: ItemId; perMin: number; overCapacity?: number }
export type PlanFlowEdge = Edge<FlowEdgeData>

/** A belt or pipe: colored by item form, labeled with its item and rate. */
export function FlowEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
  selected,
}: EdgeProps<PlanFlowEdge>) {
  const { catalog, edgeStyle } = usePlanner()
  const from = useInternalNode(source)
  const to = useInternalNode(target)
  const loop = edgeStyle === 'step' ? loopBelow(from, to, sourceX, sourceY, targetX, targetY) : undefined
  const [path, labelX, labelY] = loop
    ? loop
    : edgeStyle === 'curved'
      ? getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
      : edgeStyle === 'straight'
        ? getStraightPath({ sourceX, sourceY, targetX, targetY })
        : getSmoothStepPath({
            sourceX,
            sourceY,
            sourcePosition,
            targetX,
            targetY,
            targetPosition,
            borderRadius: 8,
            offset: 18,
            // Turn in the gap just before the consumer rather than halfway:
            // a belt skipping a column then runs past it instead of under a card.
            centerX: targetX > sourceX ? Math.max((sourceX + targetX) / 2, targetX - TURN_BEFORE) : undefined,
          })
  const item = data ? catalog.items.get(data.item) : undefined
  const fluid = item && item.form !== 'solid'
  const idle = !data || data.perMin <= 1e-6
  const over = data?.overCapacity !== undefined
  const stroke = over ? '#ef4444' : fluid ? (item?.color ?? '#38bdf8') : '#8aa0b8'

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke,
          strokeWidth: selected ? 4 : fluid ? 3.5 : 2.5,
          strokeDasharray: idle ? '4 6' : undefined,
          opacity: idle ? 0.5 : 1,
        }}
      />
      {data && item && (
        <EdgeLabelRenderer>
          <div
            className={`pn-edge-label nodrag nopan${over ? ' over' : ''}${selected ? ' selected' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title={over ? `Over the ${fmt(data.overCapacity!)}/min ${fluid ? 'pipe' : 'belt'} limit` : item.name}
          >
            <Icon of={item} size={16} />
            {fmt(data.perMin)}
            {fluid ? ' m³' : ''}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

type Box = ReturnType<typeof useInternalNode>

/**
 * A belt running back to a card on the same row (a recycling or packaging
 * loop) would be drawn straight through both cards. Route it around under
 * them instead: out, down, back, up, in.
 */
function loopBelow(from: Box, to: Box, sx: number, sy: number, tx: number, ty: number): [string, number, number] | undefined {
  if (!from || !to || tx > sx + 2 * LOOP_OUT) return undefined
  const top = (n: NonNullable<Box>) => n.internals.positionAbsolute.y
  const bottom = (n: NonNullable<Box>) => top(n) + (n.measured.height ?? 0)
  if (top(from) > bottom(to) || top(to) > bottom(from)) return undefined
  const y = Math.max(bottom(from), bottom(to)) + LOOP_BELOW
  const points = [
    [sx, sy],
    [sx + LOOP_OUT, sy],
    [sx + LOOP_OUT, y],
    [tx - LOOP_OUT, y],
    [tx - LOOP_OUT, ty],
    [tx, ty],
  ]
  return [rounded(points, 8), (sx + tx) / 2, y]
}

/** A polyline through right-angle corners, rounded like the other belts. */
function rounded(points: number[][], radius: number): string {
  let d = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1]
    const [x, y] = points[i]
    const [nx, ny] = points[i + 1]
    const r = Math.min(radius, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2)
    const a = [x - Math.sign(x - px) * r, y - Math.sign(y - py) * r]
    const b = [x + Math.sign(nx - x) * r, y + Math.sign(ny - y) * r]
    d += ` L ${a[0]} ${a[1]} Q ${x} ${y} ${b[0]} ${b[1]}`
  }
  const [lx, ly] = points[points.length - 1]
  return `${d} L ${lx} ${ly}`
}

export const edgeTypes = { flow: FlowEdge }
