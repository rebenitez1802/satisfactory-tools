// On-disk data-pack format.
//
// A pack is a folder: `pack.json` (this shape) plus any assets it references,
// such as `icons/`. The base game is the `base` pack. A mod pack lists `base`
// in `dependsOn` and then:
//   - `add`s new entities,
//   - `patch`es existing ones (shallow: each given top-level field replaces the
//     old value, so to change one nested field send the whole object), and
//   - `remove`s entities it replaces or disables.
// A pack that doesn't depend on `base` can replace it outright (e.g. a total
// conversion), and switching back to vanilla is just loading `base` alone.
//
// Ids inside a pack file may be written unqualified (`Desc_IronIngot_C`), which
// means "this pack's own entity", or qualified (`base:Desc_IronIngot_C`) to
// refer to another pack's entity. Entities added by a pack always belong to
// that pack.

import type { Item, Machine, Purity, Recipe, TransportTier } from './types'

export interface PackManifest {
  /** Namespace for the pack's ids. Lowercase letters, digits, '-' and '_'. */
  id: string
  name: string
  /** Version of the pack data itself. */
  version: string
  /** Game version the data was taken from, e.g. "1.0" or "1.2". */
  gameVersion?: string
  description?: string
  /** Packs whose entities this pack references or patches. Loaded first. */
  dependsOn?: string[]
  /** Attribution lines shown in the UI. */
  credits?: string[]
}

/** Entity collections a pack can contribute to. */
export interface PackEntities {
  items: Item
  machines: Machine
  recipes: Recipe
  purities: Purity
  transportTiers: TransportTier
}

export type EntityKind = keyof PackEntities

export const ENTITY_KINDS: readonly EntityKind[] = [
  'purities',
  'transportTiers',
  'items',
  'machines',
  'recipes',
]

export type EntityPatch<T> = Partial<T> & { id: string }

export interface DataPack {
  manifest: PackManifest
  add?: { [K in EntityKind]?: PackEntities[K][] }
  patch?: { [K in EntityKind]?: EntityPatch<PackEntities[K]>[] }
  remove?: { [K in EntityKind]?: string[] }
}
