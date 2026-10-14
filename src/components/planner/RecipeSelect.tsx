import { useEffect, useRef, useState } from 'react'
import type { Catalog, Recipe } from '../../catalog'
import { Icon } from './Icon'
import { RecipeIO } from './RecipeIO'

/** Dropdown of recipes with product icon, name and ingredient/product icons. */
export function RecipeSelect({
  value,
  options,
  catalog,
  onChange,
}: {
  value: string
  options: Recipe[]
  catalog: Catalog
  onChange: (recipeId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ordered = [...options.filter((r) => !r.alternate), ...options.filter((r) => r.alternate)]
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const current = catalog.recipes.get(value)

  useEffect(() => {
    if (!open) return
    setActive(Math.max(0, ordered.findIndex((r) => r.id === value)))
    // Capture phase: React Flow stops pointer events on the canvas from bubbling.
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  useEffect(() => {
    if (open) listRef.current?.querySelectorAll('.pn-rs-option')[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const pick = (id: string) => {
    if (id !== value) onChange(id)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, ordered.length - 1))
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
    else if (e.key === 'Enter') pick(ordered[active].id)
    else if (e.key === 'Escape') setOpen(false)
    else return
    e.preventDefault()
  }

  const row = (r: Recipe) => {
    const product = catalog.items.get(r.outputs[0].item)
    return (
      <>
        {product && <Icon of={product} size={30} />}
        <span className="pn-rs-text">
          <span className="pn-rs-name">
            {r.name}
            {r.alternate && <span className="pn-alt">ALT</span>}
          </span>
          <RecipeIO recipe={r} catalog={catalog} size={16} />
        </span>
      </>
    )
  }

  return (
    <div className="pn-rs" ref={ref} onKeyDown={onKeyDown}>
      <button type="button" className="pn-rs-button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        {current ? row(current) : <span className="pn-dim">Unknown recipe</span>}
        <span className="pn-rs-caret">▾</span>
      </button>
      {open && (
        <div className="pn-rs-list" ref={listRef} role="listbox">
          {ordered.map((r, i) => (
            <div key={r.id}>
              {(i === 0 || r.alternate !== ordered[i - 1].alternate) && (
                <div className="pn-rs-group">{r.alternate ? 'Alternates' : 'Standard'}</div>
              )}
              <button
                type="button"
                role="option"
                aria-selected={r.id === value}
                className={`pn-rs-option${i === active ? ' active' : ''}${r.id === value ? ' current' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r.id)}
              >
                {row(r)}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
