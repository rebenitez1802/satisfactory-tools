import { useEffect, useMemo, useState } from 'react'
import type { Catalog } from '../../catalog'
import { Icon } from './Icon'

/** Pick which alternate recipes you've unlocked; locked ones are hidden from pickers. */
export function AlternatesModal({
  catalog,
  locked,
  onChange,
  onClose,
}: {
  catalog: Catalog
  locked: Set<string>
  onChange: (locked: Set<string>) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const alternates = useMemo(
    () =>
      [...catalog.recipes.values()]
        .filter((r) => r.alternate)
        .map((r) => ({ r, product: catalog.items.get(r.outputs[0].item) }))
        .sort((a, b) => (a.product?.name ?? '').localeCompare(b.product?.name ?? '') || a.r.name.localeCompare(b.r.name)),
    [catalog],
  )
  const q = query.trim().toLowerCase()
  const shown = alternates.filter(({ r, product }) => !q || r.name.toLowerCase().includes(q) || product?.name.toLowerCase().includes(q))
  const unlocked = alternates.length - alternates.filter(({ r }) => locked.has(r.id)).length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const setAll = (lock: boolean) => {
    const next = new Set(locked)
    for (const { r } of shown) {
      if (lock) next.add(r.id)
      else next.delete(r.id)
    }
    onChange(next)
  }

  return (
    <div className="pn-modal-backdrop" onClick={onClose}>
      <div className="pn-modal pn-modal-narrow" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Alternate recipes">
        <div className="pn-modal-head">
          <div>
            <h3>Alternate recipes</h3>
            <p className="pn-dim">
              {unlocked} of {alternates.length} unlocked. Locked ones are hidden when adding or switching recipes.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="pn-alt-toolbar">
          <input className="pn-picker-search" placeholder="Filter…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <button type="button" className="pn-button pn-button-quiet" onClick={() => setAll(false)}>
            Unlock {q ? 'shown' : 'all'}
          </button>
          <button type="button" className="pn-button pn-button-quiet" onClick={() => setAll(true)}>
            Lock {q ? 'shown' : 'all'}
          </button>
        </div>
        <div className="pn-alt-list">
          {shown.map(({ r, product }) => (
            <label key={r.id} className="pn-alt-row">
              <input
                type="checkbox"
                checked={!locked.has(r.id)}
                onChange={(e) => {
                  const next = new Set(locked)
                  if (e.target.checked) next.delete(r.id)
                  else next.add(r.id)
                  onChange(next)
                }}
              />
              {product && <Icon of={product} size={24} />}
              <span className="pn-alt-name">{r.name}</span>
              <span className="pn-dim">{product?.name}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
