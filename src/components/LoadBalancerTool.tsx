import { useMemo, useRef, useState } from 'react'
import { solve } from '../solver'
import type { OutputSpec, SolveResult } from '../solver'
import { GraphView } from './GraphView'

interface OutputRow {
  id: number
  label: string
  rate: string
}

const BELT_TIERS: { label: string; value: number }[] = [
  { label: 'No belt limit', value: 0 },
  { label: 'Mk.1 — 60/min', value: 60 },
  { label: 'Mk.2 — 120/min', value: 120 },
  { label: 'Mk.3 — 270/min', value: 270 },
  { label: 'Mk.4 — 480/min', value: 480 },
  { label: 'Mk.5 — 780/min', value: 780 },
  { label: 'Mk.6 — 1200/min', value: 1200 },
]

function parse(n: string): number {
  const v = Number(n)
  return Number.isFinite(v) ? v : NaN
}

export function LoadBalancerTool() {
  const nextId = useRef(3)
  const [input, setInput] = useState('120')
  const [beltMax, setBeltMax] = useState(0)
  const [outputs, setOutputs] = useState<OutputRow[]>([
    { id: 0, label: '', rate: '40' },
    { id: 1, label: '', rate: '40' },
    { id: 2, label: '', rate: '40' },
  ])

  const addRow = () =>
    setOutputs((rows) => [...rows, { id: nextId.current++, label: '', rate: '' }])

  const removeRow = (id: number) =>
    setOutputs((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== id) : rows))

  const updateRow = (id: number, patch: Partial<OutputRow>) =>
    setOutputs((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const inputRate = parse(input)
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

  const result: SolveResult = useMemo(() => {
    const specs: OutputSpec[] = outputs.map((r) => ({
      label: r.label.trim() || undefined,
      rate: parse(r.rate),
    }))
    return solve({ input: inputRate, outputs: specs, beltMax: beltMax || undefined })
  }, [outputs, inputRate, beltMax])

  const stats = result.ok
    ? countNodes(result)
    : null

  return (
    <div className="tool">
      <section className="panel form-panel">
        <h2>Load Balancer</h2>
        <p className="panel-hint">
          Enter an input belt rate and the outputs you want. The outputs must add up to
          the input. You'll get a splitter/merger graph that produces exactly those rates —
          including feedback loops for ratios that halves and thirds can't reach.
        </p>

        <label className="field">
          <span>Input rate (parts/min)</span>
          <input
            type="number"
            min="0"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>

        <div className="outputs-head">
          <span>Outputs</span>
          <div className="outputs-actions">
            <button type="button" onClick={splitEvenly}>
              Split evenly
            </button>
            <button type="button" onClick={addRow}>
              + Add output
            </button>
          </div>
        </div>

        <div className="outputs">
          {outputs.map((row, i) => (
            <div className="output-row" key={row.id}>
              <input
                className="output-label"
                type="text"
                placeholder={`Output ${i + 1}`}
                value={row.label}
                onChange={(e) => updateRow(row.id, { label: e.target.value })}
              />
              <input
                className="output-rate"
                type="number"
                min="0"
                placeholder="rate"
                value={row.rate}
                onChange={(e) => updateRow(row.id, { rate: e.target.value })}
              />
              <button
                type="button"
                className="icon-btn"
                title="Fill with remaining amount"
                onClick={() => fillRemaining(row.id)}
              >
                ⤢
              </button>
              <button
                type="button"
                className="icon-btn danger"
                title="Remove output"
                onClick={() => removeRow(row.id)}
                disabled={outputs.length <= 1}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className={`sum-row ${Math.abs(remaining) < 1e-6 ? 'ok' : 'warn'}`}>
          <span>Outputs total</span>
          <span>
            {fmt(outputSum)} / {fmt(inputRate)}
            {Number.isFinite(remaining) && Math.abs(remaining) >= 1e-6 && (
              <em> ({remaining > 0 ? '+' : ''}{fmt(remaining)} remaining)</em>
            )}
          </span>
        </div>

        <label className="field">
          <span>Belt tier (optional capacity check)</span>
          <select value={beltMax} onChange={(e) => setBeltMax(Number(e.target.value))}>
            {BELT_TIERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        {stats && (
          <div className="stats">
            <Stat label="Equal shares (N)" value={result.N!} />
            <Stat label="Leaf split (B)" value={result.leafCount!} />
            <Stat label="Loopbacks" value={result.loopbacks!} />
            <Stat label="Splitters" value={stats.splitters} />
            <Stat label="Mergers" value={stats.mergers} />
          </div>
        )}
      </section>

      <section className="panel graph-panel">
        {result.error ? (
          <div className="graph-message error">
            <strong>Can't build a graph yet</strong>
            <p>{result.error}</p>
          </div>
        ) : (
          <>
            {result.warnings.length > 0 && (
              <div className="warnings">
                {result.warnings.map((w, i) => (
                  <div key={i} className={`warning ${w.kind}`}>
                    {w.message}
                  </div>
                ))}
              </div>
            )}
            <GraphView result={result} />
          </>
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

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Number(n.toFixed(4)).toString()
}
