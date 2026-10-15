import { useEffect, useMemo, useState } from 'react'
import { solve } from '../../solver'
import { groupEnd, machineRates, machinesOnBelts } from '../../planner'
import type { Plan, Split } from '../../planner'
import { GraphView } from '../GraphView'
import { fmt, tierName } from './format'
import { Icon } from './Icon'
import { usePlanner } from './plannerContext'
import { nodeLabel } from './labels'

/**
 * Read-only load balancer for one split: the producer's output divided into
 * the rates its belts carry, with any spare going to a Leftover output. The
 * producing group is many machines, so the balancer starts with one input per
 * machine, or with the machines grouped onto the plan's belts or pipes.
 */
export function BalancerPopup({ split, plan, onClose }: { split: Split; plan: Plan; onClose: () => void }) {
  const { catalog, result: planResult } = usePlanner()
  const item = catalog.items.get(split.item)
  const source = plan.nodes.find((n) => n.id === split.node)

  const group = groupEnd(planResult.nodes.get(split.node), split.item, 'out')
  const tier = catalog.transportTiers.get((item?.form === 'solid' ? plan.settings.beltTier : plan.settings.pipeTier) ?? '')
  const cap = tier?.ratePerMin
  const perMachine = useMemo(() => (group ? machineRates(group.count, group.each) : [split.produced]), [group?.count, group?.each, split.produced])
  const perBelt = useMemo(() => {
    const belts = group && cap ? machinesOnBelts(group.count, group.each, cap) : undefined
    return belts && belts.length < perMachine.length ? belts.map((b) => b.perMin) : undefined
  }, [group?.count, group?.each, cap, perMachine.length])
  // One input per machine by default: whole machines go straight to an
  // output, so it needs the fewest splitters. Grouped belts must be split again.
  const [grouped, setGrouped] = useState(false)
  const inputs = grouped && perBelt ? perBelt : perMachine

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
    () => (split.produced > 1e-6 && outputs.length > 0 ? solve({ input: split.produced, inputs, outputs, beltMax: cap }) : null),
    [split.produced, inputs, outputs, cap],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const openInBalancer = () => {
    const params = new URLSearchParams()
    // Runs of equal inputs as `in=20x100`.
    const num = (v: number) => String(Number(v.toFixed(4)))
    for (let i = 0; i < inputs.length; ) {
      let n = 1
      while (i + n < inputs.length && Math.abs(inputs[i + n] - inputs[i]) < 1e-9) n++
      params.append('in', n > 1 ? `${n}x${num(inputs[i])}` : num(inputs[i]))
      i += n
    }
    for (const o of outputs) params.append('out', `${num(o.rate)}|${o.label ?? ''}`)
    if (cap) params.set('cap', num(cap))
    window.location.hash = `/balancer?${params}`
  }

  const graph = result?.ok ? result.graph! : null
  const splitters = graph?.nodes.filter((n) => n.kind === 'splitter').length ?? 0
  const mergers = graph?.nodes.filter((n) => n.kind === 'merger').length ?? 0
  const notes = result?.ok ? result.warnings.filter((w) => w.kind === 'info' || w.kind === 'belt-over-capacity') : []
  const machineName = group && catalog.machines.get(group.machine)?.name

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
              From {source ? nodeLabel(source, catalog) : 'node'}
              {group && ` (${fmt(group.count)} × ${fmt(group.each)}/min)`} into {outputs.map((o) => fmt(o.rate)).join(' + ')}
              {split.leftover > 1e-6 && ` + ${fmt(split.leftover)} leftover`}
              {graph && ` — ${splitters} splitter${splitters === 1 ? '' : 's'}, ${mergers} merger${mergers === 1 ? '' : 's'}`}
            </p>
          </div>
          {perBelt && tier && (
            <div className="seg pn-seg-small" title="What feeds the balancer">
              <button type="button" className={grouped ? '' : 'active'} onClick={() => setGrouped(false)}>
                {perMachine.length} × {machineName ?? 'machine'}
              </button>
              <button type="button" className={grouped ? 'active' : ''} onClick={() => setGrouped(true)}>
                {perBelt.length} × {tierName(tier)} {tier.kind}
              </button>
            </div>
          )}
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
