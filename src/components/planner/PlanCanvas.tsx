import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  Background,
  ControlButton,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type IsValidConnection,
  type NodeChange,
  type OnConnectStartParams,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ItemId } from '../../catalog'
import {
  connectPorts,
  consumersOf,
  copyNodes,
  createNode,
  goalOptions,
  layoutPlan,
  newNodeId,
  pasteClip,
  placeBeside,
  producersOf,
  removeEdges,
  removeNodes,
  resourceOptions,
  retargetEdges,
} from '../../planner'
import type { AddContext, Clip, PickOption, Plan, PlanEdge, SolveResult } from '../../planner'
import { edgeTypes, type PlanFlowEdge } from './FlowEdge'
import { nodeLabel } from './labels'
import { handleItem, inHandle, nodeTypes, outHandle, type PlanFlowNode } from './nodes'
import { Picker } from './Picker'
import { usePlanner } from './plannerContext'

/** Typical card width, used to place new nodes before they've been measured. */
const CARD_W = 170

/** The plan node under a screen point, if any. */
function nodeAt(x: number, y: number): string | undefined {
  return document.elementFromPoint(x, y)?.closest('.react-flow__node')?.getAttribute('data-id') ?? undefined
}

/** Copied nodes; module-level so they can be pasted into another plan. */
let clipboard: Clip | null = null
let pasteCount = 0

interface PickerState {
  context: AddContext
  /** Node and item the new node connects to (drag-to-add only). */
  anchor?: { node: string; item: ItemId }
  /** Where the picker opens, in pixels relative to the canvas. */
  at: { x: number; y: number }
  /** Where the new node goes, in flow coordinates. */
  flow: { x: number; y: number }
  /** Quick-start lists instead of the free-text palette. */
  preset?: 'resources' | 'goals'
  /** Opened by clicking a port: place the new node beside its node, not at the pointer. */
  beside?: boolean
}

// Fitting never zooms out so far that cards can't be read: a plan too big
// for that stays centered and scrolls. Zooming out by hand stops at
// MIN_ZOOM, still enough to see a whole factory's shape.
const FIT_VIEW = { padding: 0.15, maxZoom: 1, minZoom: 0.55 }
const MIN_ZOOM = 0.3

/**
 * The plan graph on a React Flow canvas. The plan is the source of truth:
 * React Flow keeps its own node list only for drag/selection/measurement, and
 * positions are written back to the plan when a drag ends.
 */
export function PlanCanvas({
  plan,
  setPlan,
  result,
  onSelectionChange,
}: {
  plan: Plan
  setPlan: Dispatch<SetStateAction<Plan>>
  result: SolveResult
  onSelectionChange: (selection: { nodes: string[]; edges: string[] }) => void
}) {
  const [rfNodes, setRfNodes] = useState<PlanFlowNode[]>(() =>
    plan.nodes.map((node) => ({ id: node.id, type: node.kind, position: node.position, data: { node } })),
  )
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set())
  const [picker, setPicker] = useState<PickerState | null>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, flowToScreenPosition, getViewport, setCenter, fitView } = useReactFlow()
  const { catalog, isRecipeHidden } = usePlanner()

  // Nodes to select after the next rebuild (freshly pasted or duplicated ones).
  const pendingSelect = useRef<Set<string> | null>(null)

  // Rebuild from the plan, keeping React Flow's selection and measurements.
  useEffect(() => {
    const select = pendingSelect.current
    pendingSelect.current = null
    setRfNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]))
      return plan.nodes.map((node) => {
        const o = old.get(node.id)
        return {
          id: node.id,
          type: node.kind,
          position: o?.dragging ? o.position : node.position,
          data: { node },
          selected: select ? select.has(node.id) : o?.selected,
          measured: o?.measured,
        }
      })
    })
  }, [plan.nodes])

  // Belts picked up by dragging a connected input; hidden until dropped.
  const [pickedUp, setPickedUp] = useState<{ node: string; item: ItemId; edges: string[] } | null>(null)

  const edges: PlanFlowEdge[] = useMemo(
    () =>
      plan.edges
        .filter((e) => !pickedUp?.edges.includes(e.id))
        .map((e) => {
        const r = result.edges.get(e.id)
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: outHandle(e.item),
          targetHandle: inHandle(e.item),
          type: 'flow',
          selected: selectedEdges.has(e.id),
          data: { item: e.item, perMin: r?.perMin ?? 0, overCapacity: r?.overCapacity },
        }
      }),
    [plan.edges, result, selectedEdges, pickedUp],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<PlanFlowNode>[]) => {
      setRfNodes((ns) => applyNodeChanges(changes, ns))
      const removed = new Set(changes.flatMap((c) => (c.type === 'remove' ? [c.id] : [])))
      if (removed.size) setPlan((p) => removeNodes(p, removed))
    },
    [setPlan],
  )

  const onNodeDragStop = useCallback(
    (_: unknown, __: PlanFlowNode, dragged: PlanFlowNode[]) => {
      const moved = new Map(dragged.map((n) => [n.id, n.position]))
      setPlan((p) => ({
        ...p,
        nodes: p.nodes.map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n)),
      }))
    },
    [setPlan],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<PlanFlowEdge>[]) => {
      setSelectedEdges((sel) => {
        const next = new Set(sel)
        for (const c of changes) {
          if (c.type === 'select') {
            if (c.selected) next.add(c.id)
            else next.delete(c.id)
          }
          if (c.type === 'remove') next.delete(c.id)
        }
        return next
      })
      const removed = new Set(changes.flatMap((c) => (c.type === 'remove' ? [c.id] : [])))
      if (removed.size) setPlan((p) => ({ ...p, edges: p.edges.filter((e) => !removed.has(e.id)) }))
    },
    [setPlan],
  )

  // Belts only join an output to an input of the same item, once.
  const isValidConnection: IsValidConnection = useCallback(
    (c) => {
      if (!c.sourceHandle?.startsWith('out:') || !c.targetHandle?.startsWith('in:')) return false
      const item = handleItem(c.sourceHandle)
      if (item !== handleItem(c.targetHandle) || c.source === c.target) return false
      return !plan.edges.some((e) => e.source === c.source && e.target === c.target && e.item === item)
    },
    [plan.edges],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      const item = handleItem(c.sourceHandle)
      if (!item) return
      const edge: PlanEdge = { id: `${c.source}->${c.target}:${item}`, source: c.source, target: c.target, item }
      const replace = pickedUp?.edges ?? []
      setPlan((p) => {
        const rest = removeEdges(p, replace)
        return rest.edges.some((e) => e.id === edge.id) ? rest : { ...rest, edges: [...rest.edges, edge] }
      })
      setPickedUp(null)
    },
    [setPlan, pickedUp],
  )

  // Grabbing a connected input picks up its belts (Satisfactory Modeler style).
  const onConnectStart = useCallback(
    (_: MouseEvent | TouchEvent, { nodeId, handleId, handleType }: OnConnectStartParams) => {
      const item = handleItem(handleId)
      if (handleType !== 'target' || !nodeId || !item) return
      const ids = plan.edges.filter((e) => e.target === nodeId && e.item === item).map((e) => e.id)
      if (ids.length) setPickedUp({ node: nodeId, item, edges: ids })
    },
    [plan.edges],
  )

  const reportSelection = useCallback(
    ({ nodes, edges }: { nodes: PlanFlowNode[]; edges: PlanFlowEdge[] }) =>
      onSelectionChange({ nodes: nodes.map((n) => n.id), edges: edges.map((e) => e.id) }),
    [onSelectionChange],
  )

  /** Open the picker at a screen point (clamped so it stays on the canvas). */
  const openPicker = useCallback(
    (
      clientX: number,
      clientY: number,
      context: AddContext,
      anchor?: PickerState['anchor'],
      preset?: PickerState['preset'],
      beside?: boolean,
    ) => {
      const box = wrapper.current?.getBoundingClientRect()
      if (!box) return
      const at = {
        x: Math.max(8, Math.min(clientX - box.left, box.width - 348)),
        y: Math.max(8, Math.min(clientY - box.top, box.height - 420)),
      }
      setPicker({ context, anchor, preset, beside, at, flow: screenToFlowPosition({ x: clientX, y: clientY }) })
    },
    [screenToFlowPosition],
  )

  // Where a drag ends decides what happens:
  //   - picked-up belts: onto a node → move them there; onto empty canvas → delete them
  //   - new belt: onto any part of a node → connect its matching port;
  //     onto empty canvas → picker for what could be on the other end
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      const point = 'changedTouches' in event ? event.changedTouches[0] : event
      const target = nodeAt(point.clientX, point.clientY)
      const pick = pickedUp
      setPickedUp(null)
      if (pick) {
        if (state.isValid) return // dropped on a port: onConnect replaced the belts
        if (!target) setPlan((p) => removeEdges(p, pick.edges))
        else if (target !== pick.node) setPlan((p) => retargetEdges(p, catalog, pick.edges, target))
        return
      }
      if (state.isValid || !state.fromHandle?.id || !state.fromNode) return
      const item = handleItem(state.fromHandle.id)
      if (!item) return
      const side = state.fromHandle.id.startsWith('in:') ? 'in' : 'out'
      if (target) {
        setPlan((p) => connectPorts(p, catalog, state.fromNode!.id, item, side, target))
        return
      }
      openPicker(point.clientX, point.clientY, side === 'in' ? 'producer' : 'consumer', { node: state.fromNode.id, item })
    },
    [openPicker, pickedUp, setPlan, catalog],
  )

  // A click (no drag) on an item port opens the picker for it.
  const onClick = useCallback(
    (e: React.MouseEvent) => {
      const handle = (e.target as Element).closest('.react-flow__handle.pn-handle')
      const nodeId = handle?.closest('.react-flow__node')?.getAttribute('data-id')
      const id = handle?.getAttribute('data-handleid')
      const item = handleItem(id)
      if (!nodeId || !id || !item) return
      openPicker(e.clientX + 12, e.clientY, id.startsWith('in:') ? 'producer' : 'consumer', { node: nodeId, item }, undefined, true)
    },
    [openPicker],
  )

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as Element).classList.contains('react-flow__pane')) openPicker(e.clientX, e.clientY, 'palette')
    },
    [openPicker],
  )

  const openPalette = useCallback(
    (preset?: PickerState['preset']) => {
      const box = wrapper.current?.getBoundingClientRect()
      if (box) openPicker(box.left + box.width / 2 - 170, box.top + 60, 'palette', undefined, preset)
    },
    [openPicker],
  )

  const onPick = useCallback(
    (option: PickOption) => {
      if (!picker) return
      const { context, anchor, flow } = picker
      const rects = rfNodesRef.current.map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        w: n.measured?.width ?? CARD_W,
        h: n.measured?.height ?? 100,
      }))
      const anchorRect = picker.beside && anchor ? rects.find((r) => r.id === anchor.node) : undefined
      const position = anchorRect
        ? placeBeside(anchorRect, context === 'producer' ? 'left' : 'right', { w: CARD_W, h: 100 }, rects)
        : {
            x: context === 'producer' ? flow.x - CARD_W - 40 : context === 'consumer' ? flow.x + 40 : flow.x - CARD_W / 2,
            y: flow.y - 40,
          }
      const node = createNode(option, newNodeId(), position, context, catalog)
      const edge: PlanEdge | undefined = anchor
        ? context === 'producer'
          ? { id: `${node.id}->${anchor.node}:${anchor.item}`, source: node.id, target: anchor.node, item: anchor.item }
          : { id: `${anchor.node}->${node.id}:${anchor.item}`, source: anchor.node, target: node.id, item: anchor.item }
        : undefined
      // Select it so the inspector opens right away.
      pendingSelect.current = new Set([node.id])
      setPlan((p) => ({ ...p, nodes: [...p.nodes, node], edges: edge ? [...p.edges, edge] : p.edges }))
      setPicker(null)
      // Once the inspector has opened (and the canvas narrowed), bring the new node into view.
      setTimeout(() => {
        const box = wrapper.current?.getBoundingClientRect()
        if (!box) return
        const tl = flowToScreenPosition(node.position)
        const br = flowToScreenPosition({ x: node.position.x + CARD_W, y: node.position.y + 110 })
        const visible = tl.x >= box.left && tl.y >= box.top && br.x <= box.right && br.y <= box.bottom
        if (!visible) setCenter(node.position.x + CARD_W / 2, node.position.y + 55, { zoom: getViewport().zoom, duration: 300 })
      }, 60)
    },
    [picker, catalog, setPlan, flowToScreenPosition, getViewport, setCenter],
  )

  // Ctrl/⌘+C / V copy and paste the selected nodes with the belts between
  // them; Ctrl/⌘+D duplicates in one go. Skipped while typing in a field.
  const rfNodesRef = useRef(rfNodes)
  rfNodesRef.current = rfNodes
  const planRef = useRef(plan)
  planRef.current = plan
  useEffect(() => {
    const paste = (clip: Clip, offset: number) => {
      const { plan: next, ids } = pasteClip(planRef.current, clip, newNodeId, { x: offset, y: offset })
      pendingSelect.current = new Set(ids)
      setPlan(next)
    }
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
      if ((e.target as Element)?.closest?.('input, select, textarea')) return
      if (window.getSelection()?.toString()) return
      const key = e.key.toLowerCase()
      const selected = rfNodesRef.current.filter((n) => n.selected).map((n) => n.id)
      if (key === 'c' && selected.length) {
        clipboard = copyNodes(planRef.current, selected)
        pasteCount = 0
      } else if (key === 'v' && clipboard) {
        pasteCount += 1
        paste(clipboard, 40 * pasteCount)
      } else if (key === 'd' && selected.length) {
        paste(copyNodes(planRef.current, selected), 40)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPlan])

  // Tidy layout: the selection if two or more nodes are selected, else the
  // whole plan. One setPlan (one undo step), then fit the view once React
  // Flow has the new positions.
  const selectedCount = rfNodes.filter((n) => n.selected).length
  const pendingFit = useRef<string[] | null>(null)
  const tidy = useCallback(() => {
    const selected = rfNodesRef.current.filter((n) => n.selected).map((n) => n.id)
    const only = selected.length >= 2 ? selected : undefined
    const sizes = new Map(
      rfNodesRef.current.map((n) => [n.id, { w: n.measured?.width ?? CARD_W, h: n.measured?.height ?? 100 }]),
    )
    const moved = layoutPlan(planRef.current, sizes, { only })
    if (!moved.size) return
    pendingFit.current = only ?? []
    const same = planRef.current.nodes.every((n) => !moved.has(n.id) || (moved.get(n.id)!.x === n.position.x && moved.get(n.id)!.y === n.position.y))
    // Already tidy: just fit, without an empty undo step.
    if (same) return setRfNodes((ns) => [...ns])
    setPlan((p) => ({ ...p, nodes: p.nodes.map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n)) }))
  }, [setPlan])
  useEffect(() => {
    const ids = pendingFit.current
    if (!ids) return
    pendingFit.current = null
    fitView({ ...FIT_VIEW, duration: 300, nodes: ids.length ? ids.map((id) => ({ id })) : undefined })
  }, [rfNodes, fitView])

  // Zoom to the selected nodes, or the whole plan if nothing is selected (F).
  const zoomToSelection = useCallback(() => {
    const selected = rfNodesRef.current.filter((n) => n.selected).map((n) => ({ id: n.id }))
    fitView({ ...FIT_VIEW, duration: 300, nodes: selected.length ? selected : undefined })
  }, [fitView])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'f' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if ((e.target as Element)?.closest?.('input, select, textarea')) return
      e.preventDefault()
      zoomToSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomToSelection])

  // A picker for a node that no longer exists (deleted, undone, plan switched) closes.
  useEffect(() => {
    if (picker?.anchor && !plan.nodes.some((n) => n.id === picker.anchor!.node)) setPicker(null)
  }, [picker, plan.nodes])

  const pickerOptions = useMemo(() => {
    if (picker?.preset === 'resources') return resourceOptions(catalog)
    if (picker?.preset === 'goals') return goalOptions(catalog)
    if (!picker?.anchor) return undefined
    const all = picker.context === 'producer' ? producersOf(catalog, picker.anchor.item) : consumersOf(catalog, picker.anchor.item)
    return all.filter((o) => o.kind !== 'recipe' || !isRecipeHidden(o.recipe.id))
  }, [picker, catalog, isRecipeHidden])

  const pickerTitle = (() => {
    if (!picker) return ''
    if (picker.preset === 'resources') return 'Add a resource you have (e.g. "iron mk.2")'
    if (picker.preset === 'goals') return 'Add a product you want, or power to make'
    if (!picker.anchor) return 'Add to plan'
    const item = catalog.items.get(picker.anchor.item)?.name ?? 'item'
    const node = plan.nodes.find((n) => n.id === picker.anchor!.node)
    const to = node ? nodeLabel(node, catalog) : ''
    return picker.context === 'producer' ? `Make ${item} for ${to}` : `Use ${item} from ${to}`
  })()

  return (
    <div className="graph-canvas pn-canvas" ref={wrapper} onDoubleClick={onDoubleClick} onClick={onClick}>
      <ReactFlow
        nodes={rfNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onSelectionChange={reportSelection}
        isValidConnection={isValidConnection}
        deleteKeyCode={['Backspace', 'Delete']}
        connectOnClick={false}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={FIT_VIEW}
        minZoom={MIN_ZOOM}
        proOptions={{ hideAttribution: true }}
      >
        <Panel position="top-left" className="pn-toolbar">
          <button type="button" className="pn-button" onClick={() => openPalette('resources')} title="A miner or extractor on resource nodes you have">
            ⛏ + Resource
          </button>
          <button type="button" className="pn-button" onClick={() => openPalette('goals')} title="A product you want to make">
            🎯 + Goal
          </button>
          <button type="button" className="pn-button pn-button-quiet" onClick={() => openPalette()}>
            + Add anything
          </button>
          <button
            type="button"
            className="pn-button pn-button-quiet"
            onClick={tidy}
            disabled={plan.nodes.length < 2}
            title={
              selectedCount >= 2
                ? 'Arrange the selected nodes left to right; the rest stay put'
                : 'Arrange the whole plan left to right, resources → goals (select nodes to tidy only those)'
            }
          >
            ⇶ {selectedCount >= 2 ? 'Tidy selection' : 'Tidy layout'}
          </button>
          <span className="pn-canvas-hint">drag an item onto a node to connect, onto empty space to extend · drag a connected input away to remove its belt · ⌘/Ctrl C, V, D · F zooms to the selection</span>
        </Panel>
        {plan.nodes.length === 0 && !picker && (
          <Panel position="top-center" className="pn-empty">
            <h3>Start a plan</h3>
            <div className="pn-empty-actions">
              <button type="button" onClick={() => openPalette('resources')}>
                <strong>⛏ I have resources</strong>
                <span>e.g. a pure iron node with a Mk.2 miner. See what you can make from it.</span>
              </button>
              <button type="button" onClick={() => openPalette('goals')}>
                <strong>🎯 I want a product</strong>
                <span>e.g. 10 Reinforced Iron Plates/min. See what you need to build.</span>
              </button>
            </div>
          </Panel>
        )}
        <Background gap={20} color="#243040" />
        <Controls>
          <ControlButton onClick={zoomToSelection} title="Zoom to selection (F)" aria-label="Zoom to selection">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M2 2h7v3H5v4H2zM22 2h-7v3h4v4h3zM2 22h7v-3H5v-4H2zM22 22h-7v-3h4v-4h3zM9 9h6v6H9z" />
            </svg>
          </ControlButton>
        </Controls>
        <MiniMap pannable zoomable nodeStrokeWidth={0} bgColor="#0d1117" maskColor="rgba(5, 8, 12, 0.6)" nodeColor={miniMapColor} />
      </ReactFlow>
      {picker && (
        <Picker
          title={pickerTitle}
          options={pickerOptions}
          hide={isRecipeHidden}
          at={picker.at}
          onPick={onPick}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}

function miniMapColor(n: PlanFlowNode): string {
  switch (n.type) {
    case 'extractor':
    case 'supply':
      return '#22c55e'
    case 'goal':
      return '#f59e0b'
    default:
      return '#38bdf8'
  }
}
