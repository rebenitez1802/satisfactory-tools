// Approximate ratios: trade a little precision for a much smaller balancer.
//
// Exact ratios of planner rates (92.4 : 88.9 : 1077.2 : 697.5) reduce to tens
// of thousands of shares, so the balancer needs dozens of splitters and
// loopbacks. In the game exact rates rarely matter: an output feeding machines
// backs up once they're full, and its splitter passes the rest on to the
// other outputs. So shares may be rounded, each output staying within a
// percentage of what it asked for, and the ratio that takes the fewest
// buildings wins. An output that takes everything it gets (a Leftover going
// to a sink or storage) never backs up, so with one present no other output
// may get less than it asked: the leftover would keep the difference. The
// leftover itself may shrink as far as needed, since what the others don't
// take spills into it.

import { buildBalancer } from './builder'
import { gcdAll } from './ratios'

/** How far a rate may move, in parts/min: `lo` ≤ 0 ≤ `hi`. */
export interface Bound {
  lo: number
  hi: number
}

/** Shares a rate may take, out of N. Zero only when the bound lets the rate vanish. */
function range(rate: number, b: Bound, total: number, N: number): [number, number] {
  const lo = Math.max(0, Math.ceil(((rate + b.lo) / total) * N - 1e-9))
  const hi = Math.floor(((rate + b.hi) / total) * N + 1e-9)
  return [lo, hi]
}

/**
 * Integer ratios for `rates` that keep every rate within its bound, one per
 * share count N up to `maxN`, reduced and without repeats. Each is the
 * nearest rounding that fits, nudged to sum to N.
 */
export function approxCandidates(rates: number[], bounds: Bound[], maxN = 600): number[][] {
  const total = rates.reduce((s, r) => s + r, 0)
  const seen = new Set<string>()
  const out: number[][] = []
  for (let N = 1; N <= maxN; N++) {
    const ranges = rates.map((r, k) => range(r, bounds[k], total, N))
    if (ranges.some(([lo, hi]) => lo > hi)) continue
    if (ranges.reduce((s, [lo]) => s + lo, 0) > N || ranges.reduce((s, [, hi]) => s + hi, 0) < N) continue
    const ideal = rates.map((r) => (r / total) * N)
    const r = ideal.map((x, k) => Math.min(ranges[k][1], Math.max(ranges[k][0], Math.round(x))))
    let sum = r.reduce((s, x) => s + x, 0)
    while (sum !== N) {
      const up = sum < N
      let best = -1
      for (let k = 0; k < r.length; k++) {
        if (up ? r[k] >= ranges[k][1] : r[k] <= ranges[k][0]) continue
        const gap = up ? ideal[k] - r[k] : r[k] - ideal[k]
        if (best < 0 || gap > (up ? ideal[best] - r[best] : r[best] - ideal[best])) best = k
      }
      r[best] += up ? 1 : -1
      sum += up ? 1 : -1
    }
    const g = gcdAll(r.filter((x) => x > 0))
    const reduced = r.map((x) => x / g)
    const key = reduced.join(':')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(reduced)
  }
  return out
}

/** Buildings a ratio takes, loopbacks counted twice: they are what makes a balancer hard to build. */
export function complexity(ratios: number[]): { score: number; splitters: number; mergers: number; loopbacks: number } {
  const used = ratios.filter((r) => r > 0)
  const { graph, loopbacks } = buildBalancer(used)
  const splitters = graph.nodes.filter((n) => n.kind === 'splitter').length
  const mergers = graph.nodes.filter((n) => n.kind === 'merger').length
  return { score: splitters + mergers + 2 * loopbacks, splitters, mergers, loopbacks }
}

/**
 * The simplest ratio for `rates` within `bounds`, compared with `exact` (the
 * exact ratio, always allowed). Ties go to the smaller largest error.
 */
export function simplestRatio(rates: number[], bounds: Bound[], exact: number[], maxN = 600): number[] {
  const total = rates.reduce((s, r) => s + r, 0)
  const error = (ratios: number[]) => {
    const N = ratios.reduce((s, r) => s + r, 0)
    return Math.max(...ratios.map((x, k) => Math.abs((x / N) * total - rates[k]) / rates[k]))
  }
  let best = exact
  let bestScore = complexity(exact).score
  let bestError = error(exact)
  for (const c of approxCandidates(rates, bounds, maxN)) {
    const score = complexity(c).score
    const err = error(c)
    if (score < bestScore || (score === bestScore && err < bestError - 1e-12)) {
      best = c
      bestScore = score
      bestError = err
    }
  }
  return best
}

function round(n: number, dp = 4): number {
  const f = Math.pow(10, dp)
  return Math.round(n * f) / f
}

/**
 * "Plates · 1077.2/min". Rounded: what it gets and how far that is from what
 * was asked, kept short so neighbouring outputs don't overlap: "Plates · 1066.9 (−1%)".
 */
export function sinkLabel(label: string | undefined, rate: number, requested?: number): string {
  const pct = requested === undefined ? 0 : ((rate - requested) / requested) * 100
  let text = `${round(rate, requested === undefined ? 4 : 1)}${requested === undefined ? '/min' : ''}`
  if (Math.abs(pct) >= 0.05) text += ` (${pct >= 0 ? '+' : '−'}${round(Math.abs(pct), 1)}%)`
  return label ? `${label} · ${text}` : text
}

/** The note a rounded design carries: how close it is, and why that's fine. */
export function roundedNote(maxError: number, ratio: string | undefined, leftover: 'kept' | 'dropped' | 'none'): string {
  return (
    `${ratio ? `Rounded to ${ratio}: every` : 'Rounded: every'} output is within ${round(maxError * 100, 1)}% of what you asked. ` +
    'Outputs feeding machines back up when full and pass the rest on, so the machines still get what they need' +
    (leftover === 'kept' ? '; the Leftover only gets what is spare.' : '.') +
    (leftover === 'dropped' ? ' The Leftover is gone: what is spare backs up the input a little.' : '')
  )
}

/** Largest relative difference between `got` and `asked`. */
export function maxError(got: number[], asked: number[]): number {
  return Math.max(0, ...got.map((g, i) => Math.abs(g - asked[i]) / asked[i]))
}
