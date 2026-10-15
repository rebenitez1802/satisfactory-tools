import { describe, expect, it } from 'vitest'
import { reduceRatios, gcd } from '../ratios'
import { smooth3AtLeast, factorizeSmooth, buildBalancer } from '../builder'
import { simulate } from '../simulate'
import { pack } from '../multi'
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

describe('simple ratios', () => {
  it('recovers exact ratios from repeating decimals', async () => {
    const { simpleRatios } = await import('../ratios')
    expect(simpleRatios([80 / 3, 40 / 3])).toMatchObject({ ratios: [2, 1], N: 3 })
    expect(simpleRatios([33.33, 66.67])).toMatchObject({ ratios: [1, 2], N: 3 })
    expect(simpleRatios([37, 63])).toMatchObject({ ratios: [37, 63], N: 100 })
    expect(simpleRatios([12.345, 87.655])).toMatchObject({ ratios: [10, 71] })
    expect(simpleRatios([12.345, 87.655], 120, 1e-7)).toBeUndefined()
  })

  it('solve snaps thirds to a small balancer', () => {
    const r = solve({ input: 40, outputs: [{ rate: 80 / 3 }, { rate: 40 / 3 }] })
    expect(r.ok).toBe(true)
    expect(r.N).toBe(3)
    const rounded = solve({ input: 40, outputs: [{ rate: 26.6667 }, { rate: 13.3333 }] })
    expect(rounded.ok).toBe(true)
    expect(rounded.N).toBe(3)
    expect(rounded.warnings.some((w) => w.message.includes('2 : 1'))).toBe(true)
  })
})

describe('several inputs', () => {
  /** Solve, check structure, and simulate: every output must get its rate. */
  function check(inputs: number[], outs: number[], beltMax?: number) {
    const res = solve({ input: 0, inputs, outputs: outs.map((rate) => ({ rate })), beltMax })
    expect(res.error).toBeUndefined()
    expect(res.ok).toBe(true)
    const graph = res.graph!
    assertStructure(graph)
    expect(graph.nodes.filter((n) => n.kind === 'source')).toHaveLength(inputs.length)
    const sim = simulate(graph, 0)
    expect(sim.converged).toBe(true)
    const sinks = graph.nodes.filter((n) => n.kind === 'sink')
    for (const s of sinks) expect(sim.nodeInflow.get(s.id)!).toBeCloseTo(s.target!, 5)
    return { res, graph, sinks, sim }
  }
  const count = (graph: Graph, kind: string) => graph.nodes.filter((n) => n.kind === kind).length

  it('20 machines at 100/min into 1200 / 800 on Mk.6: no splitter, no belt over 1200', () => {
    const { res, graph, sinks } = check(new Array(20).fill(100), [1200, 800], 1200)
    expect(count(graph, 'splitter')).toBe(0)
    expect(sinks.map((s) => s.target)).toEqual([1200, 800])
    expect(Math.max(...graph.edges.map((e) => e.flow!))).toBeLessThanOrEqual(1200 + 1e-6)
    expect(res.inputs).toEqual({ count: 20, split: 0 })
    expect(res.warnings.filter((w) => w.kind === 'belt-over-capacity')).toHaveLength(0)
  })

  it('splits only the input that straddles two outputs', () => {
    const { res, graph } = check(new Array(20).fill(100), [1150, 850], 1200)
    expect(res.inputs?.split).toBe(1)
    expect(count(graph, 'splitter')).toBe(1)
  })

  it('a partial machine: 7 × 100 + 50 into 400 / 350', () => {
    const { res, graph } = check([...new Array(7).fill(100), 50], [400, 350])
    expect(res.inputs?.split).toBe(0)
    expect(count(graph, 'splitter')).toBe(0)
  })

  it('outputs above the cap leave on several belts', () => {
    const { res, sinks, graph } = check(new Array(20).fill(100), [1500, 500], 1200)
    expect(sinks.map((s) => s.target)).toEqual([750, 750, 500])
    expect(sinks[0].label).toContain('1/2')
    expect(Math.max(...graph.edges.map((e) => e.flow!))).toBeLessThanOrEqual(1200 + 1e-6)
    expect(res.warnings.some((w) => w.kind === 'info' && w.message.includes('2 belts'))).toBe(true)
  })

  it('the remainder goes to a Leftover output', () => {
    const { res, sinks } = check([250, 250, 250], [300, 200])
    expect(res.leftover).toBeCloseTo(250, 6)
    expect(sinks.filter((s) => s.leftover)).toHaveLength(1)
  })

  it('uneven inputs and awkward ratios still simulate exactly', () => {
    check([142.857142, 142.857142, 142.857142, 142.857142, 142.857142, 142.857142, 142.857148], [600, 400])
    check([60, 45, 30, 37.5], [52.5, 70, 50])
    check([120, 120, 120], [100, 100, 100, 60])
    check([2000 / 14, 2000 / 14, 2000 / 14, 2000 / 14, 2000 / 14, 2000 / 14, 2000 / 14, 2000 / 14, 2000 / 14, 2000 / 14, 2000 / 14, 2000 / 14, 2000 / 14, 2000 / 14], [1200, 800], 1200)
  })

  it('a single input in `inputs` still uses the single-input builder', () => {
    const res = solve({ input: 120, inputs: [120], outputs: [{ rate: 60 }, { rate: 60 }] })
    expect(res.ok).toBe(true)
    expect(res.N).toBe(2)
  })

  it('rejects outputs above the inputs, and bad rates', () => {
    expect(solve({ input: 0, inputs: [100, 100], outputs: [{ rate: 250 }] }).ok).toBe(false)
    expect(solve({ input: 0, inputs: [100, 0], outputs: [{ rate: 50 }] }).ok).toBe(false)
  })

  it('flags an input that is already over the cap', () => {
    const { res } = check([300, 300], [400, 200], 270)
    expect(res.warnings.some((w) => w.kind === 'belt-over-capacity')).toBe(true)
  })
})

describe('pack', () => {
  it('assigns whole inputs first and cuts as few as it can', () => {
    const pieces = pack([60, 50, 50, 40], [100, 100])
    expect(pieces).toHaveLength(4)
    const cut = new Set(pieces.map((p) => p.input))
    expect(cut.size).toBe(4)
  })

  it('every input and output adds up', () => {
    const inputs = [37, 81, 12.5, 99, 45]
    const outputs = [100, 70, 104.5]
    const pieces = pack(inputs, outputs)
    inputs.forEach((r, i) => expect(pieces.filter((p) => p.input === i).reduce((s, p) => s + p.rate, 0)).toBeCloseTo(r, 9))
    outputs.forEach((r, j) => expect(pieces.filter((p) => p.output === j).reduce((s, p) => s + p.rate, 0)).toBeCloseTo(r, 9))
  })
})

describe('tolerance: rounded ratios', () => {
  const outs = [92.4, 88.9, 1077.2, 697.5]
  const size = (r: ReturnType<typeof solve>) => {
    const g = r.graph!
    return g.nodes.filter((n) => n.kind === 'splitter' || n.kind === 'merger').length + r.loopbacks!
  }
  /** Every output within `tol` of what it asked, checked by simulation. */
  function within(r: ReturnType<typeof solve>, asked: number[], tol: number, input: number) {
    expect(r.ok).toBe(true)
    assertStructure(r.graph!)
    const sim = simulate(r.graph!, input)
    const sinks = r.graph!.nodes.filter((n) => n.kind === 'sink' && !n.leftover)
    expect(sinks).toHaveLength(asked.length)
    sinks.forEach((s, i) => {
      const got = sim.nodeInflow.get(s.id)!
      expect(got).toBeCloseTo(s.target!, 5)
      expect(Math.abs(got - asked[i]) / asked[i]).toBeLessThanOrEqual(tol + 1e-9)
    })
  }

  it('the user case shrinks from a monster to a small balancer', () => {
    const exact = solve({ input: 1956, outputs: outs.map((rate) => ({ rate })) })
    for (const tol of [0.01, 0.02, 0.05]) {
      const r = solve({ input: 1956, outputs: outs.map((rate) => ({ rate })), tolerance: tol })
      within(r, outs, tol, 1956)
      expect(size(r)).toBeLessThan(size(exact) / 4)
      expect(r.approx!.maxError).toBeLessThanOrEqual(tol + 1e-9)
      expect(r.warnings.some((w) => w.message.startsWith('Rounded to'))).toBe(true)
    }
  })

  it('37 / 63 within 2% is 3 : 5', () => {
    const r = solve({ input: 100, outputs: [{ rate: 37 }, { rate: 63 }], tolerance: 0.02 })
    expect(r.ratios).toEqual([3, 5])
    expect(r.loopbacks).toBe(0)
    expect(r.graph!.nodes.find((n) => n.kind === 'sink')!.label).toBe('37.5 (+1.4%)')
  })

  it('keeps an exact ratio that is already simple', () => {
    const r = solve({ input: 120, outputs: [{ rate: 40 }, { rate: 80 }], tolerance: 0.05 })
    expect(r.approx).toBeUndefined()
    expect(r.ratios).toEqual([1, 2])
  })

  it('with a Leftover, outputs only round up and the Leftover only down', () => {
    const r = solve({ input: 2000, outputs: outs.map((rate) => ({ rate })), tolerance: 0.02 })
    expect(r.ok).toBe(true)
    const sim = simulate(r.graph!, 2000)
    const sinks = r.graph!.nodes.filter((n) => n.kind === 'sink')
    sinks.filter((s) => !s.leftover).forEach((s, i) => {
      const got = sim.nodeInflow.get(s.id)!
      expect(got).toBeGreaterThanOrEqual(outs[i] - 1e-6)
      expect(got).toBeLessThanOrEqual(outs[i] * 1.02 + 1e-6)
    })
    expect(r.leftover!).toBeLessThanOrEqual(2000 - 1956 + 1e-6)
  })

  it('several inputs: tiny cuts are dropped, whole machines go to one output', () => {
    const inputs = [...new Array(65).fill(30), 6]
    const exact = solve({ input: 0, inputs, outputs: outs.map((rate) => ({ rate })) })
    const r = solve({ input: 0, inputs, outputs: outs.map((rate) => ({ rate })), tolerance: 0.05 })
    expect(r.ok).toBe(true)
    assertStructure(r.graph!)
    expect(r.inputs!.split).toBeLessThan(exact.inputs!.split + 1)
    expect(r.loopbacks).toBe(0)
    expect(r.graph!.nodes.filter((n) => n.kind === 'splitter').length).toBeLessThan(exact.graph!.nodes.filter((n) => n.kind === 'splitter').length)
    const sim = simulate(r.graph!, 0)
    r.graph!.nodes
      .filter((n) => n.kind === 'sink')
      .forEach((s, i) => {
        expect(sim.nodeInflow.get(s.id)!).toBeCloseTo(s.target!, 5)
        expect(Math.abs(s.target! - outs[i]) / outs[i]).toBeLessThanOrEqual(0.05 + 1e-9)
      })
  })
})

describe('approxCandidates', () => {
  it('keeps every rate within its bound', async () => {
    const { approxCandidates } = await import('../approx')
    const rates = [37, 63]
    for (const c of approxCandidates(rates, rates.map((r) => ({ lo: -0.02 * r, hi: 0.02 * r })), 60)) {
      const N = c[0] + c[1]
      c.forEach((x, k) => expect(Math.abs((x / N) * 100 - rates[k]) / rates[k]).toBeLessThanOrEqual(0.02 + 1e-9))
    }
  })
  it('a piece may vanish only when its bound allows it', async () => {
    const { approxCandidates } = await import('../approx')
    const withZero = approxCandidates([2, 98], [{ lo: -2, hi: 2 }, { lo: -2, hi: 2 }], 10)
    expect(withZero.some((c) => c[0] === 0)).toBe(true)
    const without = approxCandidates([2, 98], [{ lo: -1, hi: 1 }, { lo: -1, hi: 1 }], 10)
    expect(without.every((c) => c[0] > 0)).toBe(true)
  })
})
