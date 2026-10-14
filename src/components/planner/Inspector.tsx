// Side panel for the selected node or belt: everything a card can't fit, such
// as switching recipe/alternate, machine, resource and purity nodes.

import { useState, type ReactNode } from 'react'
import type { Catalog } from '../../catalog'
import {
  defaultPurity,
  maxClock,
  minClock,
  outputMultiplier,
  sameProductRecipes,
  shardsNeeded,
  sloopSlots,
} from '../../planner'
import type { ExtractorNode, GoalNode, Plan, PlanEdge, PlanNode, RecipeNode, SolveResult, SupplyNode } from '../../planner'
import { fmt, mw, pct } from './format'
import { Icon } from './Icon'
import { nodeLabel } from './labels'
import { NumberField } from './NumberField'
import { RecipeSelect } from './RecipeSelect'
import { upgradeItems, UpgradeChip } from './Upgrades'

export interface InspectorActions {
  update: (id: string, patch: Partial<PlanNode>) => void
  setRecipe: (id: string, recipeId: string) => void
  updateEdge: (id: string, patch: Partial<PlanEdge>) => void
  removeNodes: (ids: string[]) => void
  removeEdges: (ids: string[]) => void
  duplicate: (ids: string[]) => void
}

interface InspectorProps {
  plan: Plan
  result: SolveResult
  catalog: Catalog
  selection: { nodes: string[]; edges: string[] }
  actions: InspectorActions
  /** Recipes hidden from pickers (locked alternates); still shown when already in use. */
  isRecipeHidden: (id: string) => boolean
}

export function Inspector({ plan, result, catalog, selection, actions, isRecipeHidden }: InspectorProps) {
  if (selection.nodes.length === 1 && selection.edges.length === 0) {
    const node = plan.nodes.find((n) => n.id === selection.nodes[0])
    if (!node) return null
    return (
      <aside className="pn-inspector nowheel">
        <NodeInspector key={node.id} node={node} result={result} catalog={catalog} actions={actions} isRecipeHidden={isRecipeHidden} />
      </aside>
    )
  }
  if (selection.edges.length === 1 && selection.nodes.length === 0) {
    const edge = plan.edges.find((e) => e.id === selection.edges[0])
    if (!edge) return null
    return (
      <aside className="pn-inspector nowheel">
        <EdgeInspector edge={edge} plan={plan} result={result} catalog={catalog} actions={actions} />
      </aside>
    )
  }
  if (selection.nodes.length > 1) {
    return (
      <aside className="pn-inspector">
        <h3>{selection.nodes.length} nodes selected</h3>
        <div className="pn-insp-actions">
          <button type="button" className="pn-button pn-button-quiet" onClick={() => actions.duplicate(selection.nodes)}>
            Duplicate
          </button>
          <button type="button" className="pn-button pn-button-danger" onClick={() => actions.removeNodes(selection.nodes)}>
            Delete
          </button>
        </div>
      </aside>
    )
  }
  return null
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="pn-insp-field">
      <span className="pn-insp-label">{label}</span>
      {children}
      {hint && <span className="pn-insp-hint">{hint}</span>}
    </div>
  )
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg seg-full">
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" className={v === value ? 'active' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

function ClockField({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="pn-insp-row">
      <input
        type="range"
        min={min * 100}
        max={max * 100}
        step={1}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <NumberField value={value} scale={100} min={min} max={max} suffix="%" width={62} onChange={onChange} />
    </div>
  )
}

function NodeInspector({
  node,
  result,
  catalog,
  actions,
  isRecipeHidden,
}: {
  node: PlanNode
  result: SolveResult
  catalog: Catalog
  actions: InspectorActions
  isRecipeHidden: (id: string) => boolean
}) {
  const res = result.nodes.get(node.id)
  return (
    <>
      <h3>{nodeLabel(node, catalog)}</h3>
      {node.kind === 'recipe' && <RecipeFields node={node} catalog={catalog} actions={actions} isRecipeHidden={isRecipeHidden} />}
      {node.kind === 'extractor' && <ExtractorFields node={node} catalog={catalog} actions={actions} />}
      {node.kind === 'supply' && <SupplyFields node={node} actions={actions} />}
      {node.kind === 'goal' && <GoalFields node={node} achieved={result.goals.find((g) => g.id === node.id)?.achieved ?? 0} actions={actions} />}

      {res?.resolved && node.kind !== 'goal' && (
        <div className="pn-insp-result">
          {res.capacity !== undefined && (
            <div className="pn-insp-big">
              {node.kind === 'extractor' && !node.limited ? 'These nodes give' : 'Produces up to'} <strong>{fmt(res.capacity)}/min</strong>
            </div>
          )}
          {res.capacity !== undefined && <div>Used downstream: {fmt(res.activity)}/min</div>}
          {res.setup && (
            <div className="pn-insp-row">
              {fmt(res.setup.count)} × {catalog.machines.get((node as RecipeNode).machine)?.name ?? 'machines'} @ {pct(res.setup.clock)}
            </div>
          )}
          {res.setup && node.kind === 'recipe' && (res.setup.shards > 0 || node.sloops > 0) && (
            <UpgradeTotals node={node} shardsEach={res.setup.shards} count={res.setup.count} catalog={catalog} />
          )}
          {res.clock !== undefined && <div>Runs @ {pct(res.clock)}</div>}
          {node.kind !== 'supply' && <div>⚡ {mw(res.powerMw)}</div>}
          {res.utilization !== undefined && <div>Using {pct(res.utilization)}{res.limit !== undefined ? ' of its limit' : ' of configured nodes'}</div>}
          {res.bottleneck && <div className="pn-bad">Bottleneck: this limit caps the chain.</div>}
        </div>
      )}

      <Field label="Label">
        <input
          className="pn-insp-text"
          placeholder={nodeLabel({ ...node, label: undefined }, catalog)}
          value={node.label ?? ''}
          onChange={(e) => actions.update(node.id, { label: e.target.value || undefined })}
        />
      </Field>
      <div className="pn-insp-actions">
        <button type="button" className="pn-button pn-button-quiet" onClick={() => actions.duplicate([node.id])}>
          Duplicate
        </button>
        <button type="button" className="pn-button pn-button-danger" onClick={() => actions.removeNodes([node.id])}>
          Delete
        </button>
      </div>
    </>
  )
}

function SizingField({ node, actions }: { node: RecipeNode | ExtractorNode | SupplyNode; actions: InspectorActions }) {
  return (
    <Field
      label="Sizing"
      hint={node.limited ? 'A limit: this is all you have. Other nodes adapt to it.' : 'Sizes itself from the targets and limits around it.'}
    >
      <Seg value={node.limited ? 1 : 0} options={[[0, 'Auto'], [1, '⛔ Limit']]} onChange={(v) => actions.update(node.id, { limited: v === 1 })} />
    </Field>
  )
}

function RecipeFields({
  node,
  catalog,
  actions,
  isRecipeHidden,
}: {
  node: RecipeNode
  catalog: Catalog
  actions: InspectorActions
  isRecipeHidden: (id: string) => boolean
}) {
  const recipe = catalog.recipes.get(node.recipe)
  const machine = catalog.machines.get(node.machine)
  if (!recipe || !machine) return <p className="pn-dim">This recipe isn't in the loaded game data.</p>
  const options = sameProductRecipes(catalog, node.recipe)
    .map((id) => catalog.recipes.get(id)!)
    .filter((r) => r.id === node.recipe || !isRecipeHidden(r.id))
  const slots = sloopSlots(machine)
  const boost = outputMultiplier(machine, node.sloops)
  const shards = shardsNeeded(machine, node.clock)
  const upgrades = upgradeItems(machine, catalog)

  return (
    <>
      <Field label="Recipe" hint={options.length > 1 ? 'Per machine at 100%. Hover an icon for the item name.' : undefined}>
        <RecipeSelect value={node.recipe} options={options} catalog={catalog} onChange={(id) => actions.setRecipe(node.id, id)} />
      </Field>
      {recipe.machines.length > 1 ? (
        <Field label="Machine">
          <select value={node.machine} onChange={(e) => actions.update(node.id, { machine: e.target.value })}>
            {recipe.machines.map((id) => (
              <option key={id} value={id}>
                {catalog.machines.get(id)?.name ?? id}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label="Machine">
          <div className="pn-insp-row">
            <Icon of={machine} size={22} />
            {machine.name}
          </div>
        </Field>
      )}
      <SizingField node={node} actions={actions} />
      {node.limited && (
        <Field label="Machines you have">
          <NumberField value={node.count} min={0} step={1} width={80} onChange={(count) => actions.update(node.id, { count })} />
        </Field>
      )}
      <Field
        label={node.limited ? 'Clock speed' : 'Preferred clock speed'}
        hint={
          shards > 0 ? (
            <span className="pn-insp-row">
              Needs <UpgradeChip item={upgrades.shard} count={shards} fallback="◆" title="per machine" size={16} /> per machine
            </span>
          ) : undefined
        }
      >
        <ClockField value={node.clock} min={minClock(machine)} max={maxClock(machine)} onChange={(clock) => actions.update(node.id, { clock })} />
      </Field>
      {slots > 0 && <SloopField slots={slots} sloops={node.sloops} item={upgrades.sloop} boost={boost} onChange={(sloops) => actions.update(node.id, { sloops })} />}
    </>
  )
}

function ExtractorFields({ node, catalog, actions }: { node: ExtractorNode; catalog: Catalog; actions: InspectorActions }) {
  const [mixed, setMixed] = useState(() => new Set(node.sites.filter((s) => s.count > 0).map((s) => s.purity)).size > 1)
  const machine = catalog.machines.get(node.machine)
  const spec = machine?.extraction
  if (!machine || !spec) return <p className="pn-dim">This extractor isn't in the loaded game data.</p>
  const extractors = (catalog.extractorsFor.get(node.resource) ?? []).map((id) => catalog.machines.get(id)!)
  const tiers = [...catalog.purities.values()].sort((a, b) => a.order - b.order)
  const total = node.sites.reduce((s, x) => s + x.count, 0)
  const countOf = (purity: string) => node.sites.filter((s) => s.purity === purity).reduce((s, x) => s + x.count, 0)
  const setCount = (purity: string, count: number) => {
    const sites = tiers
      .map((t) => ({ purity: t.id, count: t.id === purity ? count : countOf(t.id) }))
      .filter((s) => s.count > 0)
    actions.update(node.id, { sites })
  }
  // Single-purity groups (the usual case): one purity choice plus a count.
  const purity = node.sites.find((s) => s.count > 0)?.purity ?? defaultPurity(catalog)
  const setSingle = (p: string, count: number) => actions.update(node.id, { sites: count > 0 ? [{ purity: p, count }] : [] })
  const slots = sloopSlots(machine)
  const what = spec.poweredBy ? 'satellite node' : 'node'

  return (
    <>
      <Field label="Resource">
        <select value={node.resource} onChange={(e) => actions.update(node.id, { resource: e.target.value })}>
          {spec.resources.map((id) => (
            <option key={id} value={id}>
              {catalog.items.get(id)?.name ?? id}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Extractor" hint={`${fmt(spec.ratePerMin)}/min per ${spec.usesPurity ? 'normal ' : ''}${what} at 100%`}>
        {extractors.length > 1 && extractors.length <= 4 ? (
          <Seg
            value={node.machine}
            options={extractors.map((m): [string, string] => [m.id, m.name.replace(/^Miner /, '')])}
            onChange={(id) => actions.update(node.id, { machine: id })}
          />
        ) : (
          <select value={node.machine} onChange={(e) => actions.update(node.id, { machine: e.target.value })}>
            {extractors.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {spec.usesPurity && !mixed && (
        <Field label="Purity">
          <Seg value={purity} options={tiers.map((t): [string, string] => [t.id, t.name])} onChange={(p) => setSingle(p, Math.max(1, total))} />
        </Field>
      )}
      <Field label={spec.usesPurity && mixed ? `${what[0].toUpperCase()}${what.slice(1)}s by purity` : `How many ${what}s`}>
        {spec.usesPurity && mixed ? (
          tiers.map((t) => (
            <div key={t.id} className="pn-insp-row pn-insp-purity">
              <span>{t.name}</span>
              <span className="pn-dim">×{t.multiplier}</span>
              <Stepper value={countOf(t.id)} onChange={(c) => setCount(t.id, c)} />
            </div>
          ))
        ) : (
          <div className="pn-insp-row pn-insp-purity">
            <span>{spec.usesPurity ? `${catalog.purities.get(purity)?.name ?? ''} ${what}s` : 'Extractors'}</span>
            <Stepper value={total} onChange={(c) => setSingle(purity, c)} />
          </div>
        )}
        {spec.usesPurity && (
          <button
            type="button"
            className="pn-link"
            onClick={() => {
              if (mixed) setSingle(purity, total)
              setMixed(!mixed)
            }}
          >
            {mixed ? 'Use a single purity' : 'Mixed purities…'}
          </button>
        )}
      </Field>
      <SizingField node={node} actions={actions} />
      <Field label="Clock speed" hint={node.limited ? 'What these nodes give at this clock is the limit.' : undefined}>
        <ClockField value={node.clock} min={minClock(machine)} max={maxClock(machine)} onChange={(clock) => actions.update(node.id, { clock })} />
      </Field>
      {slots > 0 && (
        <SloopField
          slots={slots}
          sloops={node.sloops}
          item={upgradeItems(machine, catalog).sloop}
          boost={outputMultiplier(machine, node.sloops)}
          onChange={(sloops) => actions.update(node.id, { sloops })}
        />
      )}
    </>
  )
}

/** Total power shards and Somersloops a recipe group needs, with their icons. */
function UpgradeTotals({ node, shardsEach, count, catalog }: { node: RecipeNode; shardsEach: number; count: number; catalog: Catalog }) {
  const machine = catalog.machines.get(node.machine)
  const { shard, sloop } = upgradeItems(machine, catalog)
  const built = Math.ceil(count - 1e-6)
  const sloops = Math.min(node.sloops, sloopSlots(machine!)) * built
  return (
    <div className="pn-insp-row">
      Needs
      {shardsEach > 0 && <UpgradeChip item={shard} count={shardsEach * built} fallback="◆" title={`${shard?.name ?? 'Power shards'} in total`} size={18} />}
      {sloops > 0 && <UpgradeChip item={sloop} count={sloops} fallback="◉" title={`${sloop?.name ?? 'Somersloops'} in total`} size={18} />}
      in total
    </div>
  )
}

/**
 * Production amplification. Most players fill every slot (always ×2 output),
 * so that's a single toggle; partly filled slots (vanilla allows it, e.g. 1 of
 * 2 for ×1.5) are behind "partial".
 */
function SloopField({
  slots,
  sloops,
  item,
  boost,
  onChange,
}: {
  slots: number
  sloops: number
  item?: { name: string; icon?: string; color?: string }
  boost: number
  onChange: (sloops: number) => void
}) {
  const filled = Math.min(sloops, slots)
  const [partial, setPartial] = useState(filled > 0 && filled < slots)
  const name = item?.name ?? 'Somersloop'
  const power = (1 + filled / slots) ** 2
  return (
    <Field
      label="Production amplifier"
      hint={
        filled > 0
          ? `×${fmt(boost)} output with the same inputs · ×${fmt(power)} power`
          : `Doubles output without extra inputs. Needs ${slots} ${name}${slots > 1 ? 's' : ''} per machine.`
      }
    >
      <label className="pn-toggle">
        <input type="checkbox" checked={filled === slots} onChange={(e) => onChange(e.target.checked ? slots : 0)} />
        <span className="pn-toggle-track" />
        {item && <Icon of={item} size={22} />}
        <span>
          Amplify ×2 · {slots} {name}
          {slots > 1 ? 's' : ''} per machine
        </span>
      </label>
      {slots > 1 &&
        (partial ? (
          <div className="pn-insp-row pn-insp-purity">
            <span>Partly filled</span>
            <Stepper value={filled} onChange={(v) => onChange(Math.min(slots, v))} />
            <span className="pn-dim">of {slots}</span>
          </div>
        ) : (
          <button type="button" className="pn-link" onClick={() => setPartial(true)}>
            Partial…
          </button>
        ))}
    </Field>
  )
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className="pn-stepper">
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0}>
        −
      </button>
      <span>{value}</span>
      <button type="button" onClick={() => onChange(value + 1)}>
        +
      </button>
    </span>
  )
}

function SupplyFields({ node, actions }: { node: SupplyNode; actions: InspectorActions }) {
  return (
    <>
      <SizingField node={node} actions={actions} />
      {node.limited && (
        <Field label="Available per minute">
          <NumberField value={node.perMin} min={0} width={90} suffix="/min" onChange={(perMin) => actions.update(node.id, { perMin })} />
        </Field>
      )}
    </>
  )
}

function GoalFields({ node, achieved, actions }: { node: GoalNode; achieved: number; actions: InspectorActions }) {
  const isMax = node.target === 'max'
  return (
    <>
      <Field label="Target" hint={isMax ? 'As much as the limits upstream allow.' : 'Upstream nodes size themselves to deliver this.'}>
        <Seg
          value={isMax ? 'max' : 'rate'}
          options={[['rate', '🎯 Rate'], ['max', 'Max']]}
          onChange={(v) => actions.update(node.id, { target: v === 'max' ? 'max' : Math.round(achieved * 100) / 100 || 60 })}
        />
      </Field>
      {!isMax && (
        <Field label="Per minute">
          <NumberField value={node.target as number} min={0} width={90} suffix="/min" onChange={(target) => actions.update(node.id, { target })} />
        </Field>
      )}
    </>
  )
}

function EdgeInspector({
  edge,
  plan,
  result,
  catalog,
  actions,
}: {
  edge: PlanEdge
  plan: Plan
  result: SolveResult
  catalog: Catalog
  actions: InspectorActions
}) {
  const item = catalog.items.get(edge.item)
  const from = plan.nodes.find((n) => n.id === edge.source)
  const to = plan.nodes.find((n) => n.id === edge.target)
  const siblings = plan.edges.filter((e) => e.target === edge.target && e.item === edge.item)
  const r = result.edges.get(edge.id)

  return (
    <>
      <h3 className="pn-insp-title">
        {item && <Icon of={item} size={24} />}
        {item?.name ?? 'Belt'}
      </h3>
      <div className="pn-insp-result">
        <div>
          {from ? nodeLabel(from, catalog) : '?'} → {to ? nodeLabel(to, catalog) : '?'}
        </div>
        <div>
          {fmt(r?.perMin ?? 0)}
          {item && item.form !== 'solid' ? ' m³' : ''}/min
        </div>
        {r?.overCapacity !== undefined && <div className="pn-bad">Over the {fmt(r.overCapacity)}/min limit</div>}
      </div>
      {siblings.length > 1 && (
        <Field label="Share of demand" hint={`${siblings.length} belts feed this input; demand is split by share.`}>
          <NumberField value={edge.share ?? 1} min={0} step={1} width={80} onChange={(share) => actions.updateEdge(edge.id, { share })} />
        </Field>
      )}
      <div className="pn-insp-actions">
        <button type="button" className="pn-button pn-button-danger" onClick={() => actions.removeEdges([edge.id])}>
          Delete belt
        </button>
      </div>
    </>
  )
}
