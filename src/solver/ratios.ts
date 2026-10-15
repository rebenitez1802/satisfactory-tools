// Turn a list of real-valued rates into reduced integer ratios.
//
// Satisfactory rates can be fractional (e.g. 12.5/min), so we first scale every
// value to an integer by the largest number of decimal places present, then
// divide the whole set by its greatest common divisor.

export function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) {
    ;[a, b] = [b, a % b]
  }
  return a
}

export function gcdAll(values: number[]): number {
  return values.reduce((g, v) => gcd(g, v), 0)
}

/** Count of significant decimal places in a number (capped for sanity). */
function decimalPlaces(n: number, max = 6): number {
  if (Number.isInteger(n)) return 0
  const s = n.toFixed(max)
  const trimmed = s.replace(/0+$/, '')
  const dot = trimmed.indexOf('.')
  return dot === -1 ? 0 : trimmed.length - dot - 1
}

export interface ReducedRatios {
  /** Integer ratio for each input value, in the same order. */
  ratios: number[]
  /** Sum of the ratios. */
  N: number
  /** Scale factor such that round(value * scale) === integer ratio * gcd. */
  scale: number
}

/**
 * Reduce a set of rates to coprime integer ratios.
 * Throws if any value is non-positive.
 */
export function reduceRatios(values: number[]): ReducedRatios {
  if (values.length === 0) throw new Error('No values to reduce')
  if (values.some((v) => !(v > 0))) {
    throw new Error('All rates must be positive')
  }

  const maxDp = Math.max(...values.map((v) => decimalPlaces(v)))
  const scale = Math.pow(10, maxDp)
  const scaled = values.map((v) => Math.round(v * scale))

  const g = gcdAll(scaled)
  const ratios = scaled.map((v) => v / g)
  const N = ratios.reduce((s, r) => s + r, 0)
  return { ratios, N, scale }
}

/**
 * Smallest integer ratios (summing to at most `maxN`) that match the rates'
 * proportions within `tol` (as a share of the total). Recovers exact ratios
 * from rates that don't have short decimals, like 26.666… : 13.333… → 2 : 1,
 * or from rounded input like 33.33 : 66.67 → 1 : 2. Returns undefined if none.
 */
export function simpleRatios(values: number[], maxN = 120, tol = 1e-4): ReducedRatios | undefined {
  if (values.length === 0 || values.some((v) => !(v > 0))) return undefined
  const total = values.reduce((s, v) => s + v, 0)
  const shares = values.map((v) => v / total)
  for (let N = values.length; N <= maxN; N++) {
    const ratios = shares.map((s) => Math.round(s * N))
    if (ratios.some((r) => r < 1)) continue
    if (ratios.reduce((s, r) => s + r, 0) !== N) continue
    if (ratios.every((r, i) => Math.abs(r / N - shares[i]) <= tol)) return { ratios, N, scale: N / total }
  }
  return undefined
}

/** Above this many shares, look for a simpler ratio the rates were meant to be. */
const SIMPLE_MAX_N = 120

export interface FittedRatios extends ReducedRatios {
  /** The rates the ratios stand for: snapped when `snapped`, else as given. */
  rates: number[]
  /** True when the rates were snapped to a simpler ratio. */
  snapped: boolean
}

/**
 * Integer ratios for a set of rates. Rates without short decimals (thirds
 * from recipe math, or rounded values like 33.33 / 66.67) reduce to enormous
 * share counts, so they are snapped to the simple ratio they clearly
 * represent, keeping their total. Throws if any rate is non-positive.
 */
export function fitRatios(rates: number[]): FittedRatios {
  const reduced = reduceRatios(rates)
  if (reduced.N > SIMPLE_MAX_N) {
    const simple = simpleRatios(rates, SIMPLE_MAX_N)
    if (simple) {
      const total = rates.reduce((s, v) => s + v, 0)
      return { ...simple, rates: simple.ratios.map((r) => (total * r) / simple.N), snapped: true }
    }
  }
  return { ...reduced, rates, snapped: false }
}
