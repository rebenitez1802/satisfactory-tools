import { useEffect, useMemo } from 'react'
import { solve } from '../../solver'
import type { Plan, Split } from '../../planner'
import { GraphView } from '../GraphView'
import { fmt } from './format'
import { Icon } from './Icon'
import { usePlanner } from './plannerContext'
import { nodeLabel } from './labels'

/**
 * Read-only load balancer for one split: the producer's output divided into
 * the rates its belts carry, with any spare going to a Leftover output.
 */
export function BalancerPopup({ split, plan, onClose }: { split: Split; plan: Plan; onClose: () => void }) {
  const { catalog } = usePlanner()
  const item = catalog.items.get(split.item)
  const source = plan.nodes.find((n) => n.id === split.node)

  // Each belt leaving the split becomes a balancer output, labeled with its consumer.
  const outputs = useMemo(() => {
    const byId = new Map(plan.nodes.map((n) => [n.id, n]))
    const edgeTarget = new Map(plan.edges.map((e) => [e.id, e.target]))
    return split.edges
      .filter((e) => e.perMin > 1e-6)
      .map((e) => {
        const target = byId.get(edgeTarget.get(e.id) ?? '')
        return { label: target ? nodeLabel(target, catalog) : undefined, rate: e.perMin }
      })
  }, [split, plan, catalog])

  const result = useMemo(
    () => (split.produced > 1e-6 && outputs.length > 0 ? solve({ input: split.produced, outputs }) : null),
    [split.produced, outputs],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const openInBalancer = () => {
    const params = new URLSearchParams({ in: String(Number(split.produced.toFixed(4))) })
    for (const o of outputs) params.append('out', `${Number(o.rate.toFixed(4))}|${o.label ?? ''}`)
    window.location.hash = `/balancer?${params}`
  }

  const graph = result?.ok ? result.graph! : null
  const splitters = graph?.nodes.filter((n) => n.kind === 'splitter').length ?? 0
  const mergers = graph?.nodes.filter((n) => n.kind === 'merger').length ?? 0
  const notes = result?.ok ? result.warnings.filter((w) => w.kind === 'info') : []

  return (
    <div className="pn-modal-backdrop" onClick={onClose}>
      <div className="pn-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Load balancer">
        <div className="pn-modal-head">
          {item && <Icon of={item} size={32} />}
          <div>
            <h3>
              Balance {item?.name ?? 'items'} · {fmt(split.produced)}/min
            </h3>
            <p className="pn-dim">
              From {source ? nodeLabel(source, catalog) : 'node'} into {outputs.map((o) => fmt(o.rate)).join(' + ')}
              {split.leftover > 1e-6 && ` + ${fmt(split.leftover)} leftover`}
              {graph && ` — ${splitters} splitter${splitters === 1 ? '' : 's'}, ${mergers} merger${mergers === 1 ? '' : 's'}`}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="pn-modal-body">
          {!result && <div className="graph-message">Nothing flows through this split yet.</div>}
          {result && !result.ok && <div className="graph-message error">{result.error}</div>}
          {graph && <GraphView result={result!} direction="BT" showLabels showBadges />}
        </div>
        <div className="pn-modal-foot">
          <span className="pn-dim">{notes.map((n) => n.message).join(' ')}</span>
          <button type="button" className="pn-button" onClick={openInBalancer}>
            Open in Load Balancer ↗
          </button>
        </div>
      </div>
    </div>
  )
}
