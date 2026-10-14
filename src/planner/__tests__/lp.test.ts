import { describe, expect, it } from 'vitest'
import { solveLp, type LpProblem } from '../lp'

const optimal = (p: LpProblem) => {
  const r = solveLp(p)
  if (r.status !== 'optimal') throw new Error(r.status)
  return r
}

describe('solveLp', () => {
  it('solves a textbook maximization', () => {
    // max 3x + 5y, x ≤ 4, 2y ≤ 12, 3x + 2y ≤ 18 → x = 2, y = 6, 36.
    const r = optimal({
      vars: 2,
      objective: [-3, -5],
      constraints: [
        { terms: [[0, 1]], op: '<=', rhs: 4 },
        { terms: [[1, 2]], op: '<=', rhs: 12 },
        { terms: [[0, 3], [1, 2]], op: '<=', rhs: 18 },
      ],
    })
    expect(r.x[0]).toBeCloseTo(2)
    expect(r.x[1]).toBeCloseTo(6)
    expect(r.value).toBeCloseTo(-36)
  })

  it('handles ≥ and = rows (phase 1)', () => {
    // min x + y, x + 2y ≥ 4, x − y = 1 → x = 2, y = 1.
    const r = optimal({
      vars: 2,
      objective: [1, 1],
      constraints: [
        { terms: [[0, 1], [1, 2]], op: '>=', rhs: 4 },
        { terms: [[0, 1], [1, -1]], op: '=', rhs: 1 },
      ],
    })
    expect(r.x[0]).toBeCloseTo(2)
    expect(r.x[1]).toBeCloseTo(1)
  })

  it('flips rows with a negative right-hand side', () => {
    // −x ≤ −3 is x ≥ 3.
    const r = optimal({ vars: 1, objective: [1], constraints: [{ terms: [[0, -1]], op: '<=', rhs: -3 }] })
    expect(r.x[0]).toBeCloseTo(3)
  })

  it('reports infeasible and unbounded programs', () => {
    expect(
      solveLp({
        vars: 1,
        objective: [1],
        constraints: [
          { terms: [[0, 1]], op: '>=', rhs: 5 },
          { terms: [[0, 1]], op: '<=', rhs: 3 },
        ],
      }).status,
    ).toBe('infeasible')
    expect(solveLp({ vars: 2, objective: [-1, 0], constraints: [{ terms: [[0, 1], [1, -1]], op: '<=', rhs: 1 }] }).status).toBe(
      'unbounded',
    )
  })

  it('copes with redundant equalities and degenerate vertices', () => {
    const r = optimal({
      vars: 3,
      objective: [1, 2, 3],
      constraints: [
        { terms: [[0, 1], [1, 1], [2, 1]], op: '=', rhs: 6 },
        { terms: [[0, 2], [1, 2], [2, 2]], op: '=', rhs: 12 },
        { terms: [[0, 1]], op: '<=', rhs: 0 },
        { terms: [[1, 1]], op: '>=', rhs: 0 },
      ],
    })
    expect(r.x[1]).toBeCloseTo(6)
    expect(r.value).toBeCloseTo(12)
  })

  it('treats a recipe chain as flows', () => {
    // Ore → ingots (1:1) or → ingots via a 2:3 alternate; 90 ingots wanted.
    // Variables: x0 standard machines (30/min), x1 alternate (in 20, out 30), x2 ore.
    const r = optimal({
      vars: 3,
      objective: [0, 0, 1],
      constraints: [
        { terms: [[0, 30], [1, 30]], op: '>=', rhs: 90 },
        { terms: [[2, 1], [0, -30], [1, -20]], op: '>=', rhs: 0 },
      ],
    })
    expect(r.x[1]).toBeCloseTo(3)
    expect(r.x[2]).toBeCloseTo(60)
  })
})
