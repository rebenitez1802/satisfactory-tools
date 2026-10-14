import type { Catalog, Machine } from '../../catalog'
import { Icon } from './Icon'

/** The items a machine's shard and Somersloop slots take (Power Shard / Somersloop in vanilla). */
export function upgradeItems(machine: Machine | undefined, catalog: Catalog) {
  return {
    shard: machine?.overclock?.item ? catalog.items.get(machine.overclock.item) : undefined,
    sloop: machine?.amplifier?.item ? catalog.items.get(machine.amplifier.item) : undefined,
  }
}

/** Small "icon × count" chip, falling back to a symbol when the pack has no item for it. */
export function UpgradeChip({
  item,
  count,
  fallback,
  title,
  size = 14,
}: {
  item?: { name: string; icon?: string; color?: string }
  count: number
  fallback: string
  title: string
  size?: number
}) {
  return (
    <span className="pn-upgrade" title={title}>
      {item ? <Icon of={item} size={size} title={title} /> : fallback}
      {count}
    </span>
  )
}
