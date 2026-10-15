// ✨ Optimize: proposes the plan's recipes from an LP (src/planner/optimize.ts)
// and shows what would change before anything does. Apply swaps the plan in
// as one undo step; Cancel leaves it alone.

import { useEffect, useMemo, type ReactNode } from 'react'
import type { Catalog, ItemId } from '../../catalog'
import { newNodeId, optimize, overText, solvePlan, worldUsage } from '../../planner'
import type { Objective, Plan, SolveResult } from '../../planner'
import { AvoidChips } from './AvoidChips'
import { fmt, mw } from './format'
import { Icon } from './Icon'

const OBJECTIVES: [Objective, string, string][] = [
  ['resources', 'Fewest raw resources', 'Each resource weighed by how scarce the map makes it: uranium counts far more than iron. Water is free.'],
  ['power', 'Least power', 'Power the machines draw at 100% clock.'],
  ['buildings', 'Fewest buildings', 'Machines and extractors, counted at 100% clock.'],
]

const buildings = (r: SolveResult) => [...r.totals.machines.values()].reduce((s, c) => s + Math.ceil(c - 1e-6), 0)

export function OptimizeModal({
  plan,
  result,
  catalog,
  isRecipeHidden,
  recipes,
  objective,
  onObjective,
  onAvoid,
  onApply,
  onClose,
}: {
  plan: Plan
  result: SolveResult
  catalog: Catalog
  isRecipeHidden: (id: string) => boolean
  /** e.g. "Tier 5 · 180 of 293 usable" */
  recipes: string
  objective: Objective
  onObjective: (objective: Objective) => void
  /** The plan's "Don't use" list. */
  onAvoid: (avoid: ItemId[]) => void
  onApply: (plan: Plan) => void
  onClose: () => void
}) {
  const proposal = useMemo(() => optimize(plan, catalog, { objective, isRecipeHidden, newId: newNodeId }), [plan, catalog, objective, isRecipeHidden])
  const after = useMemo(() => (proposal.ok ? solvePlan(proposal.plan, catalog) : undefined), [proposal, catalog])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="pn-modal-backdrop" onClick={onClose}>
      <div className="pn-modal pn-modal-narrow pn-opt" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Optimize plan">
        <div className="pn-modal-head">
          <div>
            <h3>✨ Optimize plan</h3>
            <p className="pn-dim">
              Picks the recipes for this plan's goals from the ones you can use ({recipes}). Goals,
              sources, generators and ⛔ limited groups stay; the other machine groups are rebuilt.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="pn-opt-body">
          <div className="seg seg-full">
            {OBJECTIVES.map(([o, label, hint]) => (
              <button key={o} type="button" className={objective === o ? 'active' : ''} title={hint} onClick={() => onObjective(o)}>
                {label}
              </button>
            ))}
          </div>
          <p className="pn-dim pn-opt-hint">{OBJECTIVES.find(([o]) => o === objective)![2]}</p>
          <div className="pn-opt-avoid">
            <div className="pn-opt-sub">Don't use</div>
            <AvoidChips catalog={catalog} avoid={plan.settings.avoid ?? []} onChange={onAvoid} />
            <p className="pn-dim pn-opt-hint">
              No new extractors for these; the plan's own extractors and supplies still count. Saved with this plan, and ⚡ Build chain
              follows it too.
            </p>
          </div>
          {!proposal.ok || !after ? (
            <div className="warning error">{proposal.message}</div>
          ) : (
            <Comparison before={result} after={after} plan={plan} proposal={proposal.plan} catalog={catalog} note={proposal.message} />
          )}
        </div>
        <div className="pn-modal-foot">
          <span className="pn-dim">Apply is one undo step.</span>
          <span className="pn-opt-actions">
            <button type="button" className="pn-button pn-button-quiet pn-button-inline" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="pn-button" disabled={!proposal.ok} onClick={() => onApply(proposal.plan)}>
              Apply
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}

function Comparison({
  before,
  after,
  plan,
  proposal,
  catalog,
  note,
}: {
  before: SolveResult
  after: SolveResult
  plan: Plan
  proposal: Plan
  catalog: Catalog
  note?: string
}) {
  const raw = (r: SolveResult) => new Map(r.totals.rawResources.map((x) => [x.item, x.perMin]))
  const rawBefore = raw(before)
  const rawAfter = raw(after)
  const items = [...new Set([...rawAfter.keys(), ...rawBefore.keys()])]
  const used = new Set(plan.nodes.flatMap((n) => (n.kind === 'recipe' ? [n.recipe] : [])))
  const groups = proposal.nodes.flatMap((n) => {
    if (n.kind !== 'recipe') return []
    const recipe = catalog.recipes.get(n.recipe)
    const res = after.nodes.get(n.id)
    if (!recipe || !res?.setup || res.activity <= 1e-9) return []
    return [{ id: n.id, recipe, machine: catalog.machines.get(n.machine), count: res.setup.count, isNew: !used.has(n.recipe) }]
  })
  const over = worldUsage(proposal, after, catalog).filter((u) => u.over)
  const warnings = after.diagnostics.filter((d) => d.severity !== 'info')

  return (
    <>
      {note && <div className="pn-note pn-warn">{note}</div>}
      <div className="pn-opt-table">
        <div className="pn-opt-head">
          <span />
          <span>Now</span>
          <span>Optimized</span>
        </div>
        {after.goals.map((g) => {
          const item = catalog.items.get(g.item)
          const was = before.goals.find((b) => b.id === g.id)?.achieved ?? 0
          const show = g.power ? mw : fmt
          return (
            <Line key={g.id} icon={item && <Icon of={item} size={20} />} label={g.power ? `Power from ${item?.name ?? 'fuel'}` : (item?.name ?? g.item)} before={show(was)} after={show(g.achieved)} better={g.achieved - was} />
          )
        })}
        <Line label="Power used" before={mw(before.totals.powerMw)} after={mw(after.totals.powerMw)} better={before.totals.powerMw - after.totals.powerMw} />
        <Line label="Buildings" before={String(buildings(before))} after={String(buildings(after))} better={buildings(before) - buildings(after)} />
        <div className="pn-opt-sub">Resources in, per minute</div>
        {items.map((id) => (
          <ResourceLine key={id} id={id} catalog={catalog} before={rawBefore.get(id) ?? 0} after={rawAfter.get(id) ?? 0} />
        ))}
      </div>
      <div className="pn-section">
        <h4>Machine groups</h4>
        {groups.map((g) => {
          const product = catalog.items.get(g.recipe.outputs[0]?.item ?? '')
          return (
            <div key={g.id} className="pn-row">
              {product && <Icon of={product} size={20} />}
              <span className="pn-row-label">
                {g.recipe.name}
                {g.recipe.alternate && <span className="pn-alt">alt</span>}
                {g.isNew && <span className="pn-kind">new</span>}
              </span>
              <span className="pn-row-value pn-dim">
                {g.machine?.name} × {fmt(g.count)}
              </span>
            </div>
          )
        })}
      </div>
      {(over.length > 0 || warnings.length > 0) && (
        <div className="warnings">
          {over.map((u) => (
            <div key={u.resource + u.site} className="warning error">
              More than the map has. {overText(u, catalog)}.
            </div>
          ))}
          {warnings.map((d, i) => (
            <div key={i} className="warning error">
              {d.message}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function Line({ icon, label, before, after, better }: { icon?: ReactNode; label: string; before: string; after: string; better: number }) {
  const tone = before === after ? 'pn-dim' : better > 1e-6 ? 'pn-good' : better < -1e-6 ? 'pn-bad' : ''
  return (
    <div className="pn-opt-line">
      <span className="pn-opt-label">
        {icon}
        {label}
      </span>
      <span className="pn-dim">{before}</span>
      <span className={tone}>{after}</span>
    </div>
  )
}

function ResourceLine({ id, catalog, before, after }: { id: ItemId; catalog: Catalog; before: number; after: number }) {
  const item = catalog.items.get(id)
  const unit = item && item.form !== 'solid' ? ' m³' : ''
  return (
    <Line
      icon={item && <Icon of={item} size={20} />}
      label={item?.name ?? id}
      before={before > 1e-9 ? `${fmt(before)}${unit}` : '–'}
      after={after > 1e-9 ? `${fmt(after)}${unit}` : '–'}
      better={before - after}
    />
  )
}
