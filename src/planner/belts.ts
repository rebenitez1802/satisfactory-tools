// How to carry a flow on belts or pipes you can build.
//
// An edge joins two machine groups, so it never has to be one belt: twenty
// Smelters can put their ingots on two belts of ten machines each. In the game
// each machine has its own output, so the unit that goes onto a belt is a whole
// machine (plus at most one partly clocked one). These helpers put machines
// onto the fewest belts of a tier, as evenly as whole machines allow, so each
// belt keeps headroom. The belt inspector ("How to build") and the load
// balancer's inputs both use them.

import type { ItemId, MachineId, TransportTier } from '../catalog'
import type { NodeResult } from './solve'

const EPS = 1e-9

/** One belt's load: its rate and the machines (possibly fractional) on it. */
export interface BeltLoad {
  perMin: number
  machines: number
}

/** A machine group at one end of an edge: how many, and what each makes or takes. */
export interface GroupEnd {
  machine: MachineId
  count: number
  each: number
}

/** `count` machines at `each`/min, one input per machine: 7.5 × 100 → 7 × 100 + 50. */
export function machineRates(count: number, each: number): number[] {
  const whole = Math.floor(count + EPS)
  const part = count - whole
  const rates = new Array<number>(whole).fill(each)
  if (part * each > EPS * Math.max(1, each)) rates.push(part * each)
  return rates
}

/**
 * Put `count` machines making `each`/min onto the fewest belts of `cap`/min,
 * as evenly as whole machines allow. A fractional count is one partly clocked
 * machine, which goes on the lightest belt. Undefined when one machine alone
 * is faster than the belt: no number of belts carries it.
 */
export function machinesOnBelts(count: number, each: number, cap: number): BeltLoad[] | undefined {
  if (!(count > EPS) || !(each > 0) || !(cap > 0)) return undefined
  if (each > cap * (1 + 1e-9)) return undefined
  const whole = Math.floor(count + 1e-6)
  const part = count - whole > 1e-6 ? count - whole : 0
  // At worst one machine per belt, which fits since one machine does.
  for (let k = Math.max(1, Math.ceil((count * each) / cap - 1e-9)); k <= whole + 1; k++) {
    const machines = Array.from({ length: k }, (_, i) => Math.floor(whole / k) + (i < whole % k ? 1 : 0))
    // The partial machine rides on the lightest belt, the last one.
    machines[k - 1] += part
    if (machines.every((m) => m * each <= cap * (1 + 1e-9) && m > 0)) {
      return machines.map((m) => ({ perMin: m * each, machines: m }))
    }
  }
  return undefined
}

/**
 * The machine group at one end of an edge, from its node's result: the node's
 * own machine and count (`buildings[0]`), and what one machine makes (`out`)
 * or takes (`in`) of `item`. Undefined for nodes without machines.
 */
export function groupEnd(res: NodeResult | undefined, item: ItemId, side: 'out' | 'in'): GroupEnd | undefined {
  const built = res?.buildings?.[0]
  if (!res || !built || built.count <= EPS) return undefined
  const rate = side === 'out' ? res.outputs.find((p) => p.item === item)?.produced : res.inputs.find((p) => p.item === item)?.needed
  if (!rate || rate <= EPS) return undefined
  return { machine: built.machine, count: built.count, each: rate / built.count }
}

/**
 * How many belts (or pipes) of each tier of `tiers` carry `perMin`, fastest
 * tier first. Tiers slower than one machine (`each`) are left out.
 */
export function transportOptions(perMin: number, tiers: TransportTier[], each = 0): { tier: TransportTier; count: number }[] {
  return tiers
    .filter((t) => t.ratePerMin > 0 && t.ratePerMin >= each - EPS)
    .sort((a, b) => b.ratePerMin - a.ratePerMin)
    .map((tier) => ({ tier, count: Math.max(1, Math.ceil(perMin / tier.ratePerMin - 1e-9)) }))
}

/** One belt of a plan: its rate and the producing and consuming machines on it. */
export interface PlannedBelt {
  perMin: number
  from?: number
  to?: number
}

/**
 * Carry an edge of `perMin` on belts of `cap`/min. Machines go onto belts
 * whole, from whichever end needs fewer belts (the producers on a tie); the
 * other end gets what each belt brings, which may be part of a machine. An
 * edge from a split, or into a merge, only carries part of its group: it holds
 * `perMin / each` machines' worth. Undefined when a machine at either end is
 * faster than one belt.
 */
export function beltPlan(perMin: number, cap: number, from?: Pick<GroupEnd, 'each'>, to?: Pick<GroupEnd, 'each'>): PlannedBelt[] | undefined {
  if (!(perMin > EPS) || !(cap > 0)) return undefined
  const bySide = (end?: Pick<GroupEnd, 'each'>) => (end ? machinesOnBelts(perMin / end.each, end.each, cap) : undefined)
  if ((from && from.each > cap * (1 + 1e-9)) || (to && to.each > cap * (1 + 1e-9))) return undefined
  const a = bySide(from)
  const b = bySide(to)
  let loads = a && b ? (b.length < a.length ? b : a) : (a ?? b)
  if (!loads) {
    const k = Math.max(1, Math.ceil(perMin / cap - 1e-9))
    loads = Array.from({ length: k }, () => ({ perMin: perMin / k, machines: 0 }))
  }
  return loads.map((l) => ({
    perMin: l.perMin,
    ...(from ? { from: l.perMin / from.each } : {}),
    ...(to ? { to: l.perMin / to.each } : {}),
  }))
}
