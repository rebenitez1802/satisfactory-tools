import { useMemo, type CSSProperties } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { layoutGraph } from '../solver'
import type { Direction, SolveResult } from '../solver'

interface NodeData {
  title: string
  sub?: string
  dir: Direction
  inCount: number
  outCount: number
  [key: string]: unknown
}

function round(n: number | undefined): string {
  if (n === undefined) return ''
  return Number(n.toFixed(3)).toString()
}

// Handle sides follow the flow direction. Bottom-to-top: belts enter from below
// and leave from the top. Left-to-right: enter from the left, leave on the right.
const targetSide = (dir: Direction) => (dir === 'BT' ? Position.Bottom : Position.Left)
const sourceSide = (dir: Direction) => (dir === 'BT' ? Position.Top : Position.Right)

// Spread `count` handles evenly along a node side so every belt gets its own
// visible connection point (2 vs 3 ways is countable at a glance).
function handleOffset(pos: Position, i: number, count: number): CSSProperties {
  const pct = `${((i + 1) / (count + 1)) * 100}%`
  return pos === Position.Left || pos === Position.Right ? { top: pct } : { left: pct }
}

/** Render `count` handles of one type, each with a stable id (`t0`, `s1`, …). */
function Handles({
  type,
  count,
  position,
}: {
  type: 'source' | 'target'
  count: number
  position: Position
}) {
  const prefix = type === 'source' ? 's' : 't'
  const cls = type === 'source' ? 'h-out' : 'h-in'
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Handle
          key={`${prefix}${i}`}
          id={`${prefix}${i}`}
          type={type}
          position={position}
          className={cls}
          style={handleOffset(position, i, count)}
        />
      ))}
    </>
  )
}

function SourceNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div className="rf-endpoint">
      <div className="rf-tri rf-tri-down" />
      <div className="rf-caption rf-caption-source">{data.title}</div>
      <Handles type="source" count={data.outCount} position={sourceSide(data.dir)} />
    </div>
  )
}

function SinkNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div className="rf-endpoint">
      <Handles type="target" count={data.inCount} position={targetSide(data.dir)} />
      <div className="rf-tri rf-tri-up" />
      <div className="rf-caption rf-caption-sink">{data.title}</div>
    </div>
  )
}

function SplitterNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div className="rf-node rf-splitter" title={`Splitter ${data.sub}`}>
      <Handles type="target" count={data.inCount} position={targetSide(data.dir)} />
      <div className="rf-glyph">S</div>
      <div className="rf-sub">{data.sub}</div>
      <Handles type="source" count={data.outCount} position={sourceSide(data.dir)} />
    </div>
  )
}

function MergerNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div className="rf-node rf-merger" title={`Merger ${data.sub}`}>
      <Handles type="target" count={data.inCount} position={targetSide(data.dir)} />
      <div className="rf-glyph">M</div>
      <div className="rf-sub">{data.sub}</div>
      <Handles type="source" count={data.outCount} position={sourceSide(data.dir)} />
    </div>
  )
}

const nodeTypes = {
  source: SourceNode,
  sink: SinkNode,
  splitter: SplitterNode,
  merger: MergerNode,
}

export function GraphView({
  result,
  direction,
}: {
  result: SolveResult
  direction: Direction
}) {
  const { nodes, edges, signature } = useMemo(() => {
    const graph = result.graph!
    const pos = layoutGraph(graph, direction)

    const outdeg = new Map<string, number>()
    const indeg = new Map<string, number>()
    for (const n of graph.nodes) {
      outdeg.set(n.id, 0)
      indeg.set(n.id, 0)
    }
    for (const e of graph.edges) {
      outdeg.set(e.source, (outdeg.get(e.source) ?? 0) + 1)
      indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
    }

    const overCapacity = new Set<string>()
    for (const w of result.warnings) {
      if (w.kind === 'belt-over-capacity' && w.edgeIds) {
        for (const id of w.edgeIds) overCapacity.add(id)
      }
    }

    const rfNodes: Node<NodeData>[] = graph.nodes.map((n) => {
      const p = pos.get(n.id)!
      const title = n.label ?? n.id
      const inCount = indeg.get(n.id) ?? 0
      const outCount = outdeg.get(n.id) ?? 0
      let sub: string | undefined
      if (n.kind === 'splitter') sub = `÷${outCount}`
      if (n.kind === 'merger') sub = `${inCount}→1`
      return {
        id: n.id,
        type: n.kind,
        position: { x: p.x, y: p.y },
        data: { title, sub, dir: direction, inCount, outCount },
      }
    })

    // Assign each belt its own source/target handle so every connection is a
    // distinct line (counting 2- vs 3-ways becomes visual).
    const outIdx = new Map<string, number>()
    const inIdx = new Map<string, number>()
    const rfEdges: Edge[] = graph.edges.map((e) => {
      const over = overCapacity.has(e.id)
      const si = outIdx.get(e.source) ?? 0
      const ti = inIdx.get(e.target) ?? 0
      outIdx.set(e.source, si + 1)
      inIdx.set(e.target, ti + 1)
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: `s${si}`,
        targetHandle: `t${ti}`,
        label: round(e.flow),
        // Straight orthogonal (right-angle) segments, like the hand-drawn
        // reference diagrams. Feedback belts get an arrowhead so their
        // (backward) direction is unmistakable.
        type: 'step',
        animated: e.feedback,
        markerEnd: e.feedback
          ? { type: MarkerType.ArrowClosed, color: '#f59e0b', width: 16, height: 16 }
          : undefined,
        className: [e.feedback ? 'edge-feedback' : '', over ? 'edge-over' : '']
          .filter(Boolean)
          .join(' '),
      }
    })

    // Signature forces a refit when the topology or direction changes.
    const signature = `${direction}:${graph.nodes.length}:${graph.edges.length}:${result.N}:${result.leafCount}`
    return { nodes: rfNodes, edges: rfEdges, signature }
  }, [result, direction])

  return (
    <div className="graph-canvas">
      <ReactFlow
        key={signature}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        defaultEdgeOptions={{ labelBgPadding: [4, 2] }}
      >
        <Background gap={20} color="#243040" />
        <Controls />
        <MiniMap
          pannable
          zoomable
          nodeColor={miniMapColor}
          nodeStrokeWidth={0}
          bgColor="#0d1117"
          maskColor="rgba(5, 8, 12, 0.6)"
        />
      </ReactFlow>
    </div>
  )
}

function miniMapColor(node: Node): string {
  switch (node.type) {
    case 'source':
      return '#f59e0b'
    case 'sink':
      return '#22c55e'
    case 'merger':
      return '#38bdf8'
    default:
      return '#94a3b8'
  }
}
