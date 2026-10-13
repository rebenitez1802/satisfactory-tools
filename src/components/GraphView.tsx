import { useMemo } from 'react'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { layoutGraph } from '../solver'
import type { SolveResult } from '../solver'

interface NodeData {
  title: string
  sub?: string
  [key: string]: unknown
}

function round(n: number | undefined): string {
  if (n === undefined) return ''
  return Number(n.toFixed(3)).toString()
}

function SourceNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div className="rf-node rf-source">
      <div className="rf-title">{data.title}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function SinkNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div className="rf-node rf-sink">
      <Handle type="target" position={Position.Left} />
      <div className="rf-title">{data.title}</div>
    </div>
  )
}

function SplitterNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div className="rf-node rf-splitter">
      <Handle type="target" position={Position.Left} />
      <div className="rf-kind">Splitter</div>
      <div className="rf-sub">{data.sub}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function MergerNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div className="rf-node rf-merger">
      <Handle type="target" position={Position.Left} />
      <div className="rf-kind">Merger</div>
      <div className="rf-sub">{data.sub}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes = {
  source: SourceNode,
  sink: SinkNode,
  splitter: SplitterNode,
  merger: MergerNode,
}

export function GraphView({ result }: { result: SolveResult }) {
  const { nodes, edges, signature } = useMemo(() => {
    const graph = result.graph!
    const pos = layoutGraph(graph)

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
      let title = n.label ?? n.id
      let sub: string | undefined
      if (n.kind === 'splitter') sub = `÷${outdeg.get(n.id)}`
      if (n.kind === 'merger') sub = `${indeg.get(n.id)}→1`
      return {
        id: n.id,
        type: n.kind,
        position: { x: p.x, y: p.y },
        data: { title, sub },
      }
    })

    const rfEdges: Edge[] = graph.edges.map((e) => {
      const over = overCapacity.has(e.id)
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: round(e.flow),
        type: e.feedback ? 'smoothstep' : 'default',
        animated: e.feedback,
        className: [e.feedback ? 'edge-feedback' : '', over ? 'edge-over' : '']
          .filter(Boolean)
          .join(' '),
      }
    })

    // Signature forces a refit when the topology changes.
    const signature = `${graph.nodes.length}:${graph.edges.length}:${result.N}:${result.leafCount}`
    return { nodes: rfNodes, edges: rfEdges, signature }
  }, [result])

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
