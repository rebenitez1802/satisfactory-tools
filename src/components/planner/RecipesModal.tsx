// Recipes dialog (roadmap #23, #24): which recipes the planner may use.
// Game progress on top (HUB tier and research) hides what isn't unlocked
// yet; below, any recipe can be turned off by hand. The rules are in
// src/planner/progress.ts.

import { useEffect, useMemo, useState } from 'react'
import type { Catalog, Recipe, SchematicId } from '../../catalog'
import { hubTiers, needsLabel, recipeItem } from '../../planner'
import type { GameProgress, RecipeAccess } from '../../planner'
import { Icon } from './Icon'

type Filter = 'all' | 'standard' | 'alternate'

export function RecipesModal({
  catalog,
  locked,
  progress,
  access,
  onLocked,
  onProgress,
  onClose,
}: {
  catalog: Catalog
  locked: Set<string>
  progress: GameProgress | undefined
  access: (id: string) => RecipeAccess
  onLocked: (locked: Set<string>) => void
  onProgress: (progress: GameProgress | undefined) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const recipes = useMemo(
    () =>
      [...catalog.recipes.values()]
        .map((r) => ({ r, product: catalog.items.get(recipeItem(catalog, r) ?? '') }))
        .sort((a, b) => (a.product?.name ?? '').localeCompare(b.product?.name ?? '') || Number(a.r.alternate) - Number(b.r.alternate) || a.r.name.localeCompare(b.r.name)),
    [catalog],
  )
  const q = query.trim().toLowerCase()
  const shown = recipes.filter(
    ({ r, product }) =>
      (filter === 'all' || (filter === 'alternate') === r.alternate) &&
      (!q || r.name.toLowerCase().includes(q) || product?.name.toLowerCase().includes(q)),
  )
  const usable = recipes.filter(({ r }) => access(r.id).state === 'ok').length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const setAll = (lock: boolean) => {
    const next = new Set(locked)
    for (const { r } of shown) {
      if (access(r.id).state === 'progress') continue
      if (lock) next.add(r.id)
      else next.delete(r.id)
    }
    onLocked(next)
  }

  return (
    <div className="pn-modal-backdrop" onClick={onClose}>
      <div className="pn-modal pn-modal-narrow pn-recipes" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Recipes">
        <div className="pn-modal-head">
          <div>
            <h3>Recipes</h3>
            <p className="pn-dim">
              {usable} of {recipes.length} usable. The others aren't offered when adding or switching recipes, and ⚡ Build chain and ✨ Optimize
              don't use them. A plan keeps the ones it already has.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <Progress catalog={catalog} progress={progress} onChange={onProgress} />
        <div className="pn-alt-toolbar">
          <div className="seg">
            {(
              [
                ['all', 'All'],
                ['standard', 'Standard'],
                ['alternate', 'Alternate'],
              ] as [Filter, string][]
            ).map(([f, label]) => (
              <button key={f} type="button" className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                {label}
              </button>
            ))}
          </div>
          <input className="pn-picker-search" placeholder="Filter…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <button type="button" className="pn-button pn-button-quiet" onClick={() => setAll(false)} title="Turn on every recipe shown that's unlocked">
            All on
          </button>
          <button type="button" className="pn-button pn-button-quiet" onClick={() => setAll(true)} title="Turn off every recipe shown">
            All off
          </button>
        </div>
        <div className="pn-alt-list">
          {shown.map(({ r, product }) => (
            <RecipeRow key={r.id} recipe={r} product={product} access={access(r.id)} locked={locked} onLocked={onLocked} />
          ))}
        </div>
      </div>
    </div>
  )
}

function RecipeRow({
  recipe: r,
  product,
  access,
  locked,
  onLocked,
}: {
  recipe: Recipe
  product: { name: string; icon?: string; color?: string } | undefined
  access: RecipeAccess
  locked: Set<string>
  onLocked: (locked: Set<string>) => void
}) {
  const gated = access.state === 'progress'
  return (
    <label className={`pn-alt-row${gated ? ' pn-gated' : ''}`}>
      <input
        type="checkbox"
        checked={access.state === 'ok'}
        disabled={gated}
        onChange={(e) => {
          const next = new Set(locked)
          if (e.target.checked) next.delete(r.id)
          else next.add(r.id)
          onLocked(next)
        }}
      />
      {product && <Icon of={product} size={24} />}
      <span className="pn-alt-name">
        {r.name}
        {r.alternate && <span className="pn-alt">alt</span>}
      </span>
      <span className="pn-dim pn-alt-why">{gated ? needsLabel(access.needs) : product?.name}</span>
    </label>
  )
}

/** HUB tier and research. "Everything" (no progress) unlocks all of it. */
function Progress({ catalog, progress, onChange }: { catalog: Catalog; progress: GameProgress | undefined; onChange: (p: GameProgress | undefined) => void }) {
  const tiers = useMemo(() => hubTiers(catalog), [catalog])
  const milestones = (tier: number) =>
    [...catalog.schematics.values()]
      .filter((s) => s.kind === 'milestone' && s.tier === tier)
      .map((s) => s.name)
      .join(', ')
  // Research that unlocks recipes, or that alternates need, by tree.
  const trees = useMemo(() => {
    const needed = new Set([...catalog.schematics.values()].flatMap((s) => s.requires ?? []))
    const by = new Map<string, { id: SchematicId; name: string }[]>()
    for (const s of catalog.schematics.values()) {
      if (s.kind !== 'research' || (!s.recipes.length && !needed.has(s.id))) continue
      const g = s.group ?? 'Research'
      by.set(g, [...(by.get(g) ?? []), { id: s.id, name: s.name }])
    }
    return [...by].sort(([a], [b]) => a.localeCompare(b))
  }, [catalog])
  const done = new Set(progress?.research ?? [])
  const toggle = (ids: SchematicId[], on: boolean) => {
    const next = new Set(done)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    onChange({ tier: progress?.tier ?? 0, research: [...next] })
  }
  const researchCount = trees.reduce((n, [, list]) => n + list.length, 0)

  return (
    <div className="pn-unlocks">
      <label className="pn-unlocks-tier">
        <span>Game progress</span>
        <select
          value={progress ? String(progress.tier) : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : { tier: Number(e.target.value), research: progress?.research ?? [] })}
        >
          <option value="">Everything unlocked</option>
          {tiers.map((t) => (
            <option key={t} value={t}>
              {t === 0 ? 'Tier 0 (HUB upgrades)' : `Up to Tier ${t}`}
            </option>
          ))}
        </select>
      </label>
      {progress && (
        <>
          <p className="pn-dim pn-unlocks-hint">
            {progress.tier > 0 ? `Tier ${progress.tier}: ${milestones(progress.tier)}.` : 'Only the HUB upgrades.'} Alternates count once the
            milestones and research they need are done; turn off the ones you haven't found below.
          </p>
          <details className="pn-unlocks-research">
            <summary>
              Research (MAM) · {[...done].filter((id) => catalog.schematics.has(id)).length} of {researchCount} done
            </summary>
            {trees.map(([tree, list]) => {
              const all = list.every((s) => done.has(s.id))
              return (
                <div key={tree} className="pn-unlocks-tree">
                  <label className="pn-unlocks-tree-name">
                    <input type="checkbox" checked={all} onChange={() => toggle(list.map((s) => s.id), !all)} />
                    {tree}
                  </label>
                  <div className="pn-unlocks-nodes">
                    {list.map((s) => (
                      <label key={s.id}>
                        <input type="checkbox" checked={done.has(s.id)} onChange={(e) => toggle([s.id], e.target.checked)} />
                        {s.name}
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </details>
        </>
      )}
    </div>
  )
}
