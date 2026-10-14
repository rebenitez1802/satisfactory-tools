import { useMemo, useRef, useState } from 'react'
import { solve } from '../solver'
import type { Direction, OutputSpec, SolveResult } from '../solver'
import { GraphView } from './GraphView'

interface OutputRow {
  id: number
  label: string
  rate: string
}

const BELT_TIERS: { label: string; value: number }[] = [
  { label: 'No limit', value: 0 },
  { label: 'Mk.1 · 60', value: 60 },
  { label: 'Mk.2 · 120', value: 120 },
  { label: 'Mk.3 · 270', value: 270 },
  { label: 'Mk.4 · 480', value: 480 },
  { label: 'Mk.5 · 780', value: 780 },
  { label: 'Mk.6 · 1200', value: 1200 },
]

function parse(n: string): number {
  const v = Number(n)
  return Number.isFinite(v) ? v : NaN
}

/**
 * Rates handed over in the URL, e.g. from the production planner:
 * `#/balancer?in=120&out=90|Iron Plate&out=30|Iron Rod`.
 */
function readPrefill(): { input: string; outputs: OutputRow[] } | null {
  const query = window.location.hash.split('?')[1]
  if (!query) return null
  const params = new URLSearchParams(query)
  const input = params.get('in')
  const outs = params.getAll('out')
  if (!input || outs.length === 0) return null
  return {
    input,
    outputs: outs.map((o, i) => {
      const [rate, ...label] = o.split('|')
      return { id: i, rate, label: label.join('|') }
    }),
  }
}

export function LoadBalancerTool() {
  const [prefill] = useState(readPrefill)
  const nextId = useRef(prefill ? prefill.outputs.length : 3)
  const [input, setInput] = useState(prefill?.input ?? '')
  const [beltMax, setBeltMax] = useState(0)
  const [direction, setDirection] = useState<Direction>('BT')
  const [showLabels, setShowLabels] = useState(true)
  const [showBadges, setShowBadges] = useState(true)
  const [outputs, setOutputs] = useState<OutputRow[]>(
    prefill?.outputs ?? [
      { id: 0, label: '', rate: '' },
      { id: 1, label: '', rate: '' },
      { id: 2, label: '', rate: '' },
    ],
  )

  const addRow = () =>
    setOutputs((rows) => [...rows, { id: nextId.current++, label: '', rate: '' }])

  const removeRow = (id: number) =>
    setOutputs((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== id) : rows))

  const updateRow = (id: number, patch: Partial<OutputRow>) =>
    setOutputs((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const inputRate = input.trim() === '' ? NaN : parse(input)
  const outputSum = outputs.reduce((s, r) => s + (parse(r.rate) || 0), 0)
  const remaining = Number.isFinite(inputRate) ? inputRate - outputSum : NaN

  const fillRemaining = (id: number) => {
    const others = outputs
      .filter((r) => r.id !== id)
      .reduce((s, r) => s + (parse(r.rate) || 0), 0)
    const value = inputRate - others
    if (value > 0) updateRow(id, { rate: String(Number(value.toFixed(6))) })
  }

  const splitEvenly = () => {
    if (!Number.isFinite(inputRate) || outputs.length === 0) return
    const each = inputRate / outputs.length
    const rounded = Number(each.toFixed(6))
    setOutputs((rows) => rows.map((r) => ({ ...r, rate: String(rounded) })))
  }

  // Rows with an empty rate are ignored; nothing is built until the input and
  // at least one output have a value.
  const result: SolveResult | null = useMemo(() => {
    const filled = outputs.filter((r) => r.rate.trim() !== '')
    if (input.trim() === '' || filled.length === 0) return null
    const specs: OutputSpec[] = filled.map((r) => ({
      label: r.label.trim() || undefined,
      rate: parse(r.rate),
    }))
    return solve({ input: inputRate, outputs: specs, beltMax: beltMax || undefined })
  }, [outputs, input, inputRate, beltMax])

  const stats = result?.ok ? countNodes(result) : null
  // The leftover note is skipped: the red total row and red output already say it.
  const notes = result?.ok ? result.warnings.filter((w) => w.kind !== 'leftover') : []

  return (
    <div className="tool">
      <section className="panel form-panel">
        <h2>Load Balancer</h2>
        <p className="panel-hint">
          Enter an input rate and the outputs you want. Anything left over goes to a red
          Leftover output.
        </p>

        <label className="field">
          <span>Input rate (parts/min)</span>
          <input
            type="number"
            min="0"
            placeholder="e.g. 120"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>

        <div className="outputs-head">
          <span>Outputs</span>
          <div className="outputs-actions">
            <button type="button" tabIndex={-1} onClick={splitEvenly}>
              Split evenly
            </button>
            <button type="button" tabIndex={-1} onClick={addRow}>
              + Add output
            </button>
          </div>
        </div>

        <div className="outputs">
          {outputs.map((row, i) => (
            <div className="output-row" key={row.id}>
              <input
                className="output-rate"
                type="number"
                min="0"
                placeholder="rate"
                value={row.rate}
                onChange={(e) => updateRow(row.id, { rate: e.target.value })}
              />
              {/* Labels and buttons are skipped by Tab so it jumps rate → rate. */}
              <input
                className="output-label"
                type="text"
                tabIndex={-1}
                placeholder={`Output ${i + 1}`}
                value={row.label}
                onChange={(e) => updateRow(row.id, { label: e.target.value })}
              />
              <button
                type="button"
                className="icon-btn"
                tabIndex={-1}
                title="Fill with remaining amount"
                onClick={() => fillRemaining(row.id)}
              >
                ⤢
              </button>
              <button
                type="button"
                className="icon-btn danger"
                tabIndex={-1}
                title="Remove output"
                onClick={() => removeRow(row.id)}
                disabled={outputs.length <= 1}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className={`sum-row ${sumState(remaining)}`}>
          <span>Outputs total</span>
          <span>
            {fmt(outputSum)} / {fmt(inputRate)}
            {Number.isFinite(remaining) && remaining >= 1e-6 && (
              <em> ({fmt(remaining)} leftover)</em>
            )}
            {Number.isFinite(remaining) && remaining <= -1e-6 && (
              <em> ({fmt(-remaining)} over)</em>
            )}
          </span>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Belt cap</span>
            <select value={beltMax} onChange={(e) => setBeltMax(Number(e.target.value))}>
              {BELT_TIERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <div className="field">
            <span>Layout</span>
            <div className="seg seg-full">
              <button
                type="button"
                className={direction === 'BT' ? 'active' : ''}
                onClick={() => setDirection('BT')}
              >
                Vertical
              </button>
              <button
                type="button"
                className={direction === 'LR' ? 'active' : ''}
                onClick={() => setDirection('LR')}
              >
                Horizontal
              </button>
            </div>
          </div>
        </div>

        <div className="field">
          <span>Show rates</span>
          <div className="seg seg-full">
            <button
              type="button"
              className={showLabels ? 'active' : ''}
              aria-pressed={showLabels}
              onClick={() => setShowLabels((v) => !v)}
            >
              On belts
            </button>
            <button
              type="button"
              className={showBadges ? 'active' : ''}
              aria-pressed={showBadges}
              onClick={() => setShowBadges((v) => !v)}
            >
              At belt ends
            </button>
          </div>
        </div>

        {stats && result && (
          <>
            <div className="stats">
              <Stat label="Splitters" value={stats.splitters} />
              <Stat label="Mergers" value={stats.mergers} />
            </div>
            <p className="stats-detail">
              {result.N} equal shares · leaf split {result.leafCount} ·{' '}
              {result.loopbacks} loopback{result.loopbacks === 1 ? '' : 's'}
            </p>
          </>
        )}

        {notes.length > 0 && (
          <div className="warnings">
            {notes.map((w, i) => (
              <div key={i} className={`warning ${w.kind}`}>
                {w.message}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel graph-panel">
        {!result ? (
          <div className="graph-message">
            <strong>No graph yet</strong>
            <p>Enter an input rate and at least one output rate to build a balancer.</p>
          </div>
        ) : result.error ? (
          <div className="graph-message error">
            <strong>Can't build a graph yet</strong>
            <p>{result.error}</p>
          </div>
        ) : (
          <GraphView
            result={result}
            direction={direction}
            showLabels={showLabels}
            showBadges={showBadges}
          />
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

function countNodes(result: SolveResult) {
  const nodes = result.graph?.nodes ?? []
  return {
    splitters: nodes.filter((n) => n.kind === 'splitter').length,
    mergers: nodes.filter((n) => n.kind === 'merger').length,
  }
}

function sumState(remaining: number): string {
  if (!Number.isFinite(remaining)) return ''
  if (Math.abs(remaining) < 1e-6) return 'ok'
  return remaining > 0 ? 'leftover' : 'warn'
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Number(n.toFixed(4)).toString()
}
