import { useEffect, useState } from 'react'

interface Tab {
  id: string
  name: string
}

/** One tab per saved plan: click to switch, double-click to rename, × to close (deletes, with undo). */
export function PlanTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  onRename,
  editRequest,
}: {
  tabs: Tab[]
  activeId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  onRename: (id: string, name: string) => void
  /** Start renaming this tab (e.g. one just created); bump `n` to ask again. */
  editRequest?: { id: string; n: number }
}) {
  const [editing, setEditing] = useState<string | null>(null)
  useEffect(() => {
    if (editRequest) setEditing(editRequest.id)
  }, [editRequest])

  return (
    <div className="pn-tabs" role="tablist">
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.id === activeId}
          className={`pn-tab${t.id === activeId ? ' active' : ''}`}
          onClick={() => t.id !== activeId && onSelect(t.id)}
          onDoubleClick={() => setEditing(t.id)}
          onAuxClick={(e) => e.button === 1 && onClose(t.id)}
          title={`${t.name || 'Untitled plan'} — double-click to rename`}
        >
          {editing === t.id ? (
            <input
              className="pn-tab-input"
              autoFocus
              defaultValue={t.name}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                onRename(t.id, e.target.value.trim() || t.name)
                setEditing(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setEditing(null)
              }}
            />
          ) : (
            <span className="pn-tab-name">{t.name || 'Untitled plan'}</span>
          )}
          {editing !== t.id && (
            <button
              type="button"
              className="pn-tab-rename"
              title="Rename"
              onClick={(e) => {
                e.stopPropagation()
                setEditing(t.id)
              }}
            >
              ✎
            </button>
          )}
          <button
            type="button"
            className="pn-tab-close"
            title="Close and delete this plan (you can undo)"
            onClick={(e) => {
              e.stopPropagation()
              onClose(t.id)
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="pn-tab-new" title="New plan" onClick={onNew}>
        +
      </button>
    </div>
  )
}
