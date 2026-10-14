// Merge data packs into a Catalog.
//
// Packs are applied in dependency order (each pack after everything it
// `dependsOn`); within a pack: add, then patch, then remove. Problems never
// throw: they are collected as diagnostics and the offending pack or entity is
// skipped, so one broken mod pack can't take the whole planner down. After
// merging, references are checked and recipes that point at missing items or
// machines are dropped. That keeps the catalog self-consistent even when a mod
// removes something other content still uses.

import { ENTITY_KINDS } from './pack'
import type { DataPack, EntityKind, PackEntities } from './pack'
import type { Catalog, Id, ItemId, Machine, MachineId, PackInfo, Recipe, RecipeId, Schematic, SchematicId, WorldMap } from './types'

export interface Diagnostic {
  severity: 'error' | 'warning'
  /** Pack the problem came from, when known. */
  pack?: string
  /** Entity the problem is about, when known. */
  id?: Id
  message: string
}

export interface BuildOptions {
  /** Pack ids to load. Defaults to every pack passed in. Dependencies must be listed too. */
  enabled?: string[]
  /**
   * Folder a pack's relative asset paths resolve against. Defaults to
   * `packs/<id>/`, matching how bundled packs are laid out under `public/`.
   */
  assetBase?: (packId: string) => string
}

export interface BuildResult {
  catalog: Catalog
  diagnostics: Diagnostic[]
}

export const SEP = ':'

/** Qualify a pack-local reference with `packId` unless it already names a pack. */
export function qualify(ref: string, packId: string): Id {
  return ref.includes(SEP) ? ref : `${packId}${SEP}${ref}`
}

export function packOf(id: Id): string {
  const i = id.indexOf(SEP)
  return i < 0 ? '' : id.slice(0, i)
}

export function localId(id: Id): string {
  const i = id.indexOf(SEP)
  return i < 0 ? id : id.slice(i + 1)
}

function isAbsoluteUrl(path: string): boolean {
  return /^(data:|https?:|\/)/.test(path)
}

/** Rewrite every reference field of a (possibly partial) entity to qualified ids. */
function qualifyEntity<K extends EntityKind>(
  kind: K,
  entity: Partial<PackEntities[K]>,
  packId: string,
  assetBase: string,
): Partial<PackEntities[K]> {
  const out: Record<string, unknown> = { ...entity }
  if (typeof out.id === 'string') out.id = qualify(out.id, packId)
  if (typeof out.icon === 'string' && !isAbsoluteUrl(out.icon)) out.icon = assetBase + out.icon

  if (kind === 'recipes') {
    const r = entity as Partial<Recipe>
    if (r.machines) out.machines = r.machines.map((m) => qualify(m, packId))
    if (r.inputs) out.inputs = r.inputs.map((a) => ({ ...a, item: qualify(a.item, packId) }))
    if (r.outputs) out.outputs = r.outputs.map((a) => ({ ...a, item: qualify(a.item, packId) }))
  } else if (kind === 'machines') {
    const m = entity as Partial<Machine>
    if (m.overclock?.item) out.overclock = { ...m.overclock, item: qualify(m.overclock.item, packId) }
    if (m.amplifier?.item) out.amplifier = { ...m.amplifier, item: qualify(m.amplifier.item, packId) }
    if (m.buildCost) out.buildCost = m.buildCost.map((a) => ({ ...a, item: qualify(a.item, packId) }))
    if (m.extraction) {
      out.extraction = {
        ...m.extraction,
        resources: m.extraction.resources.map((r) => qualify(r, packId)),
        ...(m.extraction.poweredBy ? { poweredBy: qualify(m.extraction.poweredBy, packId) } : {}),
      }
    }
  } else if (kind === 'maps') {
    const w = entity as Partial<WorldMap>
    if (w.sites) out.sites = w.sites.map((s) => ({ ...s, resource: qualify(s.resource, packId), purity: qualify(s.purity, packId) }))
  } else if (kind === 'schematics') {
    const sc = entity as Partial<Schematic>
    if (sc.recipes) out.recipes = sc.recipes.map((r) => qualify(r, packId))
    if (sc.requires) out.requires = sc.requires.map((r) => qualify(r, packId))
  }
  return out as Partial<PackEntities[K]>
}

/** Order enabled packs so each comes after its dependencies; report missing deps and cycles. */
function resolveOrder(
  packs: Map<string, DataPack>,
  enabled: string[],
  diagnostics: Diagnostic[],
): DataPack[] {
  const enabledSet = new Set(enabled)
  const order: DataPack[] = []
  const state = new Map<string, 'visiting' | 'done' | 'failed'>()

  const visit = (id: string): boolean => {
    const s = state.get(id)
    if (s === 'done') return true
    if (s === 'failed') return false
    if (s === 'visiting') {
      diagnostics.push({ severity: 'error', pack: id, message: `Dependency cycle through pack "${id}".` })
      return false
    }
    const pack = packs.get(id)
    if (!pack) {
      diagnostics.push({ severity: 'error', pack: id, message: `Pack "${id}" is not available.` })
      state.set(id, 'failed')
      return false
    }
    state.set(id, 'visiting')
    for (const dep of pack.manifest.dependsOn ?? []) {
      if (!enabledSet.has(dep) || !visit(dep)) {
        diagnostics.push({
          severity: 'error',
          pack: id,
          message: `Pack "${id}" needs "${dep}", which is not loaded; skipping it.`,
        })
        state.set(id, 'failed')
        return false
      }
    }
    state.set(id, 'done')
    order.push(pack)
    return true
  }

  for (const id of enabled) visit(id)
  return order
}

type Store = { [K in EntityKind]: Map<Id, PackEntities[K]> }

export function buildCatalog(packs: DataPack[], opts: BuildOptions = {}): BuildResult {
  const diagnostics: Diagnostic[] = []
  const assetBaseFor = opts.assetBase ?? ((id: string) => `packs/${id}/`)

  const byId = new Map<string, DataPack>()
  for (const p of packs) {
    if (byId.has(p.manifest.id)) {
      diagnostics.push({ severity: 'error', pack: p.manifest.id, message: `Duplicate pack id "${p.manifest.id}"; keeping the first.` })
      continue
    }
    if (p.manifest.id.includes(SEP)) {
      diagnostics.push({ severity: 'error', pack: p.manifest.id, message: `Pack id must not contain "${SEP}".` })
      continue
    }
    byId.set(p.manifest.id, p)
  }

  const order = resolveOrder(byId, opts.enabled ?? [...byId.keys()], diagnostics)

  const store: Store = {
    items: new Map(),
    machines: new Map(),
    recipes: new Map(),
    purities: new Map(),
    transportTiers: new Map(),
    maps: new Map(),
    schematics: new Map(),
  }

  for (const pack of order) {
    const packId = pack.manifest.id
    const assetBase = assetBaseFor(packId)

    for (const kind of ENTITY_KINDS) {
      const target = store[kind] as Map<Id, PackEntities[typeof kind]>

      for (const raw of pack.add?.[kind] ?? []) {
        if (!raw || typeof raw.id !== 'string' || !raw.id) {
          diagnostics.push({ severity: 'error', pack: packId, message: `An entry in add.${kind} has no id.` })
          continue
        }
        if (raw.id.includes(SEP) && packOf(raw.id) !== packId) {
          diagnostics.push({
            severity: 'error',
            pack: packId,
            id: raw.id,
            message: `add.${kind} may only create ids in its own pack; use patch to change "${raw.id}".`,
          })
          continue
        }
        const entity = qualifyEntity(kind, raw, packId, assetBase) as PackEntities[typeof kind]
        if (target.has(entity.id)) {
          diagnostics.push({ severity: 'error', pack: packId, id: entity.id, message: `Duplicate ${kind} id "${entity.id}".` })
          continue
        }
        target.set(entity.id, entity)
      }

      for (const raw of pack.patch?.[kind] ?? []) {
        const patch = qualifyEntity(kind, raw, packId, assetBase)
        const id = patch.id as Id
        const existing = target.get(id)
        if (!existing) {
          diagnostics.push({ severity: 'warning', pack: packId, id, message: `patch.${kind}: "${id}" does not exist.` })
          continue
        }
        target.set(id, { ...existing, ...patch, id } as PackEntities[typeof kind])
      }

      for (const raw of pack.remove?.[kind] ?? []) {
        const id = qualify(raw, packId)
        if (!target.delete(id)) {
          diagnostics.push({ severity: 'warning', pack: packId, id, message: `remove.${kind}: "${id}" does not exist.` })
        }
      }
    }
  }

  validateReferences(store, diagnostics)
  validateSchematics(store)

  const packInfos: PackInfo[] = order.map(({ manifest: m }) => ({ id: m.id, name: m.name, version: m.version }))
  return { catalog: indexCatalog(store, packInfos), diagnostics }
}

/** Drop or trim entities whose references point at content that isn't loaded. */
function validateReferences(store: Store, diagnostics: Diagnostic[]) {
  for (const [id, m] of store.machines) {
    for (const key of ['overclock', 'amplifier'] as const) {
      const spec = store.machines.get(id)![key]
      if (spec?.item && !store.items.has(spec.item)) {
        diagnostics.push({ severity: 'warning', pack: packOf(id), id, message: `Machine "${id}" uses unknown ${key} item "${spec.item}".` })
        store.machines.set(id, { ...store.machines.get(id)!, [key]: { ...spec, item: undefined } })
      }
    }
    if (m.buildCost?.some((a) => !store.items.has(a.item))) {
      // A cost missing some of its items would look cheaper than it is.
      diagnostics.push({ severity: 'warning', pack: packOf(id), id, message: `Machine "${id}" has a build cost with unknown items; its cost is unknown.` })
      store.machines.set(id, { ...store.machines.get(id)!, buildCost: undefined })
    }
    if (!m.extraction) continue
    const resources = m.extraction.resources.filter((r) => store.items.has(r))
    if (resources.length !== m.extraction.resources.length) {
      diagnostics.push({ severity: 'warning', pack: packOf(id), id, message: `Extractor "${id}" lists unknown resources; ignoring them.` })
    }
    let poweredBy = m.extraction.poweredBy
    if (poweredBy && !store.machines.has(poweredBy)) {
      diagnostics.push({ severity: 'warning', pack: packOf(id), id, message: `Extractor "${id}" is powered by unknown machine "${poweredBy}".` })
      poweredBy = undefined
    }
    store.machines.set(id, { ...store.machines.get(id)!, extraction: { ...m.extraction, resources, poweredBy } })
  }

  for (const [id, w] of store.maps) {
    const sites = (w.sites ?? []).filter((s) => store.items.has(s.resource) && store.purities.has(s.purity))
    if (sites.length !== (w.sites ?? []).length) {
      diagnostics.push({ severity: 'warning', pack: packOf(id), id, message: `Map "${id}" lists sites with unknown resources or purities; ignoring them.` })
    }
    store.maps.set(id, { ...w, sites })
  }

  for (const [id, r] of store.recipes) {
    const missingItems = [...r.inputs, ...r.outputs].map((a) => a.item).filter((i) => !store.items.has(i))
    const machines = r.machines.filter((m) => store.machines.has(m))
    // Generator recipes make power, so they may have no item outputs.
    const makesSomething = r.outputs.length > 0 || machines.some((m) => store.machines.get(m)!.generation)
    if (missingItems.length || machines.length === 0 || !makesSomething) {
      const why = missingItems.length
        ? `unknown items ${[...new Set(missingItems)].join(', ')}`
        : machines.length === 0
          ? 'no known machine can run it'
          : 'it has no outputs'
      diagnostics.push({ severity: 'error', pack: packOf(id), id, message: `Dropping recipe "${id}": ${why}.` })
      store.recipes.delete(id)
      continue
    }
    if (machines.length !== r.machines.length) {
      diagnostics.push({ severity: 'warning', pack: packOf(id), id, message: `Recipe "${id}" lists unknown machines; ignoring them.` })
      store.recipes.set(id, { ...r, machines })
    }
  }
}

/**
 * Schematics: forget recipes and requirements that aren't loaded. That's
 * normal (a mod removing a recipe), so it's silent: the recipe just isn't
 * unlocked by anything. Runs after recipes are checked.
 */
function validateSchematics(store: Store) {
  for (const [id, sc] of store.schematics) {
    const recipes = (sc.recipes ?? []).filter((r) => store.recipes.has(r))
    const requires = (sc.requires ?? []).filter((r) => store.schematics.has(r))
    store.schematics.set(id, { ...sc, recipes, ...(sc.requires ? { requires } : {}) })
  }
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) {
    if (!list.includes(value)) list.push(value)
  } else map.set(key, [value])
}

function indexCatalog(store: Store, packs: PackInfo[]): Catalog {
  const recipesProducing = new Map<ItemId, RecipeId[]>()
  const recipesConsuming = new Map<ItemId, RecipeId[]>()
  for (const r of store.recipes.values()) {
    for (const a of r.outputs) pushTo(recipesProducing, a.item, r.id)
    for (const a of r.inputs) pushTo(recipesConsuming, a.item, r.id)
  }
  const extractorsFor = new Map<ItemId, MachineId[]>()
  for (const m of store.machines.values()) {
    for (const res of m.extraction?.resources ?? []) pushTo(extractorsFor, res, m.id)
  }
  const schematicsFor = new Map<RecipeId, SchematicId[]>()
  for (const sc of store.schematics.values()) for (const r of sc.recipes) pushTo(schematicsFor, r, sc.id)
  return {
    packs,
    items: store.items,
    machines: store.machines,
    recipes: store.recipes,
    purities: store.purities,
    transportTiers: store.transportTiers,
    maps: store.maps,
    schematics: store.schematics,
    schematicsFor,
    recipesProducing,
    recipesConsuming,
    extractorsFor,
  }
}
