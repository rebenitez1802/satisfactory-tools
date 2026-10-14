// A small linear-program solver for the optimizer (roadmap #6): minimize c·x
// subject to linear constraints and x ≥ 0.
//
// Dense two-phase simplex on a tableau. The planner's programs are small (a
// few hundred recipe variables, one row per item), so a dense tableau solves
// one in tens of milliseconds and keeps this free of dependencies. Phase 1
// minimizes the artificial variables to find a feasible basis; phase 2
// minimizes the real objective from there.
//
// - Rows are scaled to a largest coefficient of 1, since recipe rates and
//   resource weights span several orders of magnitude.
// - The planner's item rows ("made ≥ used") all have a right-hand side of 0,
//   which makes the program badly degenerate: the simplex can pivot for
//   thousands of steps without moving. Each inequality is relaxed by a tiny,
//   different amount (a millionth of a percent of the largest right-hand
//   side), which breaks the ties. Once optimal, the basic variables are
//   worked out again with the exact right-hand sides, so the answer has the
//   clean zeros of an unrelaxed vertex.
// - Entering columns follow Dantzig's rule (most negative reduced cost),
//   which is fast in practice. After a run of degenerate pivots it switches
//   to Bland's rule (lowest index), which can't cycle. Among tied leaving
//   rows the largest pivot wins, for numerical stability.

export type LpOp = '<=' | '>=' | '='

export interface LpConstraint {
  /** [variable index, coefficient] pairs. */
  terms: [number, number][]
  op: LpOp
  rhs: number
}

export interface LpProblem {
  /** Number of variables, all ≥ 0. */
  vars: number
  /** Cost per variable, minimized. Missing entries are 0. */
  objective: number[]
  constraints: LpConstraint[]
}

export type LpResult =
  | { status: 'optimal'; x: number[]; value: number }
  | { status: 'infeasible' }
  | { status: 'unbounded' }

const TOL = 1e-9
const PERTURB = 1e-8
const MAX_PIVOTS = 50_000
const DEGENERATE_RUN = 50

export function solveLp(problem: LpProblem): LpResult {
  const n = problem.vars
  const big = Math.max(1, ...problem.constraints.map((c) => Math.abs(c.rhs)))
  const rows = problem.constraints.map((c, i) => {
    // Merge repeated variables, scale the row, and keep the rhs ≥ 0.
    const coef = new Map<number, number>()
    for (const [j, a] of c.terms) if (a !== 0) coef.set(j, (coef.get(j) ?? 0) + a)
    const max = Math.max(0, ...[...coef.values()].map(Math.abs))
    const scale = max > 0 ? 1 / max : 1
    let op = c.op
    // Relax inequalities a little, each by a different amount (see above).
    const relax = op === '=' ? 0 : PERTURB * big * (1 + ((i * 0.6180339887) % 1))
    let rhs = (c.rhs + (op === '<=' ? relax : -relax)) * scale
    let sign = scale
    if (rhs < 0) {
      sign = -sign
      rhs = -rhs
      op = op === '<=' ? '>=' : op === '>=' ? '<=' : '='
    }
    return { coef: [...coef].map(([j, a]) => [j, a * sign] as [number, number]), op, rhs, exact: c.rhs * sign }
  })
  const m = rows.length

  // Columns: the variables, a slack or surplus per inequality, an artificial
  // per row that has no slack to start the basis with.
  let col = n
  const slackOf = rows.map((r) => (r.op === '=' ? -1 : col++))
  const artOf = rows.map((r) => (r.op === '<=' ? -1 : col++))
  const width = col
  const firstArt = n + rows.filter((r) => r.op !== '=').length
  const t: Float64Array[] = rows.map((r, i) => {
    const row = new Float64Array(width + 1)
    for (const [j, a] of r.coef) row[j] = a
    if (slackOf[i] >= 0) row[slackOf[i]] = r.op === '<=' ? 1 : -1
    if (artOf[i] >= 0) row[artOf[i]] = 1
    row[width] = r.rhs
    return row
  })
  const basis = rows.map((_, i) => (artOf[i] >= 0 ? artOf[i] : slackOf[i]))

  const pivot = (r: number, c: number) => {
    const pr = t[r]
    const p = pr[c]
    for (let j = 0; j <= width; j++) pr[j] /= p
    for (let i = 0; i < m; i++) {
      if (i === r) continue
      const row = t[i]
      const f = row[c]
      if (f === 0) continue
      for (let j = 0; j <= width; j++) row[j] -= f * pr[j]
      row[c] = 0
    }
    basis[r] = c
  }

  /** Reduced costs for `cost`, given the current basis; last entry is −value. */
  const reduced = (cost: (j: number) => number) => {
    const d = new Float64Array(width + 1)
    for (let j = 0; j < width; j++) d[j] = cost(j)
    for (let i = 0; i < m; i++) {
      const cb = cost(basis[i])
      if (cb === 0) continue
      const row = t[i]
      for (let j = 0; j <= width; j++) d[j] -= cb * row[j]
    }
    return d
  }

  /** Simplex iterations; `allowed` limits which columns may enter. */
  const run = (d: Float64Array, allowed: (j: number) => boolean): 'optimal' | 'unbounded' => {
    let degenerate = 0
    for (let iter = 0; iter < MAX_PIVOTS; iter++) {
      let enter = -1
      if (degenerate < DEGENERATE_RUN) {
        let best = -TOL
        for (let j = 0; j < width; j++) if (d[j] < best && allowed(j)) (best = d[j]), (enter = j)
      } else {
        for (let j = 0; j < width; j++) if (d[j] < -TOL && allowed(j)) { enter = j; break }
      }
      if (enter < 0) return 'optimal'
      let leave = -1
      let ratio = Infinity
      for (let i = 0; i < m; i++) {
        const a = t[i][enter]
        if (a <= TOL) continue
        const q = t[i][width] / a
        if (q < ratio - TOL || (q <= ratio + TOL && leave >= 0 && a > t[leave][enter])) (ratio = q), (leave = i)
      }
      if (leave < 0) return 'unbounded'
      degenerate = ratio <= TOL ? degenerate + 1 : 0
      pivot(leave, enter)
      const f = d[enter]
      const pr = t[leave]
      for (let j = 0; j <= width; j++) d[j] -= f * pr[j]
    }
    throw new Error('LP did not finish')
  }

  // Phase 1: drive the artificial variables to zero.
  if (width > firstArt) {
    const d = reduced((j) => (j >= firstArt ? 1 : 0))
    run(d, () => true)
    const infeasibility = rows.reduce((s, _, i) => s + (basis[i] >= firstArt ? t[i][width] : 0), 0)
    if (infeasibility > 1e-7 * Math.max(1, ...rows.map((r) => r.rhs))) return { status: 'infeasible' }
    // Pivot leftover (zero) artificials out of the basis where possible; a
    // row with no other entry is redundant and stays as it is.
    for (let i = 0; i < m; i++) {
      if (basis[i] < firstArt) continue
      let c = -1
      for (let j = 0; j < firstArt; j++) if (Math.abs(t[i][j]) > 1e-7) { c = j; break }
      if (c >= 0) pivot(i, c)
    }
  }

  // Phase 2: the real objective, artificials kept out.
  const cost = (j: number) => (j < n ? problem.objective[j] ?? 0 : 0)
  const d = reduced(cost)
  if (run(d, (j) => j < firstArt) === 'unbounded') return { status: 'unbounded' }
  // Undo the relaxation: the same basis with the exact right-hand sides. The
  // starting basis columns (+1 each) now hold the basis inverse.
  const start = rows.map((_, i) => (artOf[i] >= 0 ? artOf[i] : slackOf[i]))
  const x = new Array<number>(n).fill(0)
  for (let i = 0; i < m; i++) {
    if (basis[i] >= n) continue
    let v = 0
    for (let k = 0; k < m; k++) v += t[i][start[k]] * rows[k].exact
    x[basis[i]] = v > TOL * big ? v : 0
  }
  return { status: 'optimal', x, value: x.reduce((s, v, j) => s + v * cost(j), 0) }
}
