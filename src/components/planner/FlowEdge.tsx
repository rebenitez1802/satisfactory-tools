import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'
import type { ItemId } from '../../catalog'
import { fmt } from './format'
import { Icon } from './Icon'
import { usePlanner } from './plannerContext'

export type FlowEdgeData = { item: ItemId; perMin: number; overCapacity?: number }
export type PlanFlowEdge = Edge<FlowEdgeData>

/** A belt or pipe: colored by item form, labeled with its item and rate. */
export function FlowEdge({
  id,
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
  const [path, labelX, labelY] =
    edgeStyle === 'curved'
      ? getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
      : edgeStyle === 'straight'
        ? getStraightPath({ sourceX, sourceY, targetX, targetY })
        : getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 8, offset: 18 })
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

export const edgeTypes = { flow: FlowEdge }
