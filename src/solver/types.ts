// Core graph model for load-balancer designs.
//
// The graph only ever contains the four building blocks Satisfactory gives us:
//   - source:   an input belt (1 outgoing edge, no incoming); usually one,
//               several when the balancer is fed by several belts
//   - sink:     a desired output belt (1 incoming edge, no outgoing)
//   - splitter: 1 incoming edge, 2 or 3 outgoing edges (divides evenly)
//   - merger:   2 or 3 incoming edges, 1 outgoing edge (sums)
//
// Edges are directed belts. A `feedback` edge is one that loops a belt back
// toward the input side; it carries no special runtime meaning (the simulator
// treats it like any other edge) but lets the layout and UI draw loops nicely.

export type NodeKind = 'source' | 'sink' | 'splitter' | 'merger'

export interface GNode {
  id: string
  kind: NodeKind
  /** Human-facing label, e.g. the output name or rate. */
  label?: string
  /** For sinks: the target rate this output should carry (parts/min). */
  target?: number
  /** For sinks: auto-added overflow output carrying input the user didn't assign. */
  leftover?: boolean
  /** For sources: the rate this input belt carries. Unset: the simulator's input rate. */
  rate?: number
}

export interface GEdge {
  id: string
  source: string
  target: string
  /** Steady-state flow in parts/min, filled in by the simulator. */
  flow?: number
  /** True when this belt loops back toward the input (drawn as a loop). */
  feedback?: boolean
}

export interface Graph {
  nodes: GNode[]
  edges: GEdge[]
}

export interface OutputSpec {
  /** Optional label shown on the sink, e.g. "Constructors". */
  label?: string
  /** Desired rate in parts/min. */
  rate: number
}

export interface SolveInput {
  /** Input belt rate in parts/min. With `inputs`, their total. */
  input: number
  /**
   * Several input belts, e.g. one per machine of a producing group. More
   * than one switches to packing (see multi.ts); `input` is then ignored.
   */
  inputs?: number[]
  outputs: OutputSpec[]
  /**
   * Optional belt throughput cap. A single input only warns about belts over
   * it; with several inputs, outputs above it leave on several belts.
   */
  beltMax?: number
}

export interface SolveWarning {
  kind: 'belt-over-capacity' | 'leftover' | 'info'
  message: string
  /** Edge ids this warning refers to, when applicable. */
  edgeIds?: string[]
}

export interface SolveResult {
  ok: boolean
  /** Present when ok === true. */
  graph?: Graph
  /** Reduced integer ratios r_i and their sum N. */
  ratios?: number[]
  N?: number
  /** The 3-smooth leaf count B chosen for the splitter tree. */
  leafCount?: number
  /** Number of feedback (loopback) belts, i.e. B - N. */
  loopbacks?: number
  /** Rate routed to the auto-added leftover output (0 when outputs sum to input). */
  leftover?: number
  /** Several inputs: how many there are, and how many of them had to be split. */
  inputs?: { count: number; split: number }
  warnings: SolveWarning[]
  /** Set when ok === false. */
  error?: string
}
