import { useMemo, useRef, useState } from 'react'
import { machineRates, machinesOnBelts } from '../planner/belts'
import { solve } from '../solver'
import type { Direction, OutputSpec, SolveResult } from '../solver'
import { GraphView } from './GraphView'

interface OutputRow {
  id: number
  label: string
  rate: string
}

/** Several input belts: `count` belts of `rate` (7.5 × 100 is 7 × 100 + 50). */
interface InputRow {
  id: number
  count: string
  rate: string
}

/** How far each output may be from its rate, for a simpler balancer (see solver/approx.ts). */
const PRECISIONS: { label: string; value: number }[] = [
  { label: 'Exact', value: 0 },
  { label: '±1%', value: 0.01 },
  { label: '±2%', value: 0.02 },
  { label: '±5%', value: 0.05 },
]

/** More input belts than this make the graph unreadable and slow. */
const MAX_INPUTS = 120

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
 * `#/balancer?in=120&out=90|Iron Plate&out=30|Iron Rod`. Several inputs
 * repeat `in` or give a count, `in=8x250&in=50`; `cap=1200` sets the belt cap
 * and `tol=2` the precision (±2%).
 */
function readPrefill(): { inputs: InputRow[]; outputs: OutputRow[]; cap: number; tolerance: number } | null {
  const query = window.location.hash.split('?')[1]
  if (!query) return null
  const params = new URLSearchParams(query)
  const ins = params.getAll('in')
  const outs = params.getAll('out')
  if (ins.length === 0 || outs.length === 0) return null
  return {
    inputs: ins.map((v, i) => {
      const m = /^\s*([\d.]+)\s*x\s*([\d.]+)\s*$/i.exec(v)
      return m ? { id: i, count: m[1], rate: m[2] } : { id: i, count: '1', rate: v }
    }),
    outputs: outs.map((o, i) => {
      const [rate, ...label] = o.split('|')
      return { id: i, rate, label: label.join('|') }
    }),
    cap: parse(params.get('cap') ?? '') || 0,
    tolerance: (parse(params.get('tol') ?? '') || 0) / 100,
  }
}

/** The input belts the rows stand for, or a reason they can't be used. */
function inputRates(rows: InputRow[]): number[] | string {
  const rates: number[] = []
  for (const r of rows) {
    if (r.rate.trim() === '' && r.count.trim() === '') continue
    const count = parse(r.count)
    const rate = parse(r.rate)
    if (!(count > 0) || !(rate > 0)) return 'Every input needs a positive count and rate.'
    rates.push(...machineRates(count, rate))
    if (rates.length > MAX_INPUTS) return `Use at most ${MAX_INPUTS} input belts.`
  }
  return rates
}

/**
 * Rows that are one machine group (one rate, plus at most one slower partial
 * belt) can be grouped onto the fewest belts of the cap: 20 × 100 on Mk.6 is
 * 2 × 1000. Undefined for anything else.
 */
function groupOntoBelts(rows: InputRow[], cap: number): InputRow[] | undefined {
  const rates = inputRates(rows)
  if (typeof rates === 'string' || rates.length < 2 || !(cap > 0)) return undefined
  const each = Math.max(...rates)
  const partial = rates.filter((r) => r < each - 1e-9)
  if (partial.length > 1) return undefined
  const count = rates.length - partial.length + (partial[0] ?? 0) / each
  const belts = machinesOnBelts(count, each, cap)
  if (!belts || belts.length >= rates.length) return undefined
  const rows2: InputRow[] = []
  for (const b of belts) {
    const rate = String(Number(b.perMin.toFixed(4)))
    const last = rows2[rows2.length - 1]
    if (last && last.rate === rate) last.count = String(parse(last.count) + 1)
    else rows2.push({ id: rows2.length, count: '1', rate })
  }
  return rows2
}

export function LoadBalancerTool() {
  const [prefill] = useState(readPrefill)
  const nextId = useRef(prefill ? prefill.outputs.length : 3)
  const nextInputId = useRef(prefill ? prefill.inputs.length : 1)
  const prefillSeveral = !!prefill && (prefill.inputs.length > 1 || parse(prefill.inputs[0].count) !== 1)
  const [several, setSeveral] = useState(prefillSeveral)
  const [input, setInput] = useState(prefill && !prefillSeveral ? prefill.inputs[0].rate : '')
  const [inputRows, setInputRows] = useState<InputRow[]>(
    prefill && prefillSeveral ? prefill.inputs : [{ id: 0, count: '1', rate: '' }],
  )
  const [beltMax, setBeltMax] = useState(prefill?.cap ?? 0)
  const [tolerance, setTolerance] = useState(
    PRECISIONS.find((p) => Math.abs(p.value - (prefill?.tolerance ?? 0)) < 1e-9)?.value ?? 0,
  )
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

  const updateInput = (id: number, patch: Partial<InputRow>) =>
    setInputRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  // Switching keeps the total: one belt becomes 1 × it, several become their sum.
  const switchInputs = (on: boolean) => {
    if (on === several) return
    if (on) {
      setInputRows([{ id: nextInputId.current++, count: '1', rate: input }])
    } else {
      const rates = inputRates(inputRows)
      if (typeof rates !== 'string' && rates.length > 0) {
        setInput(String(Number(rates.reduce((s, r) => s + r, 0).toFixed(6))))
      }
    }
    setSeveral(on)
  }

  const inputs = several ? inputRates(inputRows) : undefined
  const inputError = typeof inputs === 'string' ? inputs : undefined
  const inputList = Array.isArray(inputs) ? inputs : undefined
  const inputRate = several
    ? inputList && inputList.length > 0
      ? inputList.reduce((s, r) => s + r, 0)
      : NaN
    : input.trim() === ''
      ? NaN
      : parse(input)
  const grouped = several ? groupOntoBelts(inputRows, beltMax) : undefined
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
    if (filled.length === 0) return null
    if (inputError) return { ok: false, warnings: [], error: inputError }
    if (several ? !inputList?.length : input.trim() === '') return null
    const specs: OutputSpec[] = filled.map((r) => ({
      label: r.label.trim() || undefined,
      rate: parse(r.rate),
    }))
    return solve({ input: inputRate, inputs: inputList, outputs: specs, beltMax: beltMax || undefined, tolerance })
  }, [outputs, input, inputRate, inputList, inputError, several, beltMax, tolerance])

  const stats = result?.ok ? countNodes(result) : null
  // The leftover note is skipped: the red total row and red output already say it.
  const notes = result?.ok ? result.warnings.filter((w) => w.kind !== 'leftover') : []

  return (
    <div className="tool">
      <section className="panel form-panel">
        <h2>Load Balancer</h2>
        <p className="panel-hint">
          Enter an input rate, or several input belts, and the outputs you want. Anything left
          over goes to a red Leftover output.
        </p>

        <div className="outputs-head">
          <span>Input (parts/min)</span>
          <div className="seg">
            <button type="button" tabIndex={-1} className={several ? '' : 'active'} onClick={() => switchInputs(false)}>
              One belt
            </button>
            <button
              type="button"
              tabIndex={-1}
              className={several ? 'active' : ''}
              title="Several input belts, e.g. one per machine"
              onClick={() => switchInputs(true)}
            >
              Several
            </button>
          </div>
        </div>
        {!several ? (
          <div className="field">
            <input type="number" min="0" placeholder="e.g. 120" value={input} onChange={(e) => setInput(e.target.value)} />
          </div>
        ) : (
          <div className="field">
            <div className="outputs">
              {inputRows.map((row) => (
                <div className="input-row" key={row.id}>
                  <input
                    className="input-count"
                    type="number"
                    min="1"
                    placeholder="count"
                    title="How many belts (or machines) carry this rate"
                    value={row.count}
                    onChange={(e) => updateInput(row.id, { count: e.target.value })}
                  />
                  <span className="input-times">×</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="rate"
                    value={row.rate}
                    onChange={(e) => updateInput(row.id, { rate: e.target.value })}
                  />
                  <button
                    type="button"
                    className="icon-btn danger"
                    tabIndex={-1}
                    title="Remove input"
                    onClick={() => setInputRows((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== row.id) : rows))}
                    disabled={inputRows.length <= 1}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="outputs-actions">
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setInputRows((rows) => [...rows, { id: nextInputId.current++, count: '1', rate: '' }])}
              >
                + Add input
              </button>
              {grouped && (
                <button
                  type="button"
                  tabIndex={-1}
                  title="Put the machines on as few belts of the cap as fit, evenly"
                  onClick={() => setInputRows(grouped.map((r) => ({ ...r, id: nextInputId.current++ })))}
                >
                  Group onto {grouped.reduce((s, r) => s + parse(r.count), 0)} belts
                </button>
              )}
            </div>
          </div>
        )}

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
              {(BELT_TIERS.some((t) => t.value === beltMax) ? BELT_TIERS : [...BELT_TIERS, { label: `Cap · ${beltMax}`, value: beltMax }]).map((t) => (
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
          <span title="How far each output may be from its rate. Outputs feeding machines back up when full and pass the rest on, so a little off is fine.">
            Precision
          </span>
          <div className="seg seg-full">
            {PRECISIONS.map((p) => (
              <button
                key={p.value}
                type="button"
                className={tolerance === p.value ? 'active' : ''}
                onClick={() => setTolerance(p.value)}
              >
                {p.label}
              </button>
            ))}
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
              {result.inputs
                ? `${result.inputs.count} inputs · ${result.inputs.split} split`
                : `${result.N} equal shares · leaf split ${result.leafCount}`}{' '}
              · {result.loopbacks} loopback{result.loopbacks === 1 ? '' : 's'}
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
