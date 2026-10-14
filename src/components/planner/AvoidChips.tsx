// "Don't use" (roadmap #22): one toggle per raw resource the plan shouldn't
// mine anew ("build this without oil"). It's a plan setting, so it shows in
// ✨ Optimize, where it matters most, and in the summary's settings, since
// ⚡ Build chain follows it too.

import type { Catalog, ItemId } from '../../catalog'
import { Icon } from './Icon'

/** Raw resources (anything an extractor mines), solids first, in catalog order. */
function rawResources(catalog: Catalog) {
  const items = [...catalog.extractorsFor.keys()].flatMap((id) => catalog.items.get(id) ?? [])
  return [...items.filter((i) => i.form === 'solid'), ...items.filter((i) => i.form !== 'solid')]
}

export function AvoidChips({ catalog, avoid, onChange }: { catalog: Catalog; avoid: readonly ItemId[]; onChange: (avoid: ItemId[]) => void }) {
  return (
    <div className="pn-avoid">
      {rawResources(catalog).map((item) => {
        const off = avoid.includes(item.id)
        return (
          <button
            key={item.id}
            type="button"
            className={`pn-avoid-chip${off ? ' off' : ''}`}
            aria-pressed={off}
            onClick={() => onChange(off ? avoid.filter((id) => id !== item.id) : [...avoid, item.id])}
          >
            <Icon of={item} size={22} title={`${item.name}: ${off ? "not used. Click to allow it." : 'click to not use it'}`} />
          </button>
        )
      })}
    </div>
  )
}
