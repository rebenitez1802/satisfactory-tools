// Balancers fed by several input belts.
//
// In the game a big flow comes from many machines, each with its own output,
// and no belt carries more than its tier (1200/min on Mk.6). Merging them all
// onto one trunk and splitting it again would overload the trunk and take many
// buildings. Instead the inputs are packed, as in a transportation problem:
// each output collects whole inputs that fit it, and only the few inputs that
// straddle two outputs are split, each by the single-input builder (`divide`).
// An output's merger tree never carries more than the output itself, so
// outputs above the belt limit first become several output belts.

import { Builder, divide } from './builder'
import { fitRatios } from './ratios'
import { simulate } from './simulate'
import type { OutputSpec, SolveResult, SolveWarning } from './types'

const REL_TOL = 1e-6

function round(n: number, dp = 4): number {
  const f = Math.pow(10, dp)
  return Math.round(n * f) / f
}

/** Part of input `input`'s belt that goes to output `output`. */
export interface Piece {
  input: number
  output: number
  rate: number
}

/**
 * Assign input belts to outputs whose rates add up to the same total. Every
 * output first takes whole inputs that fit it (an exact fit, else the largest),
 * biggest output first. The gaps left are then filled by cutting the input
 * whose rest fits best, so few inputs are split.
 */
export function pack(inputs: number[], outputs: number[], tol = 1e-9): Piece[] {
  const left = [...inputs]
  const need = [...outputs]
  const pieces: Piece[] = []
  const take = (i: number, j: number, rate: number) => {
    pieces.push({ input: i, output: j, rate })
    left[i] -= rate
    need[j] = Math.max(0, need[j] - rate)
    if (left[i] < tol) left[i] = 0
    if (need[j] < tol) need[j] = 0
  }
  const byNeed = () => need.map((_, j) => j).sort((a, b) => need[b] - need[a])

  // Whole inputs.
  const whole = (i: number) => left[i] > 0 && left[i] === inputs[i]
  for (const j of byNeed()) {
    for (;;) {
      let best = -1
      for (let i = 0; i < inputs.length; i++) {
        if (!whole(i) || left[i] > need[j] + tol) continue
        if (Math.abs(left[i] - need[j]) <= tol) {
          best = i
          break
        }
        if (best < 0 || left[i] > left[best]) best = i
      }
      if (best < 0) break
      take(best, j, left[best])
    }
  }

  // Cut inputs for the gaps.
  for (const j of byNeed()) {
    while (need[j] > 0) {
      let fit = -1
      let largest = -1
      for (let i = 0; i < inputs.length; i++) {
        if (left[i] <= 0) continue
        if (left[i] >= need[j] - tol && (fit < 0 || left[i] < left[fit])) fit = i
        if (largest < 0 || left[i] > left[largest]) largest = i
      }
      if (largest < 0) break
      if (fit >= 0) take(fit, j, Math.min(need[j], left[fit]))
      else take(largest, j, left[largest])
    }
  }
  return pieces.sort((a, b) => a.input - b.input || a.output - b.output)
}

/**
 * Outputs above `beltMax` leave on several equal belts: "Iron Plate 1/2".
 * `from` is the index of the output each belt came from.
 */
function splitWide(outputs: OutputSpec[], beltMax: number | undefined, tol: number) {
  const split: string[] = []
  const out = outputs.flatMap((o, j) => {
    const k = beltMax && beltMax > 0 ? Math.ceil((o.rate - tol) / beltMax) : 1
    if (k <= 1) return [{ ...o, from: j }]
    const name = o.label ?? `Output ${j + 1}`
    split.push(`${name} (${round(o.rate)}/min) leaves on ${k} belts of ${round(o.rate / k)}/min`)
    return Array.from({ length: k }, (_, n) => ({ label: `${name} ${n + 1}/${k}`, rate: o.rate / k, from: j }))
  })
  return { outputs: out, split }
}

export function solveMulti(inputs: number[], requested: OutputSpec[], beltMax?: number): SolveResult {
  const warnings: SolveWarning[] = []
  if (inputs.some((r) => !(r > 0))) {
    return { ok: false, warnings, error: 'Every input rate must be a positive number.' }
  }
  if (requested.length === 0) {
    return { ok: false, warnings, error: 'Add at least one output.' }
  }
  if (requested.some((o) => !(o.rate > 0))) {
    return { ok: false, warnings, error: 'Every output rate must be a positive number.' }
  }

  const total = inputs.reduce((s, r) => s + r, 0)
  const sum = requested.reduce((s, o) => s + o.rate, 0)
  const tol = Math.max(1e-6, total * REL_TOL)
  if (sum - total > tol) {
    return {
      ok: false,
      warnings,
      error: `Outputs sum to ${round(sum)} but the inputs only bring ${round(total)}. Reduce the outputs so they don't exceed the inputs.`,
    }
  }
  const leftover = total - sum > tol ? Number((total - sum).toFixed(6)) : 0
  const withLeftover = leftover > 0 ? [...requested, { label: 'Leftover', rate: leftover }] : requested
  const { outputs, split: wide } = splitWide(withLeftover, beltMax, tol)

  // Scale the outputs to the inputs' exact total, so rounding in the
  // leftover can't leave a crumb that packing has nowhere to put.
  const scale = total / outputs.reduce((s, o) => s + o.rate, 0)
  const pieces = pack(
    inputs,
    outputs.map((o) => o.rate * scale),
    tol,
  )

  // Sources in the order of the outputs they feed, so belts cross less.
  const firstOutput = (i: number) => Math.min(...pieces.filter((p) => p.input === i).map((p) => p.output))
  const order = inputs.map((_, i) => i).sort((a, b) => firstOutput(a) - firstOutput(b) || a - b)

  const b = new Builder()
  const sourceIds = new Map<number, string>()
  order.forEach((i, n) => {
    sourceIds.set(i, b.addNode('source', { rate: inputs[i], label: `In ${n + 1} · ${round(inputs[i])}/min` }))
  })
  const sinkIds = outputs.map((o) => b.addNode('sink', { label: o.label }))

  const streams: string[][] = outputs.map(() => [])
  const targets = outputs.map(() => 0)
  const closeLoops: (() => void)[] = []
  let loopbacks = 0
  let splitInputs = 0
  let snapped = false
  for (const i of order) {
    const mine = pieces.filter((p) => p.input === i)
    const src = sourceIds.get(i)!
    if (mine.length === 1) {
      streams[mine[0].output].push(src)
      targets[mine[0].output] += inputs[i]
      continue
    }
    splitInputs++
    const fitted = fitRatios(mine.map((p) => p.rate))
    snapped ||= fitted.snapped
    const division = divide(b, src, fitted.ratios)
    mine.forEach((p, k) => {
      streams[p.output].push(...division.streams[k])
      targets[p.output] += (inputs[i] * fitted.ratios[k]) / fitted.N
    })
    loopbacks += division.loopbacks
    closeLoops.push(division.closeLoop)
  }
  streams.forEach((ports, j) => b.addEdge(b.mergeStreams(ports), sinkIds[j]))
  for (const close of closeLoops) close()

  const graph = { nodes: b.nodes, edges: b.edges }
  sinkIds.forEach((id, j) => {
    const sink = graph.nodes.find((n) => n.id === id)!
    sink.target = targets[j]
    const rateStr = `${round(targets[j])}/min`
    sink.label = outputs[j].label ? `${outputs[j].label} · ${rateStr}` : rateStr
    if (outputs[j].from >= requested.length) sink.leftover = true
  })

  // Verify by simulation, as for a single input.
  const sim = simulate(graph, 0)
  if (!sim.converged) {
    return { ok: false, warnings, error: 'Internal error: flow simulation did not converge.' }
  }
  for (let j = 0; j < sinkIds.length; j++) {
    const got = sim.nodeInflow.get(sinkIds[j]) ?? 0
    if (Math.abs(got - targets[j]) > Math.max(1e-6, targets[j] * 1e-5)) {
      return {
        ok: false,
        warnings,
        error: `Internal error: output ${j + 1} computed ${round(got)} but expected ${round(targets[j])}.`,
      }
    }
  }

  if (leftover > 0) {
    warnings.push({
      kind: 'leftover',
      message:
        `Outputs add up to ${round(sum)} of ${round(total)}/min, so the ` +
        `remaining ${round(leftover)}/min goes to a Leftover output (red).`,
    })
  }
  if (wide.length > 0) {
    warnings.push({ kind: 'info', message: `Over the belt cap: ${wide.join('; ')}.` })
  }
  if (snapped) {
    warnings.push({ kind: 'info', message: 'Some split inputs were treated as exact simple ratios.' })
  }
  if (loopbacks > 0) {
    warnings.push({
      kind: 'info',
      message: `Some inputs split in ratios that aren't made of halves and thirds, so the design uses ${loopbacks} feedback belt${loopbacks > 1 ? 's' : ''} (loopback).`,
    })
  }
  if (beltMax && beltMax > 0) {
    const over = graph.edges.filter((e) => (e.flow ?? 0) > beltMax + 1e-6)
    if (over.length > 0) {
      const maxFlow = Math.max(...over.map((e) => e.flow ?? 0))
      warnings.push({
        kind: 'belt-over-capacity',
        message:
          `${over.length} belt${over.length > 1 ? 's' : ''} exceed the ` +
          `${round(beltMax)}/min cap (up to ${round(maxFlow)}/min). ` +
          (inputs.some((r) => r > beltMax + 1e-6) ? 'An input is already faster than the cap.' : 'Loopbacks carry more than the input they split.'),
        edgeIds: over.map((e) => e.id),
      })
    }
  }

  return { ok: true, graph, leftover, loopbacks, inputs: { count: inputs.length, split: splitInputs }, warnings }
}
