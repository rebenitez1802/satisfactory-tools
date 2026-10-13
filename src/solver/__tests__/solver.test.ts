import { describe, expect, it } from 'vitest'
import { reduceRatios, gcd } from '../ratios'
import { smooth3AtLeast, factorizeSmooth, buildBalancer } from '../builder'
import { simulate } from '../simulate'
import { solve } from '../solve'
import type { Graph } from '../types'

describe('ratios', () => {
  it('gcd', () => {
    expect(gcd(12, 8)).toBe(4)
    expect(gcd(7, 13)).toBe(1)
  })

  it('reduces integer rates', () => {
    expect(reduceRatios([150, 90, 60])).toMatchObject({ ratios: [5, 3, 2], N: 10 })
    expect(reduceRatios([60, 60, 60])).toMatchObject({ ratios: [1, 1, 1], N: 3 })
  })

  it('handles fractional rates', () => {
    // 12.5 + 12.5 + 25 = 50 -> 1:1:2
    expect(reduceRatios([12.5, 12.5, 25])).toMatchObject({ ratios: [1, 1, 2], N: 4 })
  })
})

describe('3-smooth helpers', () => {
  it('smooth3AtLeast', () => {
    expect(smooth3AtLeast(1)).toBe(1)
    expect(smooth3AtLeast(5)).toBe(6)
    expect(smooth3AtLeast(7)).toBe(8)
    expect(smooth3AtLeast(11)).toBe(12)
    expect(smooth3AtLeast(13)).toBe(16)
    expect(smooth3AtLeast(17)).toBe(18)
    expect(smooth3AtLeast(6)).toBe(6)
  })

  it('factorizeSmooth multiplies back', () => {
    for (const b of [1, 2, 3, 4, 6, 8, 9, 12, 16, 18, 24, 27, 36]) {
      const f = factorizeSmooth(b)
      expect(f.reduce((p, x) => p * x, 1)).toBe(b)
      expect(f.every((x) => x === 2 || x === 3)).toBe(true)
    }
  })
})

/** Assert the generated graph obeys Satisfactory's connection limits. */
function assertStructure(graph: Graph) {
  const indeg = new Map<string, number>()
  const outdeg = new Map<string, number>()
  for (const n of graph.nodes) {
    indeg.set(n.id, 0)
    outdeg.set(n.id, 0)
  }
  for (const e of graph.edges) {
    outdeg.set(e.source, outdeg.get(e.source)! + 1)
    indeg.set(e.target, indeg.get(e.target)! + 1)
  }
  for (const n of graph.nodes) {
    const i = indeg.get(n.id)!
    const o = outdeg.get(n.id)!
    if (n.kind === 'splitter') {
      expect(i, `splitter ${n.id} inputs`).toBe(1)
      expect(o >= 2 && o <= 3, `splitter ${n.id} outputs=${o}`).toBe(true)
    } else if (n.kind === 'merger') {
      expect(i >= 2 && i <= 3, `merger ${n.id} inputs=${i}`).toBe(true)
      expect(o, `merger ${n.id} outputs`).toBe(1)
    } else if (n.kind === 'source') {
      expect(i).toBe(0)
      expect(o).toBe(1)
    } else if (n.kind === 'sink') {
      expect(i).toBe(1)
      expect(o).toBe(0)
    }
  }
}

describe('buildBalancer + simulate: even N-way splits', () => {
  // Every N up to 60 must split evenly into N equal shares.
  for (let N = 1; N <= 60; N++) {
    it(`1 -> ${N} equal`, () => {
      const ratios = new Array(N).fill(1)
      const { graph } = buildBalancer(ratios)
      assertStructure(graph)
      const input = 120
      const sim = simulate(graph, input)
      expect(sim.converged).toBe(true)
      const sinks = graph.nodes.filter((n) => n.kind === 'sink')
      expect(sinks).toHaveLength(N)
      for (const s of sinks) {
        expect(sim.nodeInflow.get(s.id)!).toBeCloseTo(input / N, 6)
      }
    })
  }
})

describe('solve: arbitrary ratios', () => {
  const cases: Array<{ input: number; outs: number[] }> = [
    { input: 100, outs: [50, 50] },
    { input: 120, outs: [40, 40, 40] },
    { input: 780, outs: [60, 120, 600] },
    { input: 100, outs: [20, 20, 20, 20, 20] }, // needs a loop (N=5)
    { input: 140, outs: [20, 20, 20, 20, 20, 20, 20] }, // N=7 loop
    { input: 130, outs: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10] }, // N=13
    { input: 150, outs: [150] }, // passthrough
    { input: 100, outs: [37, 63] }, // coprime
    { input: 50, outs: [12.5, 12.5, 25] }, // fractional
  ]

  for (const c of cases) {
    it(`${c.input} -> [${c.outs.join(', ')}]`, () => {
      const res = solve({ input: c.input, outputs: c.outs.map((rate) => ({ rate })) })
      expect(res.error).toBeUndefined()
      expect(res.ok).toBe(true)
      assertStructure(res.graph!)
      const sim = simulate(res.graph!, c.input)
      const sinks = res.graph!.nodes.filter((n) => n.kind === 'sink')
      sinks.forEach((s, i) => {
        expect(sim.nodeInflow.get(s.id)!).toBeCloseTo(c.outs[i], 5)
      })
    })
  }

  it('builds a compact graph (no fan-out to unit streams)', () => {
    // 136 -> 60/40/36 reduces to 15:10:9 (N=34). The recursive construction
    // keeps belts aggregated, so this must stay small (reference design is
    // ~5 splitters + 4 mergers), not ~36 leaf splitters.
    const res = solve({ input: 136, outputs: [60, 40, 36].map((rate) => ({ rate })) })
    expect(res.ok).toBe(true)
    const splitters = res.graph!.nodes.filter((n) => n.kind === 'splitter').length
    const mergers = res.graph!.nodes.filter((n) => n.kind === 'merger').length
    expect(splitters).toBeLessThanOrEqual(8)
    expect(mergers).toBeLessThanOrEqual(8)

    // A coprime split like 37:63 (N=100) must NOT create ~100 splitters.
    const big = solve({ input: 100, outputs: [37, 63].map((rate) => ({ rate })) })
    expect(big.graph!.nodes.filter((n) => n.kind === 'splitter').length).toBeLessThan(15)
  })

  it('rejects outputs that exceed the input', () => {
    const res = solve({ input: 100, outputs: [{ rate: 60 }, { rate: 60 }] })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/sum/i)
  })

  it('routes a shortfall to an extra leftover output', () => {
    const res = solve({ input: 100, outputs: [{ rate: 40 }, { rate: 33.3 }] })
    expect(res.ok).toBe(true)
    expect(res.leftover).toBeCloseTo(26.7, 6)
    const sinks = res.graph!.nodes.filter((n) => n.kind === 'sink')
    expect(sinks).toHaveLength(3)
    expect(sinks.filter((s) => s.leftover)).toHaveLength(1)
    expect(sinks[2].leftover).toBe(true)
    const sim = simulate(res.graph!, 100)
    expect(sim.nodeInflow.get(sinks[0].id)!).toBeCloseTo(40, 5)
    expect(sim.nodeInflow.get(sinks[1].id)!).toBeCloseTo(33.3, 5)
    expect(sim.nodeInflow.get(sinks[2].id)!).toBeCloseTo(26.7, 5)
    expect(res.warnings.some((w) => w.kind === 'leftover')).toBe(true)
  })

  it('adds no leftover output when outputs sum to input', () => {
    const res = solve({ input: 120, outputs: [40, 40, 40].map((rate) => ({ rate })) })
    expect(res.leftover).toBe(0)
    expect(res.graph!.nodes.some((n) => n.leftover)).toBe(false)
  })

  it('flags belt over-capacity when a cap is given', () => {
    // N=5 loopback makes the trunk belt carry 6/5 * input = 120.
    const res = solve({
      input: 100,
      outputs: [20, 20, 20, 20, 20].map((rate) => ({ rate })),
      beltMax: 110,
    })
    expect(res.ok).toBe(true)
    expect(res.warnings.some((w) => w.kind === 'belt-over-capacity')).toBe(true)
  })

  it('reports a loopback for non-3-smooth N and none for 3-smooth', () => {
    const loop = solve({ input: 100, outputs: [20, 20, 20, 20, 20].map((r) => ({ rate: r })) })
    expect(loop.loopbacks).toBeGreaterThan(0)
    const tree = solve({ input: 120, outputs: [40, 40, 40].map((r) => ({ rate: r })) })
    expect(tree.loopbacks).toBe(0)
  })
})
