// Compact node cards, in the spirit of Satisfactory Modeler: the machine (or
// item) in the middle with its count, input items down the left edge and
// output items down the right edge, each with its connection handle
// (`in:<itemId>` / `out:<itemId>`) so belts only join matching items. Rates
// live on the belts, or under the item while a port has no belt yet;
// everything else is in the hover tooltip and the inspector.

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { ReactNode } from 'react'
import type { Item, ItemId } from '../../catalog'
import type { ExtractorNode, GoalNode, InputPort, NodeResult, OutputPort, PlanNode, RecipeNode, SupplyNode } from '../../planner'
import { sloopSlots } from '../../planner'
import { fmt, mw, pct } from './format'
import { Icon } from './Icon'
import { usePlanner } from './plannerContext'
import { upgradeItems, UpgradeChip } from './Upgrades'

const EPS = 1e-6

export type PlanNodeData = { node: PlanNode }
export type PlanFlowNode = Node<PlanNodeData>

export const inHandle = (item: ItemId) => `in:${item}`
export const outHandle = (item: ItemId) => `out:${item}`
export const handleItem = (handle: string | null | undefined) => handle?.replace(/^(in|out):/, '')

const UNKNOWN_ITEM = (id: ItemId): Item => ({ id, name: id.split(':').pop() ?? id, form: 'solid' })

function useItem(id: ItemId): Item {
  return usePlanner().catalog.items.get(id) ?? UNKNOWN_ITEM(id)
}

const unit = (item: Item) => (item.form === 'solid' ? '/min' : ' m³/min')

function InPort({ nodeId, port }: { nodeId: string; port: InputPort }) {
  const { result } = usePlanner()
  const item = useItem(port.item)
  const missing = !port.connected && port.needed > EPS
  const merge = result.merges.find((m) => m.node === nodeId && m.item === port.item)
  const tip =
    `${item.name}: needs ${fmt(port.needed)}${unit(item)}` +
    (missing ? ' — not connected. Drag onto a node to connect, or onto empty space to add a producer.' : '') +
    (port.connected ? ' — drag to move its belt to another node, or onto empty space to remove it.' : '') +
    (merge ? ` · ${merge.edges.length} belts merge here` : '')
  return (
    <div className={`pn-port pn-port-in${missing ? ' pn-port-missing pn-port-rated' : ''}${port.connected ? ' pn-port-connected' : ''}`}>
      <Icon of={item} size={24} title={tip} />
      {missing && <span className="pn-port-rate">{fmt(port.needed)}</span>}
      {merge && <span className="pn-port-mark">⑃</span>}
      <Handle type="target" position={Position.Left} id={inHandle(port.item)} className={`pn-handle pn-${item.form}`} title={tip} />
    </div>
  )
}

function OutPort({ nodeId, port, capacity }: { nodeId: string; port: OutputPort; capacity?: number }) {
  const { result, openSplit } = usePlanner()
  const item = useItem(port.item)
  // Sources with a fixed capacity: anything not used is spare too.
  const spare = Math.max(port.produced, capacity ?? 0) - port.used
  const split = result.splits.find((s) => s.node === nodeId && s.item === port.item)
  // Nothing connected yet: show the rate on the card, not only in the
  // tooltip. (An open end's output counts as used, so this isn't `spare`.)
  const out = Math.max(port.produced, capacity ?? 0)
  const loose = !port.connected && out > EPS
  const tip =
    `${item.name}: makes ${fmt(port.produced)}${unit(item)}${spare > EPS ? ` · ${fmt(spare)} spare` : ''}` +
    ' — drag onto a node to connect, or onto empty space to add a consumer.'
  return (
    <div className={`pn-port pn-port-out${spare > EPS ? ' pn-port-spare' : ''}${loose ? ' pn-port-rated' : ''}`}>
      <Icon of={item} size={24} title={tip} />
      {loose && <span className="pn-port-rate">{fmt(out)}</span>}
      <Handle type="source" position={Position.Right} id={outHandle(port.item)} className={`pn-handle pn-${item.form}`} title={tip} />
      {split && (
        <button
          type="button"
          className="pn-port-split nodrag"
          title={`Splits into ${split.edges.length} belts: show a load balancer`}
          onClick={() => openSplit(nodeId, port.item)}
        >
          ⑂
        </button>
      )}
    </div>
  )
}

/** The shared card frame: ports on the sides, a center block, corner badges. */
function Card({
  res,
  selected,
  kind,
  tip,
  badges,
  children,
  tint,
}: {
  res: NodeResult | undefined
  selected: boolean
  kind: string
  tip: string
  badges?: ReactNode
  children: ReactNode
  tint?: 'good' | 'bad'
}) {
  const cls = [
    'pn-card',
    `pn-${kind}`,
    selected && 'selected',
    res?.bottleneck && 'pn-bottleneck',
    res && !res.resolved && 'pn-unresolved',
    tint && `pn-tint-${tint}`,
  ]
  return (
    <div className={cls.filter(Boolean).join(' ')} title={tip}>
      <div className="pn-side pn-side-in">
        {res?.inputs.map((p) => <InPort key={p.item} nodeId={res.id} port={p} />)}
      </div>
      <div className="pn-center">{children}</div>
      <div className="pn-side pn-side-out">
        {res?.outputs.map((p) => <OutPort key={p.item} nodeId={res.id} port={p} capacity={res.limit !== undefined ? res.capacity : undefined} />)}
      </div>
      {badges && <div className="pn-badges">{badges}</div>}
    </div>
  )
}

function Unresolved({ node, selected }: { node: PlanNode; selected: boolean }) {
  return (
    <div className={`pn-card pn-unresolved${selected ? ' selected' : ''}`} title="Uses content from a pack that isn't loaded">
      <div className="pn-center">
        <span className="pn-big">?</span>
        <span className="pn-small">{node.kind}</span>
      </div>
    </div>
  )
}

function Label({ node }: { node: PlanNode }) {
  return node.label ? <span className="pn-label">{node.label}</span> : null
}

function LimitBadge({ on }: { on: boolean }) {
  return on ? (
    <span className="pn-b pn-b-limit" title="Limit: this is all you have">
      ⛔
    </span>
  ) : null
}

function RecipeCard({ data, selected }: NodeProps<PlanFlowNode>) {
  const node = data.node as RecipeNode
  const { catalog, result } = usePlanner()
  const res = result.nodes.get(node.id)
  const recipe = catalog.recipes.get(node.recipe)
  const machine = catalog.machines.get(node.machine)
  if (!recipe || !machine || !res?.resolved) return <Unresolved node={node} selected={selected} />
  const setup = res.setup!
  const sloops = Math.min(node.sloops, sloopSlots(machine))
  const built = Math.ceil(setup.count - EPS)
  const upgrades = upgradeItems(machine, catalog)
  const made = res.generatedMw
  const goal = result.goals.find((g) => g.id === node.id)
  const short = goal && goal.requested !== 'max' && goal.achieved < goal.requested - EPS
  const tip = [
    `${recipe.name}${recipe.alternate ? ' (alternate)' : ''}`,
    `${fmt(setup.count)} × ${machine.name} @ ${pct(setup.clock)}`,
    made !== undefined ? `⚡ makes ${mw(made)}` : `⚡ ${mw(res.powerMw)}`,
    node.power === 'max' ? 'Burns all the fuel it can get (Max)' : '',
    typeof node.power === 'number' ? `Target: ${mw(node.power)}${short ? ` (${pct(goal!.achieved / node.power)})` : ''}` : '',
    node.limited ? `Limit: ${fmt(node.count)} machines${res.utilization !== undefined ? `, using ${pct(res.utilization)}` : ''}` : '',
    res.bottleneck ? 'Bottleneck' : '',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <Card
      res={res}
      selected={selected}
      kind={made !== undefined ? 'recipe pn-generator' : 'recipe'}
      tip={tip}
      tint={goal ? (short || goal.achieved <= EPS ? 'bad' : 'good') : undefined}
      badges={
        <>
          {node.power !== undefined && (
            <span className="pn-b pn-b-power" title={node.power === 'max' ? 'Max: burns all the fuel it can get' : `Target: ${mw(node.power)}`}>
              {node.power === 'max' ? 'MAX' : '🎯'}
            </span>
          )}
          {recipe.alternate && <span className="pn-b pn-b-alt">ALT</span>}
          {setup.shards > 0 && (
            <span className="pn-b pn-b-up">
              <UpgradeChip
                item={upgrades.shard}
                count={setup.shards * built}
                fallback="◆"
                title={`${setup.shards} ${upgrades.shard?.name ?? 'power shard'}(s) per machine × ${built}`}
              />
            </span>
          )}
          {sloops > 0 && (
            <span className="pn-b pn-b-up">
              <UpgradeChip
                item={upgrades.sloop}
                count={sloops * built}
                fallback="◉"
                title={`${sloops} ${upgrades.sloop?.name ?? 'Somersloop'}(s) per machine × ${built}`}
              />
            </span>
          )}
          <LimitBadge on={node.limited} />
        </>
      }
    >
      <Icon of={machine} size={48} title={tip} />
      <span className="pn-big">{fmt(setup.count)}</span>
      {Math.abs(setup.clock - 1) > EPS && <span className="pn-small">@ {pct(setup.clock)}</span>}
      {made !== undefined && <span className="pn-small pn-power-made">⚡ {mw(made)}</span>}
      <Label node={node} />
    </Card>
  )
}

function ExtractorCard({ data, selected }: NodeProps<PlanFlowNode>) {
  const node = data.node as ExtractorNode
  const { catalog, result } = usePlanner()
  const res = result.nodes.get(node.id)
  const machine = catalog.machines.get(node.machine)
  const resource = catalog.items.get(node.resource)
  if (!machine || !resource || !res?.resolved) return <Unresolved node={node} selected={selected} />
  const usesPurity = machine.extraction?.usesPurity !== false
  const sites = node.sites
    .filter((s) => s.count > 0)
    .map((s) => `${s.count}× ${usesPurity ? (catalog.purities.get(s.purity)?.name ?? '') : ''}`.trim())
    .join(', ')
  const needsMore = !node.limited && (res.utilization ?? 0) > 1 + EPS
  const capacity = res.capacity ?? 0
  // Extractors built anywhere (water) size their own count, like machines.
  const setup = res.setup
  const tip = (
    setup
      ? [
          `${resource.name} — ${fmt(setup.count)} × ${machine.name} @ ${pct(setup.clock)}`,
          `Supplies ${fmt(res.activity)}${unit(resource)} · ⚡ ${mw(res.powerMw)}`,
        ]
      : [
          `${resource.name} — ${machine.name} on ${sites || 'no'} node(s)`,
          node.limited
            ? `Produces up to ${fmt(capacity)}${unit(resource)}, using ${fmt(res.activity)}`
            : `Supplies ${fmt(res.activity)}${unit(resource)} (these nodes give ${fmt(capacity)})`,
          `Runs @ ${pct(res.clock ?? 0)} · ⚡ ${mw(res.powerMw)}`,
          needsMore ? `Needs ${pct(res.utilization!)} of these nodes` : '',
        ]
  )
    .concat(res.bottleneck ? 'Bottleneck' : '')
    .filter(Boolean)
    .join('\n')

  return (
    <Card res={res} selected={selected} kind="extractor" tip={tip} badges={<LimitBadge on={node.limited} />}>
      <Icon of={machine} size={48} title={tip} />
      <span className={`pn-big${needsMore ? ' pn-bad' : ''}`}>
        {fmt(node.limited ? capacity : res.activity)}
        <span className="pn-unit">{unit(resource)}</span>
      </span>
      <span className="pn-small">
        {setup ? `${fmt(setup.count)}×${Math.abs(setup.clock - 1) > EPS ? ` @ ${pct(setup.clock)}` : ''}` : sites}
      </span>
      {node.limited && res.activity < capacity - EPS && <span className="pn-small pn-warn">using {fmt(res.activity)}</span>}
      <Label node={node} />
    </Card>
  )
}

function SupplyCard({ data, selected }: NodeProps<PlanFlowNode>) {
  const node = data.node as SupplyNode
  const { result } = usePlanner()
  const res = result.nodes.get(node.id)
  const item = useItem(node.item)
  if (!res?.resolved) return <Unresolved node={node} selected={selected} />
  const tip = node.limited
    ? `${item.name} supply: using ${fmt(res.activity)} of ${fmt(node.perMin)}${unit(item)}`
    : `${item.name} supply: bring in ${fmt(res.activity)}${unit(item)}`

  return (
    <Card res={res} selected={selected} kind="supply" tip={tip} badges={<LimitBadge on={node.limited} />}>
      <Icon of={item} size={44} title={tip} />
      <span className="pn-big">
        {fmt(node.limited ? node.perMin : res.activity)}
        <span className="pn-unit">{unit(item)}</span>
      </span>
      {node.limited && res.activity < node.perMin - EPS && <span className="pn-small pn-warn">using {fmt(res.activity)}</span>}
      <Label node={node} />
    </Card>
  )
}

function GoalCard({ data, selected }: NodeProps<PlanFlowNode>) {
  const node = data.node as GoalNode
  const { result } = usePlanner()
  const res = result.nodes.get(node.id)
  const goal = result.goals.find((g) => g.id === node.id)
  const item = useItem(node.item)
  if (!res?.resolved || !goal) return <Unresolved node={node} selected={selected} />
  const isMax = node.target === 'max'
  const short = !isMax && goal.achieved < (node.target as number) - EPS
  const tip = isMax
    ? `${item.name} goal: as much as possible — ${fmt(goal.achieved)}${unit(item)}`
    : `${item.name} goal: ${fmt(goal.achieved)} of ${fmt(node.target as number)}${unit(item)}${short ? ` (${pct(goal.achieved / (node.target as number))})` : ''}`

  return (
    <Card res={res} selected={selected} kind="goal" tip={tip} tint={short || goal.achieved <= EPS ? 'bad' : 'good'}>
      <Icon of={item} size={44} title={tip} />
      <span className="pn-big">{fmt(goal.achieved)}</span>
      <span className="pn-small">{isMax ? 'max' : `of ${fmt(node.target as number)}`}</span>
      <Label node={node} />
    </Card>
  )
}

export const nodeTypes = {
  recipe: RecipeCard,
  extractor: ExtractorCard,
  supply: SupplyCard,
  goal: GoalCard,
}
