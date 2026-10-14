import type { TransportTier } from '../../catalog'

/** Rate for display: up to 2 decimals (1 above 100), trailing zeros trimmed. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '–'
  const dp = Math.abs(n) >= 100 ? 1 : 2
  return Number(n.toFixed(dp)).toString()
}

/** A belt or pipe tier's short name: "Mk.2" for "Conveyor Belt Mk.2". */
export function tierName(tier: TransportTier): string {
  return tier.name.replace(/^(Conveyor Belt|Pipeline)\s+/i, '')
}

export function pct(fraction: number): string {
  return `${Number((fraction * 100).toFixed(1))}%`
}

/** Short MW figure: 1 decimal under 100 MW, whole numbers above (with thousands separators). */
export function mw(n: number): string {
  return `${Math.abs(n) >= 100 ? Math.round(n).toLocaleString('en-US') : Number(n.toFixed(1))} MW`
}
