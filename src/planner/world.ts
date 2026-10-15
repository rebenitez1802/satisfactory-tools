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
// - Counts are per purity: 36 pure Nitrogen Gas satellites don't make room
//   for 15 normal ones. `fitSites` moves the optimizer's flexible groups onto
//   purities the map has.

import type { Catalog, ItemId, Machine, PurityId, WorldSite } from '../catalog'
import { extractorRate, maxClock } from './rates'
import type { SolveResult } from './solve'
import type { ExtractorNode, Plan, PlanNode } from './types'

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

/** What's over, per purity: "Nitrogen Gas: 15 normal well satellites, the map has 7". */
export function overText(u: WorldUse, catalog: Catalog): string {
  const kind = u.site === 'well' ? 'well satellites' : 'nodes'
  const parts = u.purities
    .filter((p) => p.used > p.available)
    .map((p) => `${p.used} ${(catalog.purities.get(p.purity)?.name ?? p.purity).toLowerCase()} ${kind}, the map has ${p.available}`)
  return `${catalog.items.get(u.resource)?.name ?? u.resource}: ${parts.join('; ')}`
}

/**
 * Flexible extractor groups moved onto sites the map has, for each resource
 * whose groups use more sites of some purity than exist. ⛔ limited groups
 * keep their sites; the flexible ones, biggest first, each take:
 *
 * 1. the best purity with room for the whole group at its clock, or else
 * 2. the best sites left, as a ⛔ limited group of mixed purities clocked to
 *    give just its rate (overclocked only when every site left is needed).
 *
 * A group that doesn't fit even so is left as it is, still over.
 */
export function fitSites(plan: Plan, catalog: Catalog, result: SolveResult): Plan {
  const sites = worldSites(plan, catalog)
  const over = worldUsage(plan, result, catalog).filter((u) => u.over)
  if (!over.length) return plan
  const best = [...catalog.purities.values()].sort((a, b) => b.multiplier - a.multiplier).map((p) => p.id)
  const changed = new Map<string, PlanNode>()
  for (const u of over) {
    const ofIt = plan.nodes.filter(
      (n): n is ExtractorNode => n.kind === 'extractor' && n.resource === u.resource && catalog.machines.get(n.machine)?.extraction?.site === u.site,
    )
    const free = new Map(best.map((p) => [p, sites.filter((s) => s.resource === u.resource && s.site === u.site && s.purity === p).reduce((n, s) => n + s.count, 0)]))
    for (const n of ofIt) if (n.limited) for (const s of n.sites) free.set(s.purity, Math.max(0, (free.get(s.purity) ?? 0) - s.count))
    const flexible = ofIt
      .filter((n) => !n.limited)
      .map((n) => ({ n, rate: result.nodes.get(n.id)?.activity ?? 0 }))
      .filter((g) => g.rate > EPS)
      .sort((a, b) => b.rate - a.rate)
    for (const { n, rate } of flexible) {
      const machine = catalog.machines.get(n.machine)!
      const perSite = (purity: PurityId) => extractorRate(machine, { sites: [{ purity, count: 1 }], clock: 1, sloops: n.sloops }, catalog.purities)
      const whole = best.find((p) => perSite(p) > 0 && Math.ceil(rate / (perSite(p) * n.clock) - EPS) <= free.get(p)!)
      if (whole) {
        free.set(whole, free.get(whole)! - Math.ceil(rate / (perSite(whole) * n.clock) - EPS))
        changed.set(n.id, { ...n, sites: [{ purity: whole, count: 1 }] })
        continue
      }
      // Best sites first, until they give the rate at 100%.
      const taken: ExtractorNode['sites'] = []
      let full = 0
      for (const p of best) {
        let count = 0
        while (count < free.get(p)! && full < rate - EPS) {
          count++
          full += perSite(p)
        }
        if (count) taken.push({ purity: p, count })
      }
      // A hair over the rate, so the ⛔ limit never scales the plan down;
      // up to the highest clock, for a plan that needs every site at it.
      const need = full > 0 ? rate / full : Infinity
      if (need > maxClock(machine) * (1 + 1e-6)) continue
      const clock = Math.min(need * (1 + 1e-7), maxClock(machine))
      for (const s of taken) free.set(s.purity, free.get(s.purity)! - s.count)
      changed.set(n.id, { ...n, limited: true, sites: taken, clock })
    }
  }
  return changed.size ? { ...plan, nodes: plan.nodes.map((n) => changed.get(n.id) ?? n) } : plan
}
