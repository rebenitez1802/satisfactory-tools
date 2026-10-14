import { useEffect } from 'react'
import type { Catalog, WorldSite } from '../../catalog'
import { defaultSites } from '../../planner'
import { Icon } from './Icon'
import { NumberField } from './NumberField'

/**
 * The resource sites a plan counts against, per resource, kind of site and
 * purity: the default map's, or the plan's own (1.2's World Randomization
 * moves nodes around). Editing any count gives the plan its own copy.
 */
export function WorldModal({
  catalog,
  sites,
  custom,
  onChange,
  onClose,
}: {
  catalog: Catalog
  sites: WorldSite[]
  /** The plan has its own counts. */
  custom: boolean
  /** New counts, or undefined to go back to the default map. */
  onChange: (sites: WorldSite[] | undefined) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const purities = [...catalog.purities.values()].sort((a, b) => a.order - b.order)
  // Every resource and kind of site the default map or the plan knows of.
  const rows = [...new Map([...defaultSites(catalog), ...sites].map((s) => [`${s.resource}\u0000${s.site}`, s])).values()]
    .map((s) => ({ resource: s.resource, site: s.site, item: catalog.items.get(s.resource) }))
    .sort((a, b) => (a.item?.name ?? '').localeCompare(b.item?.name ?? '') || a.site.localeCompare(b.site))
  const count = (resource: string, site: string, purity: string) =>
    sites.find((s) => s.resource === resource && s.site === site && s.purity === purity)?.count ?? 0
  const set = (resource: string, site: string, purity: string, n: number) => {
    const rest = sites.filter((s) => !(s.resource === resource && s.site === site && s.purity === purity))
    onChange([...rest, ...(n > 0 ? [{ resource, site, purity, count: n }] : [])])
  }
  const mapName = catalog.maps.values().next().value?.name ?? 'Default map'
  const grid = { gridTemplateColumns: `1fr repeat(${purities.length}, 72px)` }

  return (
    <div className="pn-modal-backdrop" onClick={onClose}>
      <div className="pn-modal pn-modal-narrow pn-world" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="World resource nodes">
        <div className="pn-modal-head">
          <div>
            <h3>World resource nodes</h3>
            <p className="pn-dim">
              {custom ? 'This plan uses its own counts.' : `${mapName} counts.`} The summary warns when the plan uses more than there are, and ✨ Optimize
              never plans for more. Water Extractors go on any water, so they aren't counted.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="pn-world-list">
          <div className="pn-world-row pn-world-head" style={grid}>
            <span />
            {purities.map((p) => (
              <span key={p.id}>{p.name}</span>
            ))}
          </div>
          {rows.map(({ resource, site, item }) => (
            <div key={`${resource}${site}`} className="pn-world-row" style={grid}>
              <span className="pn-opt-label">
                {item && <Icon of={item} size={20} />}
                {item?.name ?? resource}
                {site === 'well' && <span className="pn-kind">wells</span>}
              </span>
              {purities.map((p) => (
                <NumberField key={p.id} value={count(resource, site, p.id)} min={0} step={1} width={56} onChange={(n) => set(resource, site, p.id, Math.round(n))} />
              ))}
            </div>
          ))}
        </div>
        <div className="pn-modal-foot">
          <span className="pn-dim">Counts are saved with the plan.</span>
          <button type="button" className="pn-button pn-button-quiet pn-button-inline" disabled={!custom} onClick={() => onChange(undefined)}>
            Reset to {mapName.toLowerCase()}
          </button>
        </div>
      </div>
    </div>
  )
}
