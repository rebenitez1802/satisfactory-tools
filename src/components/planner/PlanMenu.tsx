import { useRef } from 'react'
interface PlanMenuProps {
  name: string
  canUndo: boolean
  canRedo: boolean
  error?: string
  onRename: (name: string) => void
  onSample: () => void
  onDuplicate: () => void
  onExport: () => void
  onImport: (file: File) => void
  onUndo: () => void
  onRedo: () => void
}

/** Plan name, file actions and undo/redo. Switching, new and delete live in the tabs. */
export function PlanMenu(p: PlanMenuProps) {
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <div className="pn-menu">
      <div className="pn-menu-row">
        <input className="pn-menu-name" value={p.name} onChange={(e) => p.onRename(e.target.value)} aria-label="Plan name" />
        <button type="button" className="icon-btn" title="Undo (Ctrl/⌘+Z)" disabled={!p.canUndo} onClick={p.onUndo}>
          ↶
        </button>
        <button type="button" className="icon-btn" title="Redo (Ctrl/⌘+Shift+Z)" disabled={!p.canRedo} onClick={p.onRedo}>
          ↷
        </button>
      </div>
      <div className="pn-menu-actions">
        <button type="button" onClick={p.onDuplicate}>
          Duplicate
        </button>
        <button type="button" onClick={p.onSample}>
          Sample
        </button>
        <button type="button" onClick={p.onExport}>
          Export
        </button>
        <button type="button" onClick={() => fileInput.current?.click()}>
          Import
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) p.onImport(file)
            e.target.value = ''
          }}
        />
      </div>
      {p.error && <div className="warning error">{p.error}</div>}
    </div>
  )
}
