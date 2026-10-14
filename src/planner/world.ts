// World node limits (roadmap #11): how many resource nodes and well
// satellites the map has, how many the plan uses, and how much of each
// resource they can give at most.
//
// - The counts are data: each pack can bring maps (`Catalog.maps`), and
//   extractors say which kind of site they go on (`ExtractionSpec.site`).
//   Miners and oil extractors use resource nodes, well extractors use well
//   satellites; Water Extractors go on any water and are never limited.
// - A plan uses the first map's counts, or its own (`PlanSettings.world`),
//   since 1.2's World Randomization moves nodes around.
// - Most a resource can give: every site of a kind, with the fastest
//   extractor that fits it at its highest clock, capped by the fastest belt
//   or pipe. Iron: 39 impure × 300 + 42 normal × 600 + 46 pure × 1200 = 92100
//   a minute, the wiki's figure. The optimizer caps new extraction with it
//   and weighs resources by it.

import type { Catalog, ItemId, Machine, PurityId, WorldSite } from '../catalog'
import { maxClock } from './rates'
import type { SolveResult } from './solve'
import type { Plan } from './types'

const EPS = 1e-6

/** The first map's sites, or none if no pack brings a map. */
export function defaultSites(catalog: Catalog): WorldSite[] {
  return catalog.maps.values().next().value?.sites ?? []
}

/** The sites a plan counts against: its own counts, or the default map's. */
export function worldSites(plan: Plan, catalog: Catalog): WorldSite[] {
  return plan.settings.world ?? defaultSites(catalog)
}

/** Extractors that go on `site` and can extract `resource`. */
function extractorsOn(catalog: Catalog, resource: ItemId, site: string): Machine[] {
  return (catalog.extractorsFor.get(resource) ?? []).map((id) => catalog.machines.get(id)!).filter((m) => m.extraction?.site === site)
}

/** Most one site can give: the fastest extractor for it at its highest clock, capped by the fastest belt or pipe. */
export function siteRate(catalog: Catalog, resource: ItemId, site: string, purity: PurityId): number {
  const form = catalog.items.get(resource)?.form
  const kind = form === 'solid' ? 'belt' : 'pipe'
  const carry = Math.max(0, ...[...catalog.transportTiers.values()].filter((t) => t.kind === kind).map((t) => t.ratePerMin))
  const mult = catalog.purities.get(purity)?.multiplier ?? 1
  const best = Math.max(
    0,
    ...extractorsOn(catalog, resource, site).map((m) => m.extraction!.ratePerMin * (m.extraction!.usesPurity ? mult : 1) * maxClock(m)),
  )
  return carry > 0 ? Math.min(best, carry) : best
}

/**
 * Most of `resource` the sites can give a minute, on one kind of site or on
 * all of them. Undefined when an extractor that isn't tied to sites (a Water
 * Extractor) can make it: there's no limit.
 */
export function worldCapacity(catalog: Catalog, sites: WorldSite[], resource: ItemId, site?: string): number | undefined {
  const free = (catalog.extractorsFor.get(resource) ?? []).some((id) => !catalog.machines.get(id)?.extraction?.site)
  if (free && site === undefined) return undefined
  return sites
    .filter((s) => s.resource === resource && (site === undefined || s.site === site))
    .reduce((sum, s) => sum + s.count * siteRate(catalog, resource, s.site, s.purity), 0)
}

export interface WorldUse {
  resource: ItemId
  site: string
  /** Per purity the plan uses, in purity order. */
  purities: { purity: PurityId; used: number; available: number }[]
  used: number
  available: number
  /** Some purity is used more than the map has. */
  over: boolean
}

/**
 * Sites the plan's extractors occupy, by resource and kind of site. A
 * limited group takes the sites it lists; a flexible one as many as it needs
 * extractors, counted whole, on its purity.
 */
export function worldUsage(plan: Plan, result: SolveResult, catalog: Catalog): WorldUse[] {
  const sites = worldSites(plan, catalog)
  const used = new Map<string, Map<PurityId, number>>()
  const keyOf = (resource: ItemId, site: string) => `${resource}\u0000${site}`
  const add = (resource: ItemId, site: string, purity: PurityId, n: number) => {
    if (n <= EPS) return
    const k = keyOf(resource, site)
    if (!used.has(k)) used.set(k, new Map())
    used.get(k)!.set(purity, (used.get(k)!.get(purity) ?? 0) + n)
  }
  for (const n of plan.nodes) {
    if (n.kind !== 'extractor') continue
    const site = catalog.machines.get(n.machine)?.extraction?.site
    if (!site) continue
    if (n.limited) {
      for (const s of n.sites) add(n.resource, site, s.purity, s.count)
      continue
    }
    const need = Math.ceil((result.nodes.get(n.id)?.setup?.count ?? 0) - EPS)
    const listed = n.sites.reduce((s, x) => s + x.count, 0)
    for (const s of n.sites) add(n.resource, site, s.purity, listed > 0 ? Math.ceil((need * s.count) / listed - EPS) : 0)
  }
  const order = (p: PurityId) => catalog.purities.get(p)?.order ?? 0
  return [...used].map(([k, byPurity]) => {
    const [resource, site] = k.split('\u0000')
    const available = (p: PurityId) =>
      sites.filter((s) => s.resource === resource && s.site === site && s.purity === p).reduce((sum, s) => sum + s.count, 0)
    const purities = [...byPurity]
      .map(([purity, n]) => ({ purity, used: n, available: available(purity) }))
      .sort((a, b) => order(a.purity) - order(b.purity))
    return {
      resource,
      site,
      purities,
      used: purities.reduce((s, p) => s + p.used, 0),
      available: sites.filter((s) => s.resource === resource && s.site === site).reduce((sum, s) => sum + s.count, 0),
      over: purities.some((p) => p.used > p.available),
    }
  })
}
