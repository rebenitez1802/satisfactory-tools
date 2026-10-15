import { useEffect, useMemo, useState } from 'react'
import { solve } from '../../solver'
import { adviseSplit, groupEnd, machineRates, machinesOnBelts } from '../../planner'
import type { Plan, Split, SplitAdvice } from '../../planner'
import { GraphView } from '../GraphView'
import { fmt, pct, tierName } from './format'
import { Icon } from './Icon'
import { usePlanner } from './plannerContext'
import { nodeLabel } from './labels'

type Tab = 'manifold' | 'balancer' | 'dedicated'

/** Balancer precision: how far an output may be from its rate, for a simpler design. */
const PRECISIONS: [number, string][] = [
  [0, 'Exact'],
  [0.01, '±1%'],
  [0.02, '±2%'],
  [0.05, '±5%'],
]

/**
 * One machine group's output split among several belts, the way players
 * build it (see `adviseSplit`): a manifold, an exact load balancer, or
 * dedicated machines per consumer. It opens on the recommended one.
 */
export function SplitPopup({ split, plan, onClose, onSplitGroups }: { split: Split; plan: Plan; onClose: () => void; onSplitGroups: () => void }) {
  const { catalog, result: planResult } = usePlanner()
  const item = catalog.items.get(split.item)
  const source = plan.nodes.find((n) => n.id === split.node)
  const advice = useMemo(() => adviseSplit(plan, planResult, split, catalog), [plan, planResult, split, catalog])
  const [tab, setTab] = useState<Tab>(advice.recommend)
  const group = groupEnd(planResult.nodes.get(split.node), split.item, 'out')
  const machineName = group && catalog.machines.get(group.machine)?.name
  const unit = item && item.form !== 'solid' ? ' m³' : ''

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const label = (target: string) => {
    const n = plan.nodes.find((x) => x.id === target)
    return n ? nodeLabel(n, catalog) : '?'
  }
  const tabs: [Tab, string][] = [
    ['manifold', 'Manifold'],
    ['balancer', 'Load balancer'],
    ...(advice.dedicated ? ([['dedicated', 'Dedicated machines']] as [Tab, string][]) : []),
  ]

  return (
    <div className="pn-modal-backdrop" onClick={onClose}>
      <div className="pn-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Split">
        <div className="pn-modal-head">
          {item && <Icon of={item} size={32} />}
          <div>
            <h3>
              Split {item?.name ?? 'items'} · {fmt(split.produced)}
              {unit}/min
            </h3>
            <p className="pn-dim">
              From {source ? nodeLabel(source, catalog) : 'node'}
              {group && ` (${fmt(group.count)} ${machineName ?? 'machine'}${group.count === 1 ? '' : 's'} × ${fmt(group.each)}/min)`} into{' '}
              {advice.branches.map((b) => fmt(b.perMin)).join(' + ')}
              {split.leftover > 1e-6 && ` + ${fmt(split.leftover)} spare`}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="pn-split-tabs" role="tablist">
          {tabs.map(([id, text]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {text}
              {advice.recommend === id && <span className="pn-split-rec">recommended</span>}
            </button>
          ))}
        </div>
        {tab === 'manifold' && <ManifoldView advice={advice} split={split} label={label} unit={unit} producer={machineName} />}
        {tab === 'balancer' && <BalancerView split={split} plan={plan} advice={advice} label={label} />}
        {tab === 'dedicated' && advice.dedicated && (
          <DedicatedView
            advice={advice}
            label={label}
            unit={unit}
            name={machineName ?? 'machine'}
            clock={planResult.nodes.get(split.node)?.setup?.clock ?? 1}
            source={source ? nodeLabel(source, catalog) : 'the group'}
            onSplit={onSplitGroups}
          />
        )}
      </div>
    </div>
  )
}

function ManifoldView({ advice, split, label, unit, producer }: { advice: SplitAdvice; split: Split; label: (id: string) => string; unit: string; producer?: string }) {
  const { catalog } = usePlanner()
  const item = catalog.items.get(split.item)
  // Machines first; the one output that takes everything goes last.
  const line = [...advice.branches].sort((a, b) => Number(a.edge === advice.overflow) - Number(b.edge === advice.overflow))
  const overflow = advice.branches.find((b) => b.edge === advice.overflow)
  const takers = advice.branches.filter((b) => b.taker)
  const splitters = line.reduce((s, b) => s + (b.consumers ? Math.ceil(b.consumers.count - 1e-6) : 1), 0)
  return (
    <div className="pn-modal-body pn-split-body">
      {advice.manifold ? (
        <p className="pn-split-verdict ok">A manifold works here: no balancer needed.</p>
      ) : (
        <p className="pn-split-verdict warn">
          {takers.map((b) => label(b.target)).join(' and ')} take everything they get, so a manifold can't share between them. Use the load
          balancer for their shares.
        </p>
      )}
      <p>
        Run the {item?.name ?? 'item'} {item?.form === 'solid' ? 'belt' : 'pipe'} past the consumers with a splitter in front of each machine
        (about {splitters}). Machines take only what they need; once they're full the line backs up and the splitters pass the rest on. It takes a
        while to fill up, and until then the first machines get more.
      </p>
      {overflow && (
        <p>
          Put <strong>{label(overflow.target)}</strong> last: it takes whatever the machines leave, {fmt(overflow.perMin)}
          {unit}/min once they're full.
        </p>
      )}
      {split.leftover > 1e-6 && (
        <p className="pn-dim">
          {fmt(split.leftover)}
          {unit}/min more is made than used: the line backs up and the {producer ? `${producer}s` : 'producers'} slow down to match.
        </p>
      )}
      <table className="pn-split-table">
        <thead>
          <tr>
            <th>Along the line</th>
            <th>{unit ? 'm³/min' : '/min'}</th>
            <th>Machines</th>
          </tr>
        </thead>
        <tbody>
          {line.map((b) => (
            <tr key={b.edge}>
              <td>{label(b.target)}</td>
              <td>{fmt(b.perMin)}</td>
              <td>{b.consumers ? fmt(b.consumers.count) : b.taker ? 'takes the rest' : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * A sub-group as built: whole machines sharing one clock, "14 at 95.2%", the
 * way the underclock machine mode counts them.
 */
function groupText(machines: number, clock: number): string {
  const n = Math.max(1, Math.ceil(machines - 1e-6))
  const each = (clock * machines) / n
  return Math.abs(each - 1) < 1e-6 ? `${n}` : `${n} at ${pct(each)}`
}

function DedicatedView({
  advice,
  label,
  unit,
  name,
  clock,
  source,
  onSplit,
}: {
  advice: SplitAdvice
  label: (id: string) => string
  unit: string
  name: string
  clock: number
  source: string
  onSplit: () => void
}) {
  const d = advice.dedicated!
  const target = new Map(advice.branches.map((b) => [b.edge, b.target]))
  return (
    <>
      <div className="pn-modal-body pn-split-body">
        <p className="pn-split-verdict ok">Exact, and nothing to split: no splitters or mergers for this item.</p>
        <p>
          Give each consumer its own {name}s. Each sub-group makes exactly what its consumer takes, so the belts never meet.{' '}
          {d.built > d.shared
            ? `That's ${d.built} ${name}s instead of ${d.shared}: every sub-group rounds up to whole machines.`
            : `Still ${d.shared} ${name}s.`}{' '}
          Their own inputs come from the same suppliers, which the machines pull from like a manifold.
        </p>
        <table className="pn-split-table">
          <thead>
            <tr>
              <th>For</th>
              <th>{unit ? 'm³/min' : '/min'}</th>
              <th>{name}s</th>
              {d.groups.some((g) => g.belts) && <th>Belts</th>}
            </tr>
          </thead>
          <tbody>
            {d.groups.map((g) => (
              <tr key={g.edge}>
                <td>{label(target.get(g.edge)!)}</td>
                <td>{fmt(g.perMin)}</td>
                <td>{groupText(g.machines, clock)}</td>
                {d.groups.some((x) => x.belts) && <td>{g.belts ?? '–'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pn-modal-foot">
        <span className="pn-dim">{d.blocker ?? `Turns ${source} into ${d.groups.length} groups in the plan, one per consumer.`}</span>
        <button type="button" className="pn-button" disabled={!!d.blocker} onClick={onSplit}>
          Split into {d.groups.length} groups
        </button>
      </div>
    </>
  )
}

function BalancerView({ split, plan, advice, label }: { split: Split; plan: Plan; advice: SplitAdvice; label: (id: string) => string }) {
  const { catalog, result: planResult } = usePlanner()
  const item = catalog.items.get(split.item)
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
  // Exact rates rarely matter in the game (see approx.ts), so start at ±2%.
  const [tolerance, setTolerance] = useState(0.02)
  const inputs = grouped && perBelt ? perBelt : perMachine
  const machineName = group && catalog.machines.get(group.machine)?.name

  // Each belt leaving the split becomes a balancer output, labeled with its consumer.
  const outputs = useMemo(() => advice.branches.map((b) => ({ label: label(b.target), rate: b.perMin })), [advice, label])
  const result = useMemo(
    () => (split.produced > 1e-6 && outputs.length > 0 ? solve({ input: split.produced, inputs, outputs, beltMax: cap, tolerance }) : null),
    [split.produced, inputs, outputs, cap, tolerance],
  )

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
    if (tolerance) params.set('tol', num(tolerance * 100))
    window.location.hash = `/balancer?${params}`
  }

  const graph = result?.ok ? result.graph! : null
  const splitters = graph?.nodes.filter((n) => n.kind === 'splitter').length ?? 0
  const mergers = graph?.nodes.filter((n) => n.kind === 'merger').length ?? 0
  const notes = result?.ok ? result.warnings.filter((w) => w.kind === 'info' || w.kind === 'belt-over-capacity') : []

  return (
    <>
      <div className="pn-split-toolbar">
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
        <div className="seg pn-seg-small" title="How far each output may be from its rate, for a simpler balancer">
          {PRECISIONS.map(([v, text]) => (
            <button key={v} type="button" className={tolerance === v ? 'active' : ''} onClick={() => setTolerance(v)}>
              {text}
            </button>
          ))}
        </div>
        {graph && (
          <span className="pn-dim">
            {splitters} splitter{splitters === 1 ? '' : 's'}, {mergers} merger{mergers === 1 ? '' : 's'}
            {result!.loopbacks ? `, ${result!.loopbacks} loopback${result!.loopbacks === 1 ? '' : 's'}` : ''}
          </span>
        )}
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
    </>
  )
}
