import type { Catalog } from '../../catalog'
import type { PlanNode } from '../../planner'

/** Short human name for a plan node, e.g. "Iron Plate" or "Iron Ore (Miner Mk.2)". */
export function nodeLabel(node: PlanNode, catalog: Catalog): string {
  if (node.label) return node.label
  switch (node.kind) {
    case 'recipe':
      return catalog.recipes.get(node.recipe)?.name ?? 'Recipe'
    case 'extractor': {
      const res = catalog.items.get(node.resource)?.name ?? 'Resource'
      const machine = catalog.machines.get(node.machine)?.name
      return machine ? `${res} (${machine})` : res
    }
    case 'supply':
      return `${catalog.items.get(node.item)?.name ?? 'Item'} supply`
    case 'goal':
      return `${catalog.items.get(node.item)?.name ?? 'Item'} goal`
  }
}
