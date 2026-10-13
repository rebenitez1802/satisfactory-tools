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
