import type { Catalog, ItemAmount, Recipe } from '../../catalog'
import type { RecipeAtRate } from '../../planner'
import { fmt, mw, pct } from './format'
import { Icon } from './Icon'

/**
 * A recipe's ingredients → products as small icons with per-minute amounts
 * for one machine at 100%, so recipes can be compared at a glance. Generators
 * also show the power they make. Given `at`, the amounts are for a whole
 * group sized to a node's rate instead, with its machine count and power.
 */
export function RecipeIO({
  recipe,
  catalog,
  size = 18,
  showMachine = true,
  at,
}: {
  recipe: Recipe
  catalog: Catalog
  size?: number
  showMachine?: boolean
  at?: RecipeAtRate
}) {
  const machine = at?.machine ?? catalog.machines.get(recipe.machines[0])
  const perMin = (60 / recipe.durationSec) * (machine?.speed ?? 1)
  const scaled = at && new Map([...at.flows.inputs, ...at.flows.outputs].map((f) => [f.item, f.perMin]))
  const machines = at ? at.setup.count * at.setup.clock : 1
  const chips = (list: ItemAmount[]) =>
    list.map((a) => {
      const item = catalog.items.get(a.item)
      const amount = fmt(scaled?.get(a.item) ?? a.amount * perMin)
      const label = `${amount}${item && item.form !== 'solid' ? ' m³' : ''}/min ${item?.name ?? a.item}`
      return (
        <span key={a.item} className="pn-io-chip" title={label}>
          {item && <Icon of={item} size={size} title={label} />}
          <span>{amount}</span>
        </span>
      )
    })
  const group = at && machine && `${fmt(at.setup.count)} ${machine.name} at ${pct(at.setup.clock)}`

  return (
    <span className="pn-io">
      {recipe.inputs.length ? chips(recipe.inputs) : <span className="pn-dim">—</span>}
      <span className="pn-io-arrow">→</span>
      {chips(recipe.outputs)}
      {machine?.generation && (
        <span
          className="pn-io-chip pn-io-power"
          title={at ? `${mw(machine.generation.powerMw * machines)} from ${group}` : `${fmt(machine.generation.powerMw)} MW per ${machine.name} at 100%`}
        >
          ⚡{at ? mw(machine.generation.powerMw * machines) : `${fmt(machine.generation.powerMw)} MW`}
        </span>
      )}
      {showMachine && machine && (
        <span className="pn-io-machine" title={at ? `${group}, ${mw(at.powerMw)}` : `per ${machine.name} at 100%`}>
          <Icon of={machine} size={size} />
          {at && (
            <span className="pn-io-count">
              ×{fmt(at.setup.count)}
              {at.powerMw > 0 && <span className="pn-dim"> · {mw(at.powerMw)}</span>}
            </span>
          )}
        </span>
      )}
    </span>
  )
}
