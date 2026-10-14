import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { BUNDLED_PACKS, buildCatalog, fetchBundledPack } from '../../catalog'
import type { Catalog, Diagnostic } from '../../catalog'

// Loads the bundled data packs once and shares the merged catalog with the
// planner. Mod packs will plug in here (enabled list + user-uploaded packs).

export type CatalogState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; catalog: Catalog; diagnostics: Diagnostic[] }

const CatalogContext = createContext<CatalogState>({ status: 'loading' })

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CatalogState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    Promise.all(BUNDLED_PACKS.map((id) => fetchBundledPack(id, import.meta.env.BASE_URL)))
      .then((packs) => {
        if (cancelled) return
        const { catalog, diagnostics } = buildCatalog(packs)
        setState({ status: 'ready', catalog, diagnostics })
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return <CatalogContext.Provider value={state}>{children}</CatalogContext.Provider>
}

export function useCatalogState(): CatalogState {
  return useContext(CatalogContext)
}

/** The loaded catalog; only call below a component that checked `status === 'ready'`. */
export function useCatalog(): Catalog {
  const state = useContext(CatalogContext)
  if (state.status !== 'ready') throw new Error('Catalog is not loaded yet')
  return state.catalog
}
