import { useMemo } from 'react'
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

interface HandleSpec {
  id: string
  type: 'source' | 'target'
  position: Position
}

interface NodeData {
  title: string
  sub?: string
  handles: HandleSpec[]
  [key: string]: unknown
}

function round(n: number | undefined): string {
  if (n === undefined) return ''
  return Number(n.toFixed(3)).toString()
}

const SIDE_VEC: Record<Position, { x: number; y: number }> = {
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
}

const ALL_SIDES = [Position.Left, Position.Right, Position.Top, Position.Bottom]

/**
 * Assign every belt its own handle on a distinct side of each node. Splitters
 * and mergers have at most 4 connections, so each gets its own side. We pick the
 * side that best faces the connected node, biased so inputs still prefer the
 * upstream side and outputs the downstream side.
 */
function assignHandles(graph: SolveResult['graph'], pos: ReturnType<typeof layoutGraph>, dir: Direction) {
  const g = graph!
  const incoming = dir === 'BT' ? Position.Bottom : Position.Left
  const outgoing = dir === 'BT' ? Position.Top : Position.Right

  interface Inc {
    edgeId: string
    type: 'source' | 'target'
    other: string
  }
  const incident = new Map<string, Inc[]>()
  const add = (id: string, i: Inc) => {
    const a = incident.get(id)
    if (a) a.push(i)
    else incident.set(id, [i])
  }
  for (const e of g.edges) {
    add(e.source, { edgeId: e.id, type: 'source', other: e.target })
    add(e.target, { edgeId: e.id, type: 'target', other: e.source })
  }

  const nodeHandles = new Map<string, HandleSpec[]>()
  const edgeHandles = new Map<string, { source: string; target: string }>()
  const edgeHandle = (id: string) => {
    let x = edgeHandles.get(id)
    if (!x) {
      x = { source: '', target: '' }
      edgeHandles.set(id, x)
    }
    return x
  }

  for (const n of g.nodes) {
    const here = pos.get(n.id)!
    const incs = incident.get(n.id) ?? []
    const scored: { inc: Inc; side: Position; score: number }[] = []
    for (const inc of incs) {
      const o = pos.get(inc.other)!
      let dx = o.x - here.x
      let dy = o.y - here.y
      const len = Math.hypot(dx, dy) || 1
      dx /= len
      dy /= len
      for (const s of ALL_SIDES) {
        const v = SIDE_VEC[s]
        let score = dx * v.x + dy * v.y
        if (inc.type === 'target' && s === incoming) score += 0.4
        if (inc.type === 'source' && s === outgoing) score += 0.4
        scored.push({ inc, side: s, score })
      }
    }
    scored.sort((a, b) => b.score - a.score)

    const usedSide = new Set<Position>()
    const doneEdge = new Set<string>()
    const handles: HandleSpec[] = []
    for (const p of scored) {
      if (doneEdge.has(p.inc.edgeId) || usedSide.has(p.side)) continue
      doneEdge.add(p.inc.edgeId)
      usedSide.add(p.side)
      const id = (p.inc.type === 'source' ? 's_' : 't_') + p.inc.edgeId
      handles.push({ id, type: p.inc.type, position: p.side })
      const eh = edgeHandle(p.inc.edgeId)
      if (p.inc.type === 'source') eh.source = id
      else eh.target = id
    }
    nodeHandles.set(n.id, handles)
  }
  return { nodeHandles, edgeHandles }
}

function renderHandles(handles: HandleSpec[]) {
  return handles.map((h) => (
    <Handle
      key={h.id}
      id={h.id}
      type={h.type}
      position={h.position}
      className={h.type === 'source' ? 'h-out' : 'h-in'}
    />
  ))
}

function SourceNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div className="rf-endpoint">
      <div className="rf-tri rf-tri-down" />
      <div className="rf-caption rf-caption-source">{data.title}</div>
      {renderHandles(data.handles)}
    </div>
  )
}

function SinkNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div className="rf-endpoint">
      <div className="rf-tri rf-tri-up" />
      <div className="rf-caption rf-caption-sink">{data.title}</div>
      {renderHandles(data.handles)}
    </div>
  )
}

function SplitterNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div className="rf-node rf-splitter" title={`Splitter ${data.sub}`}>
      <div className="rf-glyph">S</div>
      <div className="rf-sub">{data.sub}</div>
      {renderHandles(data.handles)}
    </div>
  )
}

function MergerNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div className="rf-node rf-merger" title={`Merger ${data.sub}`}>
      <div className="rf-glyph">M</div>
      <div className="rf-sub">{data.sub}</div>
      {renderHandles(data.handles)}
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

    // Place each belt on its own side of each node, facing the node it links to.
    const { nodeHandles, edgeHandles } = assignHandles(graph, pos, direction)

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
        data: { title, sub, handles: nodeHandles.get(n.id) ?? [] },
      }
    })

    const rfEdges: Edge[] = graph.edges.map((e) => {
      const over = overCapacity.has(e.id)
      const eh = edgeHandles.get(e.id)
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: eh?.source,
        targetHandle: eh?.target,
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
