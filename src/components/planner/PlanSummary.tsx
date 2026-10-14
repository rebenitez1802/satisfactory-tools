import type { Catalog } from '../../catalog'
import type { ItemRate, MachineMode, Plan, PlanSettings, SolveResult } from '../../planner'
import { fmt, mw, pct } from './format'
import { Icon } from './Icon'
import { nodeLabel } from './labels'
import type { EdgeStyle } from './storage'

/** Left panel: goals, totals, what goes in and out, and plan settings. */
export function PlanSummary({
  plan,
  result,
  catalog,
  updateSettings,
  alternates,
  onEditAlternates,
  edgeStyle,
  onEdgeStyle,
}: {
  plan: Plan
  result: SolveResult
  catalog: Catalog
  updateSettings: (patch: Partial<PlanSettings>) => void
  /** e.g. "111 of 111 unlocked" */
  alternates: string
  onEditAlternates: () => void
  edgeStyle: EdgeStyle
  onEdgeStyle: (style: EdgeStyle) => void
}) {
  const { totals } = result
  const whole = plan.settings.machineMode === 'underclock'
  const bottlenecks = plan.nodes.filter((n) => result.nodes.get(n.id)?.bottleneck)
  const buildingCount = [...totals.machines.values()].reduce((s, c) => s + Math.ceil(c - 1e-6), 0)
  const belts = [...catalog.transportTiers.values()].filter((t) => t.kind === 'belt')
  const pipes = [...catalog.transportTiers.values()].filter((t) => t.kind === 'pipe')
  // Icons for the totals: whichever items the loaded machines use for their slots.
  const anyMachine = [...catalog.machines.values()]
  const upgrades = {
    shard: catalog.items.get(anyMachine.find((m) => m.overclock?.item)?.overclock?.item ?? ''),
    sloop: catalog.items.get(anyMachine.find((m) => m.amplifier?.item)?.amplifier?.item ?? ''),
  }

  return (
    <>
      <p className="panel-hint">
        🎯 targets on goals, ⛔ limits on sources or machine groups; everything else sizes itself.
      </p>

      <div className="stats">
        <div className="stat">
          <span className="stat-value">{mw(totals.powerMw)}</span>
          <span className="stat-label">power</span>
        </div>
        <div className="stat">
          <span className="stat-value">{buildingCount}</span>
          <span className="stat-label">buildings</span>
        </div>
      </div>

      <Section title="Goals">
        {result.goals.map((g) => {
          const item = catalog.items.get(g.item)
          const short = g.requested !== 'max' && g.achieved < g.requested - 1e-6
          return (
            <Row key={g.id} icon={item && <Icon of={item} size={20} />} label={`${item?.name ?? g.item}${g.openEndOf ? ' (open end)' : ''}`}>
              <span className={short ? 'pn-bad' : 'pn-good'}>
                {fmt(g.achieved)}
                {g.requested === 'max' ? ' (max)' : ` / ${fmt(g.requested)}`}
                {short && ` · ${pct(g.achieved / (g.requested as number))}`}
              </span>
            </Row>
          )
        })}
        {bottlenecks.length > 0 && (
          <div className="pn-note pn-warn">Limited by {bottlenecks.map((n) => nodeLabel(n, catalog)).join(', ')}</div>
        )}
      </Section>

      <Section title="Buildings">
        {[...totals.machines].map(([id, count]) => {
          const m = catalog.machines.get(id)
          return (
            <Row key={id} icon={m && <Icon of={m} size={20} />} label={m?.name ?? id}>
              × {whole ? Math.ceil(count - 1e-6) : fmt(count)}
            </Row>
          )
        })}
        {totals.shards > 0 && (
          <Row icon={upgrades.shard && <Icon of={upgrades.shard} size={20} />} label={upgrades.shard?.name ?? 'Power shards'}>
            × {totals.shards}
          </Row>
        )}
        {totals.sloops > 0 && (
          <Row icon={upgrades.sloop && <Icon of={upgrades.sloop} size={20} />} label={upgrades.sloop?.name ?? 'Somersloops'}>
            × {totals.sloops}
          </Row>
        )}
      </Section>

      <Rates title="Resources in" rates={totals.rawResources} catalog={catalog} />
      <Rates title="Spare output" rates={totals.surplus} catalog={catalog} tone="warn" />
      <Rates title="Missing inputs" rates={totals.missingInputs} catalog={catalog} tone="bad" />

      {result.diagnostics.length > 0 && (
        <div className="warnings">
          {result.diagnostics.map((d, i) => {
            const node = d.nodeId ? plan.nodes.find((n) => n.id === d.nodeId) : undefined
            return (
              <div key={i} className={`warning ${d.severity === 'info' ? 'info' : 'error'}`}>
                {node && <strong>{nodeLabel(node, catalog)}: </strong>}
                {d.message}
              </div>
            )
          })}
        </div>
      )}

      <Section title="Settings">
        <div className="field">
          <span>Machine counts</span>
          <div className="seg seg-full">
            {(['fractional', 'underclock'] as MachineMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={plan.settings.machineMode === m ? 'active' : ''}
                onClick={() => updateSettings({ machineMode: m })}
              >
                {m === 'fractional' ? 'Fractional' : 'Whole + underclock'}
              </button>
            ))}
          </div>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Belt limit</span>
            <select value={plan.settings.beltTier ?? ''} onChange={(e) => updateSettings({ beltTier: e.target.value || undefined })}>
              <option value="">None</option>
              {belts.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name.replace('Conveyor Belt ', '')} · {t.ratePerMin}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Pipe limit</span>
            <select value={plan.settings.pipeTier ?? ''} onChange={(e) => updateSettings({ pipeTier: e.target.value || undefined })}>
              <option value="">None</option>
              {pipes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name.replace('Pipeline ', '')} · {t.ratePerMin}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="field">
          <span>Belt lines</span>
          <div className="seg seg-full">
            {(
              [
                ['step', 'Angled'],
                ['straight', 'Straight'],
                ['curved', 'Curved'],
              ] as [EdgeStyle, string][]
            ).map(([style, label]) => (
              <button key={style} type="button" className={edgeStyle === style ? 'active' : ''} onClick={() => onEdgeStyle(style)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Alternate recipes</span>
          <button type="button" className="pn-button pn-button-quiet pn-button-inline" onClick={onEditAlternates}>
            {alternates} · choose…
          </button>
        </div>
      </Section>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pn-section">
      <h4>{title}</h4>
      {children}
    </div>
  )
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="pn-row">
      {icon}
      <span className="pn-row-label">{label}</span>
      <span className="pn-row-value">{children}</span>
    </div>
  )
}

function Rates({ title, rates, catalog, tone }: { title: string; rates: ItemRate[]; catalog: Catalog; tone?: 'warn' | 'bad' }) {
  if (!rates.length) return null
  return (
    <Section title={title}>
      {rates.map((r) => {
        const item = catalog.items.get(r.item)
        return (
          <Row key={r.item} icon={item && <Icon of={item} size={20} />} label={item?.name ?? r.item}>
            <span className={tone ? `pn-${tone}` : ''}>
              {fmt(r.perMin)}
              {item && item.form !== 'solid' ? ' m³' : ''}/min
            </span>
          </Row>
        )
      })}
    </Section>
  )
}
