// Top-level entry point: turn a desired input + outputs into a verified graph.

import { maxError, roundedNote, simplestRatio, sinkLabel } from './approx'
import type { Bound } from './approx'
import { buildBalancer } from './builder'
import { solveMulti } from './multi'
import { fitRatios } from './ratios'
import { simulate } from './simulate'
import type { SolveInput, SolveResult, SolveWarning } from './types'

const REL_TOL = 1e-6

function round(n: number, dp = 4): number {
  const f = Math.pow(10, dp)
  return Math.round(n * f) / f
}

export function solve(input: SolveInput): SolveResult {
  if (input.inputs && input.inputs.length > 1) return solveMulti(input.inputs, input.outputs, input.beltMax, input.tolerance)
  const warnings: SolveWarning[] = []
  const { input: inputRate, beltMax } = input
  let { outputs } = input

  if (!(inputRate > 0)) {
    return { ok: false, warnings, error: 'Input rate must be a positive number.' }
  }
  if (outputs.length === 0) {
    return { ok: false, warnings, error: 'Add at least one output.' }
  }
  if (outputs.some((o) => !(o.rate > 0))) {
    return { ok: false, warnings, error: 'Every output rate must be a positive number.' }
  }

  // Outputs may fall short of the input: the remainder goes to an extra
  // "leftover" output so the belt never backs up. Exceeding it is impossible.
  const sum = outputs.reduce((s, o) => s + o.rate, 0)
  const tol = Math.max(1e-6, inputRate * REL_TOL)
  if (sum - inputRate > tol) {
    return {
      ok: false,
      warnings,
      error: `Outputs sum to ${round(sum)} but the input is only ${round(
        inputRate,
      )}. Reduce the outputs so they don't exceed the input.`,
    }
  }
  const leftover = inputRate - sum > tol ? Number((inputRate - sum).toFixed(6)) : 0
  if (leftover > 0) {
    outputs = [...outputs, { label: 'Leftover', rate: leftover }]
  }

  let fitted
  try {
    fitted = fitRatios(outputs.map((o) => o.rate))
  } catch (err) {
    return { ok: false, warnings, error: (err as Error).message }
  }
  let { ratios, N } = fitted
  if (fitted.snapped) {
    outputs = outputs.map((o, i) => ({ ...o, rate: fitted.rates[i] }))
  }

  // Within a tolerance, the simplest ratio that keeps every output close.
  let requested: number[] | undefined
  let hasLeftover = leftover > 0
  const tolerance = input.tolerance ?? 0
  if (tolerance > 0 && outputs.length > 1) {
    const rates = outputs.map((o) => o.rate)
    const isLeftover = (i: number) => leftover > 0 && i === outputs.length - 1
    const bounds: Bound[] = rates.map((r, i) =>
      isLeftover(i)
        ? // The leftover only shrinks, even to nothing: what outputs don't take spills into it.
          { lo: -r, hi: 0 }
        : { lo: leftover > 0 ? 0 : -tolerance * r, hi: tolerance * r },
    )
    const chosen = simplestRatio(rates, bounds, ratios)
    if (chosen !== ratios) {
      const n = chosen.reduce((sum, x) => sum + x, 0)
      const kept = outputs.map((_, i) => i).filter((i) => chosen[i] > 0)
      requested = kept.map((i) => rates[i])
      hasLeftover = kept.some(isLeftover)
      outputs = kept.map((i) => ({ ...outputs[i], rate: (inputRate * chosen[i]) / n }))
      ratios = kept.map((i) => chosen[i])
      N = n
    }
  }
  if (fitted.snapped && !requested) {
    warnings.push({ kind: 'info', message: `Rates were treated as the exact ratio ${ratios.join(' : ')}.` })
  }

  const labels = outputs.map((o) => o.label)
  const { graph, leafCount, loopbacks } = buildBalancer(ratios, labels)

  // Attach display targets/labels to sinks and the source.
  const sinks = graph.nodes.filter((n) => n.kind === 'sink')
  sinks.forEach((sink, i) => {
    sink.target = outputs[i].rate
    sink.label = sinkLabel(outputs[i].label, outputs[i].rate, hasLeftover && i === outputs.length - 1 ? undefined : requested?.[i])
  })
  if (hasLeftover) sinks[sinks.length - 1].leftover = true
  const source = graph.nodes.find((n) => n.kind === 'source')
  if (source) source.label = `Input · ${round(inputRate)}/min`

  // Verify by simulation — this is the correctness guarantee, loops included.
  const sim = simulate(graph, inputRate)
  if (!sim.converged) {
    return {
      ok: false,
      warnings,
      error: 'Internal error: flow simulation did not converge.',
    }
  }
  for (let i = 0; i < sinks.length; i++) {
    const got = sim.nodeInflow.get(sinks[i].id) ?? 0
    const want = outputs[i].rate
    if (Math.abs(got - want) > Math.max(1e-6, want * 1e-5)) {
      return {
        ok: false,
        warnings,
        error: `Internal error: output ${i + 1} computed ${round(
          got,
        )} but expected ${round(want)}.`,
      }
    }
  }

  const approx = requested ? { maxError: maxError(hasLeftover ? outputs.slice(0, -1).map((o) => o.rate) : outputs.map((o) => o.rate), requested) } : undefined
  if (approx) {
    warnings.push({ kind: 'info', message: roundedNote(approx.maxError, ratios.join(' : '), leftover > 0 ? (hasLeftover ? 'kept' : 'dropped') : 'none') })
  }

  if (hasLeftover) {
    warnings.push({
      kind: 'leftover',
      message:
        `Outputs add up to ${round(sum)} of ${round(inputRate)}/min, so the ` +
        `remaining ${round(outputs[outputs.length - 1].rate)}/min goes to a Leftover output (red).`,
    })
  }

  // Informational: loopbacks present.
  if (loopbacks > 0) {
    warnings.push({
      kind: 'info',
      message:
        `This ratio isn't divisible using only halves and thirds, so the design ` +
        `uses ${loopbacks} feedback belt${loopbacks > 1 ? 's' : ''} (loopback) to ` +
        `split evenly into ${N} shares.`,
    })
  }

  // Optional belt-capacity warnings.
  if (beltMax && beltMax > 0) {
    const over = graph.edges.filter((e) => (e.flow ?? 0) > beltMax + 1e-6)
    if (over.length > 0) {
      const maxFlow = Math.max(...over.map((e) => e.flow ?? 0))
      warnings.push({
        kind: 'belt-over-capacity',
        message:
          `${over.length} belt${over.length > 1 ? 's' : ''} exceed the ` +
          `${round(beltMax)}/min cap (up to ${round(maxFlow)}/min). ` +
          `Internal belts can carry more than the input when loopbacks are used.`,
        edgeIds: over.map((e) => e.id),
      })
    }
  }

  return {
    ok: true,
    graph,
    ratios,
    N,
    leafCount,
    loopbacks,
    leftover: hasLeftover ? outputs[outputs.length - 1].rate : 0,
    approx,
    warnings,
  }
}
