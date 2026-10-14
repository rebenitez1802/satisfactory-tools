import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { Catalog, ItemId } from '../../catalog'
import { duplicateNodes, newNodeId, openInputs, removeNodes, setRecipe, solvePlan, updateNode, validatePlan } from '../../planner'
import type { Plan, PlanEdge, PlanNode, PlanSettings } from '../../planner'
import { AlternatesModal } from './AlternatesModal'
import { BalancerPopup } from './BalancerPopup'
import { CatalogProvider, useCatalog, useCatalogState } from './catalogContext'
import { Inspector, type InspectorActions } from './Inspector'
import { PlanCanvas, type CanvasApi } from './PlanCanvas'
import { PlanMenu } from './PlanMenu'
import { PlanTabs } from './PlanTabs'
import { PlannerContext, type PlannerContextValue } from './plannerContext'
import { PlanSummary } from './PlanSummary'
import { samplePlan } from './samplePlan'
import { downloadPlan, loadPrefs, loadStore, newPlanId, savePrefs, saveStore, type PlanStore, type Prefs } from './storage'
import { useHistory } from './useHistory'
import './planner.css'

export function PlannerTool() {
  return (
    <CatalogProvider>
      <PlannerGate />
    </CatalogProvider>
  )
}

function PlannerGate() {
  const state = useCatalogState()
  if (state.status === 'ready') return <Planner />
  return (
    <div className="tool">
      <section className="panel form-panel">
        <h2>Production chains</h2>
        {state.status === 'loading' ? (
          <p className="panel-hint">Loading game data…</p>
        ) : (
          <div className="warning error">Could not load game data: {state.error}</div>
        )}
      </section>
      <section className="panel graph-panel" />
    </div>
  )
}

/**
 * A new plan keeps the current one's machine mode. Belt and pipe limits start
 * off: an edge joins whole machine groups, so it can always be several belts.
 */
function blankPlan(catalog: Catalog, settings?: PlanSettings): Plan {
  return {
    schemaVersion: 1,
    name: 'Untitled plan',
    packs: catalog.packs.map((p) => ({ id: p.id, version: p.version })),
    settings: { machineMode: settings?.machineMode ?? 'fractional' },
    nodes: [],
    edges: [],
  }
}

function initialStore(): PlanStore {
  const saved = loadStore()
  if (saved) return saved
  const id = newPlanId()
  return {
    activeId: id,
    order: [id],
    plans: { [id]: { id, updatedAt: Date.now(), plan: { ...samplePlan(), name: 'Reinforced Iron Plates (sample)' } } },
  }
}

function Planner() {
  const catalog = useCatalog()
  const [store, setStore] = useState<PlanStore>(initialStore)
  const history = useHistory<Plan>(() => store.plans[store.activeId].plan)
  const plan = history.value
  const setPlan = history.set
  // Remounts the canvas when switching plans so its view refits.
  const [canvasKey, setCanvasKey] = useState(store.activeId)

  const [selection, setSelection] = useState<{ nodes: string[]; edges: string[] }>({ nodes: [], edges: [] })
  const [openSplit, setOpenSplit] = useState<{ nodeId: string; item: ItemId } | null>(null)
  const [showAlternates, setShowAlternates] = useState(false)
  const [fileError, setFileError] = useState<string>()
  const [prefs, setPrefs] = useState(loadPrefs)
  const locked = useMemo(() => new Set(prefs.lockedAlternates), [prefs])
  const isRecipeHidden = useCallback((id: string) => locked.has(id), [locked])
  useEffect(() => savePrefs(prefs), [prefs])
  const updatePrefs = useCallback((patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch })), [])
  const rememberRecipe = useCallback(
    (item: ItemId, recipe: string) =>
      setPrefs((p) => (p.preferredRecipes[item] === recipe ? p : { ...p, preferredRecipes: { ...p.preferredRecipes, [item]: recipe } })),
    [],
  )
  const build = useMemo(() => ({ preferred: prefs.preferredRecipes, reuse: prefs.buildReuse }), [prefs])
  const canvas = useRef<CanvasApi | null>(null)

  const result = useMemo(() => solvePlan(plan, catalog), [plan, catalog])

  // Autosave the active plan.
  useEffect(() => {
    const t = setTimeout(() => {
      setStore((s) => {
        const next: PlanStore = {
          ...s,
          plans: { ...s.plans, [s.activeId]: { id: s.activeId, updatedAt: Date.now(), plan } },
        }
        saveStore(next)
        return next
      })
    }, 300)
    return () => clearTimeout(t)
  }, [plan])

  // Tabs. Switching or closing first writes the open plan back, so an edit
  // made just before isn't lost to the autosave delay.
  const planRef = useRef(plan)
  planRef.current = plan
  const storeRef = useRef(store)
  storeRef.current = store
  const flush = (s: PlanStore): PlanStore => ({
    ...s,
    plans: { ...s.plans, [s.activeId]: { id: s.activeId, updatedAt: Date.now(), plan: planRef.current } },
  })
  const commit = (next: PlanStore, show: Plan) => {
    saveStore(next)
    setStore(next)
    history.reset(show)
    setSelection({ nodes: [], edges: [] })
    setCanvasKey(next.activeId)
  }

  const switchTo = (id: string) => {
    const s = flush(store)
    if (s.plans[id]) commit({ ...s, activeId: id }, s.plans[id].plan)
  }

  /** Open a plan in a new tab right after the current one. */
  const openTab = (value: Plan, at?: number) => {
    const s = flush(store)
    const id = newPlanId()
    const order = [...s.order]
    order.splice(at ?? order.indexOf(s.activeId) + 1, 0, id)
    commit({ activeId: id, order, plans: { ...s.plans, [id]: { id, updatedAt: Date.now(), plan: value } } }, value)
    return id
  }
  const [editRequest, setEditRequest] = useState<{ id: string; n: number }>()

  const [toast, setToast] = useState<{ message: string; undo: () => void } | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(t)
  }, [toast])

  const closeTab = (id: string) => {
    const s = flush(store)
    const closed = s.plans[id]
    const index = s.order.indexOf(id)
    const order = s.order.filter((x) => x !== id)
    const plans = { ...s.plans }
    delete plans[id]
    let next: PlanStore
    if (!order.length) {
      const blankId = newPlanId()
      next = { activeId: blankId, order: [blankId], plans: { [blankId]: { id: blankId, updatedAt: Date.now(), plan: blankPlan(catalog, plan.settings) } } }
    } else {
      next = { order, plans, activeId: id === s.activeId ? order[Math.min(index, order.length - 1)] : s.activeId }
    }
    commit(next, next.plans[next.activeId].plan)
    setToast({
      message: `Deleted "${closed.plan.name || 'Untitled plan'}"`,
      undo: () => {
        // Built from refs at click time, never inside a state updater: React
        // may re-run updaters after a render has moved the refs on.
        const cur = flush(storeRef.current)
        const o = [...cur.order]
        o.splice(Math.min(index, o.length), 0, id)
        commit({ activeId: id, order: o, plans: { ...cur.plans, [id]: closed } }, closed.plan)
        setToast(null)
      },
    })
  }

  const renameTab = (id: string, name: string) => {
    if (id === store.activeId) setPlan((p) => ({ ...p, name }))
    else {
      const next = { ...store, plans: { ...store.plans, [id]: { ...store.plans[id], plan: { ...store.plans[id].plan, name } } } }
      saveStore(next)
      setStore(next)
    }
  }

  const menu = {
    onRename: (name: string) => setPlan((p) => ({ ...p, name }), 'name'),
    onSample: () => openTab({ ...samplePlan(), name: 'Reinforced Iron Plates (sample)' }),
    onDuplicate: () => openTab({ ...plan, name: `${plan.name} (copy)` }),
    onExport: () => downloadPlan({ ...plan, packs: catalog.packs.map((p) => ({ id: p.id, version: p.version })) }),
    onImport: async (file: File) => {
      try {
        const data = JSON.parse(await file.text())
        const error = validatePlan(data)
        if (error) return setFileError(`${file.name}: ${error}`)
        setFileError(undefined)
        openTab(data as Plan)
      } catch {
        setFileError(`${file.name}: not valid JSON.`)
      }
    },
  }

  // Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z or Ctrl+Y redo (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if ((e.target as Element)?.closest?.('input, select, textarea')) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) history.undo()
      else if ((key === 'z' && e.shiftKey) || key === 'y') history.redo()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [history])

  const update = useCallback(
    (id: string, patch: Partial<PlanNode>) => setPlan((p) => updateNode(p, id, patch, catalog), `node:${id}:${Object.keys(patch).join()}`),
    [setPlan, catalog],
  )
  const actions: InspectorActions = useMemo(
    () => ({
      update,
      setRecipe: (id, recipeId) => {
        // Switching how a node makes its product is remembered for ⚡ Build chain.
        const recipe = catalog.recipes.get(recipeId)
        const gen = recipe && catalog.machines.get(recipe.machines[0])?.generation
        if (recipe?.outputs[0] && !gen) rememberRecipe(recipe.outputs[0].item, recipeId)
        setPlan((p) => setRecipe(p, id, recipeId, catalog))
      },
      updateEdge: (id: string, patch: Partial<PlanEdge>) =>
        setPlan((p) => ({ ...p, edges: p.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) }), `edge:${id}`),
      removeNodes: (ids) => setPlan((p) => removeNodes(p, ids)),
      removeEdges: (ids) => setPlan((p) => ({ ...p, edges: p.edges.filter((e) => !ids.includes(e.id)) })),
      duplicate: (ids) => setPlan((p) => duplicateNodes(p, ids, newNodeId)),
      buildChain: (id) => canvas.current?.buildChain(openInputs(planRef.current, catalog, { node: id })),
    }),
    [update, setPlan, catalog, rememberRecipe],
  )
  const updateSettings = useCallback(
    (patch: Partial<PlanSettings>) => setPlan((p) => ({ ...p, settings: { ...p.settings, ...patch } })),
    [setPlan],
  )

  const ctx: PlannerContextValue = useMemo(
    () => ({
      catalog,
      result,
      settings: plan.settings,
      updateNode: update,
      openSplit: (nodeId, item) => setOpenSplit({ nodeId, item }),
      isRecipeHidden,
      edgeStyle: prefs.edgeStyle,
      build,
      rememberRecipe,
    }),
    [catalog, result, plan.settings, update, isRecipeHidden, prefs.edgeStyle, build, rememberRecipe],
  )
  const split = openSplit && result.splits.find((s) => s.node === openSplit.nodeId && s.item === openSplit.item)
  const alternateCount = [...catalog.recipes.values()].filter((r) => r.alternate).length
  const liveSelection = {
    nodes: selection.nodes.filter((id) => plan.nodes.some((n) => n.id === id)),
    edges: selection.edges.filter((id) => plan.edges.some((e) => e.id === id)),
  }

  return (
    <PlannerContext.Provider value={ctx}>
      <PlanTabs
        tabs={store.order.map((id) => ({ id, name: id === store.activeId ? plan.name : store.plans[id].plan.name }))}
        activeId={store.activeId}
        onSelect={switchTo}
        onClose={closeTab}
        onNew={() => {
          const id = openTab(blankPlan(catalog, plan.settings), store.order.length)
          setEditRequest((r) => ({ id, n: (r?.n ?? 0) + 1 }))
        }}
        onRename={renameTab}
        editRequest={editRequest}
      />
      <div className="tool pn-tool">
        <section className="panel form-panel">
          <PlanMenu
            name={plan.name}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            error={fileError}
            onUndo={history.undo}
            onRedo={history.redo}
            {...menu}
          />
          <PlanSummary
            plan={plan}
            result={result}
            catalog={catalog}
            updateSettings={updateSettings}
            alternates={`${alternateCount - [...locked].filter((id) => catalog.recipes.has(id)).length} of ${alternateCount} unlocked`}
            onEditAlternates={() => setShowAlternates(true)}
            edgeStyle={prefs.edgeStyle}
            onEdgeStyle={(edgeStyle) => updatePrefs({ edgeStyle })}
            buildReuse={prefs.buildReuse}
            onBuildReuse={(buildReuse) => updatePrefs({ buildReuse })}
            onBuild={(item) => canvas.current?.buildChain(openInputs(plan, catalog, { item }))}
          />
        </section>
        <section className="panel graph-panel pn-graph-panel">
          <ReactFlowProvider key={canvasKey}>
            <PlanCanvas plan={plan} setPlan={setPlan} result={result} onSelectionChange={setSelection} apiRef={canvas} />
          </ReactFlowProvider>
          <Inspector
            plan={plan}
            result={result}
            catalog={catalog}
            selection={liveSelection}
            actions={actions}
            isRecipeHidden={isRecipeHidden}
          />
        </section>
      </div>
      {toast && (
        <div className="pn-toast" role="status">
          {toast.message}
          <button type="button" onClick={toast.undo}>
            Undo
          </button>
          <button type="button" className="pn-toast-close" onClick={() => setToast(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {split && <BalancerPopup split={split} plan={plan} onClose={() => setOpenSplit(null)} />}
      {showAlternates && (
        <AlternatesModal
          catalog={catalog}
          locked={locked}
          onChange={(next) => updatePrefs({ lockedAlternates: [...next] })}
          onClose={() => setShowAlternates(false)}
        />
      )}
    </PlannerContext.Provider>
  )
}
