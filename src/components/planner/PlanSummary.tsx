import type { Catalog, ItemId } from '../../catalog'
import { buildCost, worldUsage } from '../../planner'
import type { ItemRate, MachineMode, Plan, PlanSettings, SolveResult } from '../../planner'
import { AvoidChips } from './AvoidChips'
import { fmt, mw, pct, tierName } from './format'
import { Icon } from './Icon'
import { nodeLabel } from './labels'
import type { EdgeStyle } from './storage'

/** Left panel: goals, totals, what goes in and out, and plan settings. */
export function PlanSummary({
  plan,
  result,
  catalog,
  updateSettings,
  recipes,
  onEditRecipes,
  edgeStyle,
  onEdgeStyle,
  buildReuse,
  onBuildReuse,
  onBuild,
  onEditWorld,
  onAvoid,
}: {
  plan: Plan
  result: SolveResult
  catalog: Catalog
  updateSettings: (patch: Partial<PlanSettings>) => void
  /** e.g. "Tier 5 · 180 of 293 usable" */
  recipes: string
  onEditRecipes: () => void
  edgeStyle: EdgeStyle
  onEdgeStyle: (style: EdgeStyle) => void
  buildReuse: boolean
  onBuildReuse: (reuse: boolean) => void
  /** ⚡ Build chain for every unconnected input of an item, or of every item. */
  onBuild: (item?: ItemId) => void
  /** Opens the world node counts. */
  onEditWorld: () => void
  /** Sets the plan's "Don't use" list. */
  onAvoid: (avoid: ItemId[]) => void
}) {
  const { totals } = result
  const net = totals.generatedMw - totals.powerMw
  const hasGenerators = plan.nodes.some((n) => n.kind === 'recipe' && catalog.machines.get(n.machine)?.generation)
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

      <div className={`stats${hasGenerators ? ' pn-stats-power' : ''}`}>
        <div className="stat">
          <span className="stat-value">{mw(totals.powerMw)}</span>
          <span className="stat-label">{hasGenerators ? 'power used' : 'power'}</span>
        </div>
        {hasGenerators && (
          <div className="stat">
            <span className="stat-value pn-power-made">{mw(totals.generatedMw)}</span>
            <span className="stat-label">power made</span>
          </div>
        )}
        {hasGenerators && (
          <div className="stat">
            <span className={`stat-value ${net < -1e-6 ? 'pn-bad' : 'pn-good'}`}>
              {net > 1e-6 ? '+' : ''}
              {mw(net)}
            </span>
            <span className="stat-label">{net < -1e-6 ? 'net · short' : 'net · spare'}</span>
          </div>
        )}
        <div className="stat">
          <span className="stat-value">{buildingCount}</span>
          <span className="stat-label">buildings</span>
        </div>
      </div>

      <Section title="Goals">
        {result.goals.map((g) => {
          const item = catalog.items.get(g.item)
          const short = g.requested !== 'max' && g.achieved < g.requested - 1e-6
          if (g.power) {
            const node = plan.nodes.find((n) => n.id === g.id)!
            const m = node.kind === 'recipe' ? catalog.machines.get(node.machine) : undefined
            return (
              <Row key={g.id} icon={m && <Icon of={m} size={20} />} label={nodeLabel(node, catalog)}>
                <span className={short ? 'pn-bad' : 'pn-good'}>
                  {mw(g.achieved)}
                  {g.requested === 'max' ? ' (max)' : ` / ${mw(g.requested)}`}
                  {short && ` · ${pct(g.achieved / (g.requested as number))}`}
                </span>
              </Row>
            )
          }
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
      <WorldSection plan={plan} result={result} catalog={catalog} />
      <Rates title="Spare output" rates={totals.surplus} catalog={catalog} tone="warn" />
      <Rates
        title="Missing inputs"
        rates={totals.missingInputs}
        catalog={catalog}
        tone="bad"
        onBuild={onBuild}
        action={
          totals.missingInputs.length > 1 && (
            <button type="button" className="pn-build-all" onClick={() => onBuild()} title="Build chains for every missing input, back to raw resources">
              ⚡ Build all
            </button>
          )
        }
      />

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

      <BuildSections plan={plan} result={result} catalog={catalog} />

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
              <option value="">No limit</option>
              {belts.map((t) => (
                <option key={t.id} value={t.id}>
                  {tierName(t)} · {t.ratePerMin}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Pipe limit</span>
            <select value={plan.settings.pipeTier ?? ''} onChange={(e) => updateSettings({ pipeTier: e.target.value || undefined })}>
              <option value="">No limit</option>
              {pipes.map((t) => (
                <option key={t.id} value={t.id}>
                  {tierName(t)} · {t.ratePerMin}
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
          <span>⚡ Build chain</span>
          <div className="seg seg-full">
            {(
              [
                [true, 'Reuse existing nodes'],
                [false, 'Always add new'],
              ] as [boolean, string][]
            ).map(([reuse, label]) => (
              <button key={label} type="button" className={buildReuse === reuse ? 'active' : ''} onClick={() => onBuildReuse(reuse)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span title="✨ Optimize and ⚡ Build chain add no new extractors for these. The plan's own extractors and supplies still count.">
            Don't use
          </span>
          <AvoidChips catalog={catalog} avoid={plan.settings.avoid ?? []} onChange={onAvoid} />
        </div>
        <div className="field">
          <span>World nodes</span>
          <button type="button" className="pn-button pn-button-quiet pn-button-inline" onClick={onEditWorld}>
            {plan.settings.world ? 'This plan\'s own counts' : (catalog.maps.values().next().value?.name ?? 'No map')} · edit…
          </button>
        </div>
        <div className="field">
          <span>Recipes</span>
          <button type="button" className="pn-button pn-button-quiet pn-button-inline" onClick={onEditRecipes}>
            {recipes} · choose…
          </button>
        </div>
      </Section>
    </>
  )
}

/**
 * Build checklist progress, and what the buildings cost: the total, and once
 * nodes are marked done, what's still needed.
 */
function BuildSections({ plan, result, catalog }: { plan: Plan; result: SolveResult; catalog: Catalog }) {
  if (!plan.nodes.length) return null
  const cost = buildCost(plan, result, catalog)
  const tracking = plan.nodes.some((n) => n.done)
  const left = cost.needed.filter((a) => a.amount > 0).length
  return (
    <>
      <Section title="Build checklist">
        <div className="pn-progress" title={`${cost.done} of ${cost.nodes} nodes marked done`}>
          <div style={{ width: `${(100 * cost.done) / cost.nodes}%` }} />
        </div>
        <div className="pn-row">
          <span className="pn-row-label">
            {cost.done} of {cost.nodes} nodes done
          </span>
          {!tracking && <span className="pn-dim pn-row-hint">Tick ✓ on a card once it's built</span>}
        </div>
        {cost.behind > 0 && (
          <div className="pn-note pn-warn">
            {cost.behind === 1 ? '1 node needs' : `${cost.behind} nodes need`} more machines than when marked done
          </div>
        )}
      </Section>
      {(cost.total.length > 0 || cost.unknown.length > 0) && (
        <Section title="Build cost" action={tracking && <span className="pn-section-legend">still needed / total</span>}>
          {cost.total.map((a, i) => {
            const item = catalog.items.get(a.item)
            const needed = cost.needed[i].amount
            return (
              <Row key={a.item} icon={item && <Icon of={item} size={20} />} label={item?.name ?? a.item}>
                {tracking ? (
                  <>
                    <span className={needed > 0 ? '' : 'pn-good'}>{fmt(needed)}</span>
                    <span className="pn-dim"> / {fmt(a.amount)}</span>
                  </>
                ) : (
                  fmt(a.amount)
                )}
              </Row>
            )
          })}
          {tracking && cost.total.length > 0 && left === 0 && <div className="pn-note pn-good">Everything is built.</div>}
          {cost.unknown.length > 0 && (
            <div className="pn-note pn-dim">
              Cost unknown for {cost.unknown.map((id) => catalog.machines.get(id)?.name ?? id).join(', ')}.
            </div>
          )}
        </Section>
      )}
    </>
  )
}

/** Resource nodes and well satellites the plan's extractors take, against what the map has. */
function WorldSection({ plan, result, catalog }: { plan: Plan; result: SolveResult; catalog: Catalog }) {
  const use = worldUsage(plan, result, catalog)
  if (!use.length) return null
  const purity = (id: string) => catalog.purities.get(id)?.name ?? id
  return (
    <Section title="World nodes" action={<span className="pn-section-legend">used / on the map</span>}>
      {use.map((u) => {
        const item = catalog.items.get(u.resource)
        return (
          <Row key={u.resource + u.site} icon={item && <Icon of={item} size={20} />} label={`${item?.name ?? u.resource}${u.site === 'well' ? ' (wells)' : ''}`}>
            <span className={u.over ? 'pn-bad' : ''} title={u.purities.map((p) => `${purity(p.purity)}: ${p.used} of ${p.available}`).join(' · ')}>
              {u.used} / {u.available}
            </span>
          </Row>
        )
      })}
      {use.some((u) => u.over) && (
        <div className="pn-note pn-bad">
          More nodes than the map has: {use.filter((u) => u.over).map((u) => catalog.items.get(u.resource)?.name ?? u.resource).join(', ')}. Hover a count for each purity.
        </div>
      )}
    </Section>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="pn-section">
      <h4>
        {title}
        {action}
      </h4>
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

function Rates({
  title,
  rates,
  catalog,
  tone,
  action,
  onBuild,
}: {
  title: string
  rates: ItemRate[]
  catalog: Catalog
  tone?: 'warn' | 'bad'
  action?: React.ReactNode
  /** Adds a ⚡ button per row. */
  onBuild?: (item: ItemId) => void
}) {
  if (!rates.length) return null
  return (
    <Section title={title} action={action}>
      {rates.map((r) => {
        const item = catalog.items.get(r.item)
        return (
          <Row key={r.item} icon={item && <Icon of={item} size={20} />} label={item?.name ?? r.item}>
            <span className={tone ? `pn-${tone}` : ''}>
              {fmt(r.perMin)}
              {item && item.form !== 'solid' ? ' m³' : ''}/min
            </span>
            {onBuild && (
              <button
                type="button"
                className="pn-build-row"
                onClick={() => onBuild(r.item)}
                title={`Build chain: ${item?.name ?? 'this item'} and everything it needs, back to raw resources`}
                aria-label={`Build chain for ${item?.name ?? r.item}`}
              >
                ⚡
              </button>
            )}
          </Row>
        )
      })}
    </Section>
  )
}
