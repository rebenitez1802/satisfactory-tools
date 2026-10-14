import type { Catalog, ItemAmount, Recipe } from '../../catalog'
import { fmt } from './format'
import { Icon } from './Icon'

/**
 * A recipe's ingredients → products as small icons with per-minute amounts
 * for one machine at 100%, so recipes can be compared at a glance.
 */
export function RecipeIO({ recipe, catalog, size = 18, showMachine = true }: { recipe: Recipe; catalog: Catalog; size?: number; showMachine?: boolean }) {
  const machine = catalog.machines.get(recipe.machines[0])
  const perMin = (60 / recipe.durationSec) * (machine?.speed ?? 1)
  const chips = (list: ItemAmount[]) =>
    list.map((a) => {
      const item = catalog.items.get(a.item)
      const amount = fmt(a.amount * perMin)
      const label = `${amount}${item && item.form !== 'solid' ? ' m³' : ''}/min ${item?.name ?? a.item}`
      return (
        <span key={a.item} className="pn-io-chip" title={label}>
          {item && <Icon of={item} size={size} title={label} />}
          <span>{amount}</span>
        </span>
      )
    })

  return (
    <span className="pn-io">
      {recipe.inputs.length ? chips(recipe.inputs) : <span className="pn-dim">—</span>}
      <span className="pn-io-arrow">→</span>
      {chips(recipe.outputs)}
      {showMachine && machine && (
        <span className="pn-io-machine" title={`per ${machine.name} at 100%`}>
          <Icon of={machine} size={size} />
        </span>
      )}
    </span>
  )
}
