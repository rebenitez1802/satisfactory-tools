// What can be added to a plan, and how new nodes start out. Kept free of UI
// so the picker's choices and defaults are easy to test.
//
// Defaults follow how a plan is usually built:
//   - Dragging back from an input ("what makes this?") or forward from an
//     output ("what uses this?") adds flexible nodes sized by the rest of the
//     plan, and goals reached that way take whatever arrives (Max).
//   - Starting from the palette: sources are ⛔ limits ("this is what I have")
//     and goals get a 🎯 number ("this is what I want").

import type { Catalog, Item, ItemId, Machine, Recipe } from '../catalog'
import type { PlanNode } from './types'

export type PickOption =
  | { kind: 'recipe'; recipe: Recipe }
  | { kind: 'extractor'; machine: Machine; resource: Item }
  | { kind: 'supply'; item: Item }
  | { kind: 'goal'; item: Item }

export type AddContext = 'producer' | 'consumer' | 'palette'

const byRecipe = (a: Recipe, b: Recipe) => Number(a.alternate) - Number(b.alternate) || a.name.localeCompare(b.name)

/** Everything that can supply `itemId`: recipes (standard first), extractors, then a supply node. */
export function producersOf(catalog: Catalog, itemId: ItemId): PickOption[] {
  const item = catalog.items.get(itemId)
  if (!item) return []
  const recipes = (catalog.recipesProducing.get(itemId) ?? []).map((id) => catalog.recipes.get(id)!).sort(byRecipe)
  const extractors = (catalog.extractorsFor.get(itemId) ?? []).map((id) => catalog.machines.get(id)!)
  return [
    ...extractors.map((machine): PickOption => ({ kind: 'extractor', machine, resource: item })),
    ...recipes.map((recipe): PickOption => ({ kind: 'recipe', recipe })),
    { kind: 'supply', item },
  ]
}

/** Everything that can take `itemId`: recipes using it, then a goal. */
export function consumersOf(catalog: Catalog, itemId: ItemId): PickOption[] {
  const item = catalog.items.get(itemId)
  if (!item) return []
  const recipes = (catalog.recipesConsuming.get(itemId) ?? []).map((id) => catalog.recipes.get(id)!).sort(byRecipe)
  return [{ kind: 'goal', item }, ...recipes.map((recipe): PickOption => ({ kind: 'recipe', recipe }))]
}

/** Text a picker option is searched by. */
export function optionText(o: PickOption, catalog: Catalog): string {
  switch (o.kind) {
    case 'recipe':
      return [o.recipe.name, ...o.recipe.outputs.map((a) => catalog.items.get(a.item)?.name ?? '')].join(' ')
    case 'extractor':
      return `${o.resource.name} ${o.machine.name}`
    case 'supply':
    case 'goal':
      return o.item.name
  }
}

/**
 * Score a match: 0 = the text starts with the query, 1 = every query word
 * starts a word in the text, 2 = every query word appears somewhere.
 * Dots are ignored, so "mk2" finds "Mk.2".
 */
function matchScore(text: string, query: string): number | undefined {
  const t = text.toLowerCase().replace(/\./g, '')
  const q = query.toLowerCase().replace(/\./g, '').trim()
  if (!q) return 0
  if (t.startsWith(q)) return 0
  const words = t.split(/[\s:(),-]+/)
  let score = 1
  for (const token of q.split(/\s+/)) {
    if (words.some((w) => w.startsWith(token))) continue
    if (!t.includes(token)) return undefined
    score = 2
  }
  return score
}

/** Filter options by a search query, best matches first, keeping the given order otherwise. */
export function searchOptions(options: PickOption[], catalog: Catalog, query: string): PickOption[] {
  return options
    .map((o, i) => ({ o, i, s: matchScore(optionText(o, catalog), query) }))
    .filter((x) => x.s !== undefined)
    .sort((a, b) => a.s! - b.s! || a.i - b.i)
    .map((x) => x.o)
}

/**
 * Palette entries for a free-text search: for every matching item its goal,
 * supply and extractors, plus every recipe whose name or product matches.
 */
export function paletteOptions(catalog: Catalog, query: string, limit = 60): PickOption[] {
  if (!query.trim()) return []
  const items = [...catalog.items.values()]
    .map((item) => ({ item, s: matchScore(item.name, query) }))
    .filter((x) => x.s !== undefined)
    .sort((a, b) => a.s! - b.s! || a.item.name.localeCompare(b.item.name))
    .map((x) => x.item)
  const out: PickOption[] = []
  for (const item of items.slice(0, 8)) {
    out.push({ kind: 'goal', item })
    for (const id of catalog.extractorsFor.get(item.id) ?? []) {
      out.push({ kind: 'extractor', machine: catalog.machines.get(id)!, resource: item })
    }
    out.push({ kind: 'supply', item })
  }
  const recipes = searchOptions(
    [...catalog.recipes.values()].sort(byRecipe).map((recipe): PickOption => ({ kind: 'recipe', recipe })),
    catalog,
    query,
  )
  return [...out, ...recipes].slice(0, limit)
}

/** Every resource with every extractor that can mine it, by resource then extractor. */
export function resourceOptions(catalog: Catalog): PickOption[] {
  const pairs: { machine: Machine; resource: Item }[] = []
  for (const [itemId, machineIds] of catalog.extractorsFor) {
    const resource = catalog.items.get(itemId)!
    for (const id of machineIds) pairs.push({ machine: catalog.machines.get(id)!, resource })
  }
  return pairs
    .sort((a, b) => a.resource.name.localeCompare(b.resource.name) || a.machine.name.localeCompare(b.machine.name))
    .map((p): PickOption => ({ kind: 'extractor', ...p }))
}

/** Every item as a goal, by name. */
export function goalOptions(catalog: Catalog): PickOption[] {
  return [...catalog.items.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item): PickOption => ({ kind: 'goal', item }))
}

/** The purity new extractors start on: the 1× tier if there is one, else the middle one. */
export function defaultPurity(catalog: Catalog): string {
  const tiers = [...catalog.purities.values()].sort((a, b) => a.order - b.order)
  return (tiers.find((p) => p.multiplier === 1) ?? tiers[Math.floor(tiers.length / 2)])?.id ?? ''
}

export function createNode(
  option: PickOption,
  id: string,
  position: { x: number; y: number },
  context: AddContext,
  catalog: Catalog,
): PlanNode {
  const fromPalette = context === 'palette'
  switch (option.kind) {
    case 'recipe':
      return {
        id,
        kind: 'recipe',
        position,
        recipe: option.recipe.id,
        machine: option.recipe.machines[0],
        limited: false,
        count: 1,
        clock: 1,
        sloops: 0,
      }
    case 'extractor':
      return {
        id,
        kind: 'extractor',
        position,
        machine: option.machine.id,
        resource: option.resource.id,
        limited: fromPalette,
        sites: [{ purity: defaultPurity(catalog), count: 1 }],
        clock: 1,
        sloops: 0,
      }
    case 'supply':
      return { id, kind: 'supply', position, item: option.item.id, limited: fromPalette, perMin: 60 }
    case 'goal':
      return { id, kind: 'goal', position, item: option.item.id, target: fromPalette ? 60 : 'max' }
  }
}

let counter = 0
/** Unique node id within a session (plans loaded later keep their own ids). */
export function newNodeId(prefix = 'n'): string {
  counter += 1
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`
}
