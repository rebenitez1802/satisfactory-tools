import { useEffect, useMemo, useRef, useState } from 'react'
import type { Catalog } from '../../catalog'
import { paletteOptions, recipeItem, searchOptions, type PickOption } from '../../planner'
import { fmt } from './format'
import { Icon } from './Icon'
import { RecipeIO } from './RecipeIO'
import { usePlanner } from './plannerContext'

interface PickerProps {
  title: string
  /** Fixed choices to filter, or undefined for a free-text palette over the whole catalog. */
  options?: PickOption[]
  /** Top-left corner, in pixels relative to the canvas. */
  at: { x: number; y: number }
  /** Recipes to leave out of palette results (locked alternates). */
  hide?: (recipeId: string) => boolean
  /** A one-click action listed first, above the options (⚡ Build chain). Hidden while filtering. */
  action?: { title: string; detail: string; onRun: () => void }
  onPick: (option: PickOption) => void
  onClose: () => void
}

/** Searchable list of things to add. Arrow keys + Enter to pick, Esc to close. */
export function Picker({ title, options, hide, action, at, onPick, onClose }: PickerProps) {
  const { catalog } = usePlanner()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const shown = useMemo(
    () =>
      options
        ? searchOptions(options, catalog, query)
        : paletteOptions(catalog, query).filter((o) => o.kind !== 'recipe' || !hide?.(o.recipe.id)),
    [options, catalog, query, hide],
  )
  useEffect(() => setActive(0), [query])
  // The action takes row 0 when shown; options follow.
  const lead = action && !query ? action : undefined
  const rows = shown.length + (lead ? 1 : 0)
  const optionAt = (i: number) => shown[i - (lead ? 1 : 0)]

  // Close on a press anywhere outside. Capture phase: React Flow stops
  // pointer events on the canvas and nodes from bubbling.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [onClose])

  useEffect(() => {
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, rows - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && lead && active === 0) {
      lead.onRun()
    } else if (e.key === 'Enter' && optionAt(active)) {
      onPick(optionAt(active))
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="pn-picker nodrag nowheel" ref={ref} style={{ left: at.x, top: at.y }} onKeyDown={onKeyDown}>
      <div className="pn-picker-title">{title}</div>
      <input
        autoFocus
        className="pn-picker-search"
        placeholder={options ? 'Filter…' : 'Search items or recipes…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="pn-picker-list" ref={listRef}>
        {lead && (
          <button
            type="button"
            className={`pn-option pn-option-action${active === 0 ? ' active' : ''}`}
            onMouseEnter={() => setActive(0)}
            onClick={lead.onRun}
          >
            <span className="pn-option-text">
              <span className="pn-option-name">{lead.title}</span>
              <span className="pn-option-sub">{lead.detail}</span>
            </span>
          </button>
        )}
        {shown.map((o, j) => {
          const i = j + (lead ? 1 : 0)
          return (
            <button
              key={optionKey(o)}
              type="button"
              className={`pn-option${i === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(o)}
            >
              <OptionRow option={o} catalog={catalog} />
            </button>
          )
        })}
        {shown.length === 0 && (
          <div className="pn-picker-empty">{options || query ? 'Nothing matches.' : 'Type to search, e.g. "screw" or "iron ore".'}</div>
        )}
      </div>
    </div>
  )
}

function optionKey(o: PickOption): string {
  switch (o.kind) {
    case 'recipe':
      return o.recipe.id
    case 'extractor':
      return `x:${o.machine.id}:${o.resource.id}`
    case 'supply':
    case 'goal':
      return `${o.kind}:${o.item.id}`
  }
}

function OptionRow({ option: o, catalog }: { option: PickOption; catalog: Catalog }) {
  switch (o.kind) {
    case 'recipe': {
      const r = o.recipe
      const product = catalog.items.get(recipeItem(catalog, r) ?? '')
      return (
        <>
          {product && <Icon of={product} size={28} />}
          <span className="pn-option-text">
            <span className="pn-option-name">
              {r.name}
              {r.alternate && <span className="pn-alt">ALT</span>}
            </span>
            <RecipeIO recipe={r} catalog={catalog} size={16} />
          </span>
        </>
      )
    }
    case 'extractor': {
      const spec = o.machine.extraction
      return (
        <>
          <Icon of={o.resource} size={28} />
          <span className="pn-option-text">
            <span className="pn-option-name">
              {o.resource.name} <span className="pn-kind">extract</span>
            </span>
            <span className="pn-option-sub">
              {o.machine.name}
              {spec && ` · ${fmt(spec.ratePerMin)}/min${spec.usesPurity ? ' per normal node' : ''}`}
            </span>
          </span>
          <Icon of={o.machine} size={22} />
        </>
      )
    }
    case 'supply':
      return (
        <>
          <Icon of={o.item} size={28} />
          <span className="pn-option-text">
            <span className="pn-option-name">
              {o.item.name} <span className="pn-kind">supply</span>
            </span>
            <span className="pn-option-sub">Brought in from outside this plan</span>
          </span>
        </>
      )
    case 'goal':
      return (
        <>
          <Icon of={o.item} size={28} />
          <span className="pn-option-text">
            <span className="pn-option-name">
              {o.item.name} <span className="pn-kind">goal</span>
            </span>
            <span className="pn-option-sub">What this plan should deliver</span>
          </span>
        </>
      )
  }
}
