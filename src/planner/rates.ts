// Rate and power math for plan nodes, matching vanilla game rules:
//
//   items/min       = amount × 60 / durationSec × machine.speed × clock × count
//   Somersloops     multiply outputs only: × (1 + sloops × boostPerSlot)
//   power per machine = basePower × clock ^ powerExponent
//                                 × (1 + sloops / slots) ^ amplifier.powerExponent
//
// Example: a Constructor (4 MW) at 250% draws 4 × 2.5^1.321929 ≈ 13.4 MW. With
// its one Somersloop it draws 4× that and doubles output, with the same inputs.
// Variable-power machines use the recipe's average of min and max power.
// Generators are linear instead: N machines' worth at 100% make N × their MW,
// however the clock is set.
// A fractional count like 2.4 is costed as it would be built: 2 machines at
// the node's clock plus 1 machine at 40% of it. Power falls faster than the
// clock, so this is cheaper than 2.4 × full power.

import type { ItemId, Machine, Purity, PurityId, Recipe } from '../catalog'
import type { ExtractorNode, MachineMode } from './types'

const EPS = 1e-9

export interface ItemRate {
  item: ItemId
  perMin: number
}

export interface NodeFlows {
  inputs: ItemRate[]
  outputs: ItemRate[]
}

export function minClock(machine: Machine): number {
  return machine.overclock?.min ?? 1
}

/** Highest clock reachable with every shard slot filled. */
export function maxClock(machine: Machine): number {
  const oc = machine.overclock
  return oc ? oc.baseMax + oc.shardSlots * oc.perShard : 1
}

/** Power shards each machine needs to run at `clock`. */
export function shardsNeeded(machine: Machine, clock: number): number {
  const oc = machine.overclock
  if (!oc || clock <= oc.baseMax + EPS) return 0
  return Math.ceil((clock - oc.baseMax) / oc.perShard - EPS)
}

export function sloopSlots(machine: Machine): number {
  return machine.amplifier?.slots ?? 0
}

/** Output multiplier from `sloops` Somersloops in one machine (clamped to its slots). */
export function outputMultiplier(machine: Machine, sloops: number): number {
  const amp = machine.amplifier
  if (!amp || sloops <= 0) return 1
  return 1 + Math.min(sloops, amp.slots) * amp.boostPerSlot
}

function amplifierPowerMultiplier(machine: Machine, sloops: number): number {
  const amp = machine.amplifier
  if (!amp || sloops <= 0) return 1
  return (1 + Math.min(sloops, amp.slots) / amp.slots) ** amp.powerExponent
}

/** Power in MW of one machine at 100% clock with no Somersloops. */
export function basePowerMw(machine: Machine, recipe?: Recipe): number {
  const vp = recipe?.variablePower
  return vp ? (vp.minMw + vp.maxMw) / 2 : machine.powerMw
}

/** Power in MW of one machine at `clock` with `sloops` Somersloops. */
export function machinePowerMw(machine: Machine, clock: number, sloops = 0, recipe?: Recipe): number {
  if (clock <= 0) return 0
  return basePowerMw(machine, recipe) * clock ** machine.powerExponent * amplifierPowerMultiplier(machine, sloops)
}

/** Power of `count` machines (possibly fractional) at `clock`. */
export function groupPowerMw(
  machine: Machine,
  count: number,
  clock: number,
  sloops = 0,
  recipe?: Recipe,
): number {
  const whole = Math.floor(count + EPS)
  const frac = count - whole
  const full = whole * machinePowerMw(machine, clock, sloops, recipe)
  return frac > EPS ? full + machinePowerMw(machine, clock * frac, sloops, recipe) : full
}

/** Power made by a generator group running `throughput` machines' worth at 100%. */
export function generatedMw(machine: Machine, throughput: number): number {
  return (machine.generation?.powerMw ?? 0) * throughput
}

export function recipeFlows(
  recipe: Recipe,
  machine: Machine,
  count: number,
  clock: number,
  sloops = 0,
): NodeFlows {
  const cyclesPerMin = (60 / recipe.durationSec) * machine.speed * clock * count
  const boost = outputMultiplier(machine, sloops)
  return {
    inputs: recipe.inputs.map((a) => ({ item: a.item, perMin: a.amount * cyclesPerMin })),
    outputs: recipe.outputs.map((a) => ({ item: a.item, perMin: a.amount * cyclesPerMin * boost })),
  }
}

/**
 * Machines at 100% clock (fractional) needed to make `perMin` of `item`.
 * Returns undefined if the recipe doesn't output the item.
 */
export function machinesFor(
  recipe: Recipe,
  machine: Machine,
  item: ItemId,
  perMin: number,
  sloops = 0,
): number | undefined {
  const out = recipe.outputs.find((a) => a.item === item)
  if (!out) return undefined
  const perMachine = out.amount * (60 / recipe.durationSec) * machine.speed * outputMultiplier(machine, sloops)
  return perMin / perMachine
}

export interface MachineSetup {
  count: number
  clock: number
  /** Power shards per machine. */
  shards: number
  /** False when the requested count would need more than the max clock. */
  feasible: boolean
}

/**
 * Turn a throughput in "machines at 100%" into a concrete setup.
 *   - fractional: throughput / clock machines at the preferred clock.
 *   - underclock: whole machines (rounded up at the preferred clock) sharing
 *     one clock, e.g. 2.4 → 3 at 80%.
 * Passing `count` fixes the machine count instead, overclocking if needed
 * (2.4 machines' worth on 2 machines = 2 at 120%, 1 shard each).
 */
export function machineSetup(
  machine: Machine,
  throughput: number,
  mode: MachineMode,
  opts: { clock?: number; count?: number } = {},
): MachineSetup {
  const preferred = opts.clock ?? 1
  if (throughput <= EPS && opts.count === undefined) {
    return { count: 0, clock: preferred, shards: 0, feasible: true }
  }
  let count: number
  let clock: number
  if (opts.count !== undefined) {
    count = opts.count
    clock = count > 0 ? throughput / count : 0
  } else if (mode === 'fractional') {
    count = throughput / preferred
    clock = preferred
  } else {
    count = Math.max(1, Math.ceil(throughput / preferred - EPS))
    clock = throughput / count
  }
  return {
    count,
    clock,
    shards: shardsNeeded(machine, clock),
    feasible: count > 0 && clock <= maxClock(machine) + EPS && clock >= minClock(machine) - EPS,
  }
}

function purityMultiplier(purities: ReadonlyMap<PurityId, Purity>, id: PurityId): number {
  return purities.get(id)?.multiplier ?? 1
}

/** Output per minute of an extractor group's sites at `clock`. */
export function extractorRate(
  machine: Machine,
  node: Pick<ExtractorNode, 'sites' | 'clock' | 'sloops'>,
  purities: ReadonlyMap<PurityId, Purity>,
): number {
  const spec = machine.extraction
  if (!spec) return 0
  const perMin = node.sites.reduce(
    (sum, s) => sum + spec.ratePerMin * (spec.usesPurity ? purityMultiplier(purities, s.purity) : 1) * s.count,
    0,
  )
  return perMin * node.clock * outputMultiplier(machine, node.sloops)
}

export function extractorFlows(
  machine: Machine,
  node: Pick<ExtractorNode, 'resource' | 'sites' | 'clock' | 'sloops'>,
  purities: ReadonlyMap<PurityId, Purity>,
): NodeFlows {
  if (!machine.extraction) return { inputs: [], outputs: [] }
  return { inputs: [], outputs: [{ item: node.resource, perMin: extractorRate(machine, node, purities) }] }
}

export function extractorPowerMw(
  machine: Machine,
  node: Pick<ExtractorNode, 'sites' | 'clock' | 'sloops'>,
  poweredBy?: Machine,
): number {
  const sites = node.sites.reduce((sum, s) => sum + s.count, 0)
  const own = sites * machinePowerMw(machine, node.clock, node.sloops)
  return poweredBy ? own + machinePowerMw(poweredBy, node.clock) : own
}
