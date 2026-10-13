import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useUpdateNodeInternals,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { layoutGraph } from '../solver'
import type { Direction, SolveResult } from '../solver'
import {
  DEFAULT_LANE,
  beltPath,
  routeBelts,
  type BeltGeom,
  type BeltLane,
  type NodeRect,
} from './beltRouting'

interface HandleSpec {
  id: string
  type: 'source' | 'target'
  position: Position
  /** Rate on this belt, shown on the handle itself. */
  flow: number
}

interface NodeData {
  title: string
  sub?: string
  leftover?: boolean
  handles: HandleSpec[]
  /** Show each belt's rate on its handle instead of a plain dot. */
  badges: boolean
  [key: string]: unknown
}

function round(n: number | undefined): string {
  if (n === undefined) return ''
  return Number(n.toFixed(3)).toString()
}

/** Compact rate for the small badge on each belt end. */
function short(n: number | undefined): string {
  return Number((n ?? 0).toFixed(1)).toString()
}

const SIDE_VEC: Record<Position, { x: number; y: number }> = {
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
}

// Cap auto-fit zoom so small graphs don't balloon, and pad enough to keep the
// floating captions (outside the node bounds) inside the canvas.
const FIT_VIEW = { padding: 0.25, maxZoom: 1.3 }

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
  const flows = new Map(g.edges.map((e) => [e.id, e.flow ?? 0]))
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
      handles.push({ id, type: p.inc.type, position: p.side, flow: flows.get(p.inc.edgeId) ?? 0 })
      const eh = edgeHandle(p.inc.edgeId)
      if (p.inc.type === 'source') eh.source = id
      else eh.target = id
    }
    nodeHandles.set(n.id, handles)
  }
  return { nodeHandles, edgeHandles }
}

function Handles({ id, data }: NodeProps<Node<NodeData>>) {
  // Badges and dots differ in size, so React Flow must re-measure the handles
  // (where belts attach) whenever the badge toggle flips.
  const updateNodeInternals = useUpdateNodeInternals()
  const prevBadges = useRef(data.badges)
  useEffect(() => {
    if (data.badges === prevBadges.current) return
    prevBadges.current = data.badges
    updateNodeInternals(id)
  }, [id, data.badges, updateNodeInternals])
  return data.handles.map((h) => (
    <Handle
      key={h.id}
      id={h.id}
      type={h.type}
      position={h.position}
      className={`${h.type === 'source' ? 'h-out' : 'h-in'}${data.badges ? ' h-badge' : ''}`}
      title={`${round(h.flow)}/min`}
    >
      {data.badges && short(h.flow)}
    </Handle>
  ))
}

function SourceNode(props: NodeProps<Node<NodeData>>) {
  const { data } = props
  return (
    <div className="rf-endpoint">
      <div className="rf-tri rf-tri-down" />
      <div className="rf-caption rf-caption-source">{data.title}</div>
      <Handles {...props} />
    </div>
  )
}

function SinkNode(props: NodeProps<Node<NodeData>>) {
  const { data } = props
  return (
    <div className={`rf-endpoint${data.leftover ? ' rf-leftover' : ''}`}>
      <div className="rf-tri rf-tri-up" />
      <div className="rf-caption rf-caption-sink">{data.title}</div>
      <Handles {...props} />
    </div>
  )
}

function SplitterNode(props: NodeProps<Node<NodeData>>) {
  const { data } = props
  return (
    <div className="rf-node rf-splitter" title={`Splitter ${data.sub}`}>
      <div className="rf-glyph">S</div>
      <div className="rf-sub">{data.sub}</div>
      <Handles {...props} />
    </div>
  )
}

function MergerNode(props: NodeProps<Node<NodeData>>) {
  const { data } = props
  return (
    <div className="rf-node rf-merger" title={`Merger ${data.sub}`}>
      <div className="rf-glyph">M</div>
      <div className="rf-sub">{data.sub}</div>
      <Handles {...props} />
    </div>
  )
}

const nodeTypes = {
  source: SourceNode,
  sink: SinkNode,
  splitter: SplitterNode,
  merger: MergerNode,
}

interface BeltData {
  lane: BeltLane
  flow: number
  /** Show the rate as a label in the middle of the belt. */
  showLabel?: boolean
  /** Rate badges are on at the belt ends. */
  badges?: boolean
  [key: string]: unknown
}

/** Step belt drawn in the lane picked by the router, with rounded corners. */
function BeltEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
  markerEnd,
  style,
}: EdgeProps<Edge<BeltData>>) {
  const [path, labelX, labelY] = beltPath(
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    data?.lane ?? DEFAULT_LANE,
    6,
  )
  // Short hops between stacked nodes have no room for a mid label, and the
  // badges at both ends already show the rate.
  const roomy = Math.abs(sourceX - targetX) + Math.abs(sourceY - targetY) > MIN_LABEL_SPAN
  const showLabel = data?.showLabel && (!data.badges || roomy)
  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={style}
      label={showLabel ? round(data!.flow) : undefined}
      labelX={labelX}
      labelY={labelY}
      // Opaque chip so the rate stays readable where belts cross.
      labelBgPadding={[6, 3]}
      labelBgBorderRadius={4}
      labelBgStyle={{ fill: '#0d1117', fillOpacity: 0.95, stroke: '#2b3a4d' }}
      labelStyle={{ fill: '#e6edf3', fontSize: 11, fontWeight: 600 }}
    />
  )
}

const edgeTypes = { belt: BeltEdge }

const MIN_LABEL_SPAN = 48

// Rendered node sizes (see .rf-node / .rf-endpoint) and handle badge height,
// used to predict where belts attach before React Flow has measured anything.
const NODE_SIZE: Record<string, { w: number; h: number }> = {
  splitter: { w: 56, h: 56 },
  merger: { w: 56, h: 56 },
  source: { w: 40, h: 34 },
  sink: { w: 40, h: 34 },
}
const DOT = 9
const BADGE_H = 15
const badgeWidth = (flow: number) => Math.max(18, short(flow).length * 5.6 + 10)

/** Pick a lane for every belt given the current node positions (centers). */
function computeLanes(nodes: Node<NodeData>[], edges: Edge[]): Map<string, BeltLane> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const rects: NodeRect[] = nodes.map((n) => {
    const { w, h } = NODE_SIZE[n.type ?? 'splitter']
    return {
      id: n.id,
      x1: n.position.x - w / 2 + 2,
      y1: n.position.y - h / 2 + 2,
      x2: n.position.x + w / 2 - 2,
      y2: n.position.y + h / 2 - 2,
    }
  })
  const anchor = (nodeId: string, handleId: string | null | undefined) => {
    const n = byId.get(nodeId)!
    const h = n.data.handles.find((x) => x.id === handleId)!
    const { w, h: ht } = NODE_SIZE[n.type ?? 'splitter']
    const { x, y } = n.position
    const bh = n.data.badges ? BADGE_H : DOT
    const bw = n.data.badges ? badgeWidth(h.flow) : DOT
    switch (h.position) {
      case Position.Top:
        return { x, y: y - ht / 2 - bh / 2, side: h.position }
      case Position.Bottom:
        return { x, y: y + ht / 2 + bh / 2, side: h.position }
      case Position.Left:
        return { x: x - w / 2 - bw / 2, y, side: h.position }
      default:
        return { x: x + w / 2 + bw / 2, y, side: h.position }
    }
  }
  const belts: BeltGeom[] = edges.map((e) => {
    const s = anchor(e.source, e.sourceHandle)
    const t = anchor(e.target, e.targetHandle)
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sx: s.x,
      sy: s.y,
      sp: s.side,
      tx: t.x,
      ty: t.y,
      tp: t.side,
    }
  })
  return routeBelts(belts, rects)
}

function withLanes(edges: Edge[], lanes: Map<string, BeltLane>): Edge[] {
  return edges.map((e) => ({ ...e, data: { ...e.data, lane: lanes.get(e.id) ?? DEFAULT_LANE } }))
}

function withBadges(nodes: Node<NodeData>[], badges: boolean): Node<NodeData>[] {
  return nodes.map((n) => (n.data.badges === badges ? n : { ...n, data: { ...n.data, badges } }))
}

export function GraphView({
  result,
  direction,
  showLabels,
  showBadges,
}: {
  result: SolveResult
  direction: Direction
  /** Rate label in the middle of each belt. */
  showLabels: boolean
  /** Rate badge on each belt end (instead of a plain dot). */
  showBadges: boolean
}) {
  // Read (not depended on) when building a new graph; toggling it later just
  // restyles the existing one so manual drags survive.
  const badgesRef = useRef(showBadges)
  badgesRef.current = showBadges

  const base = useMemo(() => {
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
        data: {
          title,
          sub,
          leftover: n.leftover,
          handles: nodeHandles.get(n.id) ?? [],
          badges: badgesRef.current,
        },
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
        // Rates are shown on the handle badges at each end, not mid-belt.
        // Orthogonal (right-angle) belts, like the hand-drawn reference
        // diagrams, each in its own lane. Feedback belts get an arrowhead so
        // their (backward) direction is unmistakable.
        type: 'belt',
        data: { lane: DEFAULT_LANE, flow: e.flow ?? 0 },
        animated: e.feedback,
        markerEnd: e.feedback
          ? { type: MarkerType.ArrowClosed, color: '#f59e0b', width: 16, height: 16 }
          : undefined,
        className: [e.feedback ? 'edge-feedback' : '', over ? 'edge-over' : '']
          .filter(Boolean)
          .join(' '),
      }
    })

    // Signature forces a remount (and refit) when topology or direction changes.
    const signature = `${direction}:${graph.nodes.length}:${graph.edges.length}:${result.N}:${result.leafCount}`
    return { nodes: rfNodes, edges: withLanes(rfEdges, computeLanes(rfNodes, rfEdges)), signature }
  }, [result, direction])

  // Draggable, stateful nodes/edges. Whenever the computed graph changes
  // (new inputs or a layout-direction toggle) we re-seed positions and refit;
  // between those changes the user's manual drags are preserved.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>(base.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(base.edges)
  const rf = useRef<ReactFlowInstance<Node<NodeData>, Edge> | null>(null)

  // Highlighting: hovering a belt (or a node, for all its belts) lights it up
  // and dims the rest; clicking pins it until clicked again or the empty
  // canvas is clicked.
  const [hovered, setHovered] = useState<string[]>([])
  const [pinned, setPinned] = useState<{ key: string; ids: string[] } | null>(null)

  useEffect(() => {
    setNodes(base.nodes)
    setEdges(base.edges)
    setPinned(null)
    requestAnimationFrame(() => rf.current?.fitView(FIT_VIEW))
  }, [base, setNodes, setEdges])

  // Badges are bigger than dots, so belts attach further out: restyle the
  // handles and re-pick lanes for the new attachment points.
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  useEffect(() => {
    const next = withBadges(nodesRef.current, showBadges)
    setNodes(next)
    setEdges((es) => withLanes(es, computeLanes(next, es)))
  }, [showBadges, setNodes, setEdges])

  const resetLayout = useCallback(() => {
    setNodes(base.nodes.map((n) => ({ ...n })))
    setEdges(base.edges)
    requestAnimationFrame(() => rf.current?.fitView(FIT_VIEW))
  }, [base, setNodes, setEdges])

  // Re-pick lanes once a dragged node is dropped somewhere new.
  const onNodeDragStop = useCallback(() => {
    setEdges((es) => withLanes(es, computeLanes(nodes, es)))
  }, [nodes, setEdges])

  const edgesOf = useCallback(
    (nodeId: string) => edges.filter((e) => e.source === nodeId || e.target === nodeId).map((e) => e.id),
    [edges],
  )

  // One highlight at a time: clicking something new replaces it, clicking the
  // same belt/node again clears it.
  const togglePinned = useCallback((key: string, ids: string[]) => {
    setPinned((prev) => (prev?.key === key ? null : { key, ids }))
  }, [])

  const displayEdges = useMemo(() => {
    const labelled = edges.map((e) =>
      e.data?.showLabel === showLabels && e.data?.badges === showBadges
        ? e
        : { ...e, data: { ...e.data, showLabel: showLabels, badges: showBadges } },
    )
    const lit = new Set([...(pinned?.ids ?? []), ...hovered])
    if (lit.size === 0) return labelled
    const mark = (e: Edge, on: boolean) => ({
      ...e,
      className: `${e.className ?? ''} ${on ? 'edge-hl' : 'edge-dim'}`,
    })
    // Lit belts go last so they draw over the dimmed ones (but still under nodes).
    return [
      ...labelled.filter((e) => !lit.has(e.id)).map((e) => mark(e, false)),
      ...labelled.filter((e) => lit.has(e.id)).map((e) => mark(e, true)),
    ]
  }, [edges, hovered, pinned, showLabels, showBadges])

  return (
    <div className="graph-canvas">
      <ReactFlow
        nodes={nodes}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onEdgeMouseEnter={(_, e) => setHovered([e.id])}
        onEdgeMouseLeave={() => setHovered([])}
        onNodeMouseEnter={(_, n) => setHovered(edgesOf(n.id))}
        onNodeMouseLeave={() => setHovered([])}
        onEdgeClick={(_, e) => togglePinned(`edge:${e.id}`, [e.id])}
        onNodeClick={(_, n) => togglePinned(`node:${n.id}`, edgesOf(n.id))}
        onPaneClick={() => setPinned(null)}
        // Highlighting replaces React Flow's own selection, which would also
        // let Backspace delete parts of the design.
        elementsSelectable={false}
        deleteKeyCode={null}
        onInit={(inst) => (rf.current = inst)}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // Layout positions are node centers, so differently sized nodes in
        // one column line up and straight belts stay straight.
        nodeOrigin={[0.5, 0.5]}
        fitView
        fitViewOptions={FIT_VIEW}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
      >
        <Panel position="top-right">
          <button type="button" className="rf-reset" onClick={resetLayout}>
            ⟲ Reset layout
          </button>
        </Panel>
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
      return (node.data as NodeData).leftover ? '#ef4444' : '#22c55e'
    case 'merger':
      return '#38bdf8'
    default:
      return '#94a3b8'
  }
}
