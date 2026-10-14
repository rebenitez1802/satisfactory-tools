// A production plan: the user's graph. It only references catalog content by
// id, so the same plan works with whichever packs are loaded. If a pack goes
// missing, nodes pointing at its content stay in the plan and render as
// unresolved instead of being dropped.
//
// Sizing follows targets and limits (docs/production-planner.md): goals and
// generator groups carry a target, any other node may be `limited`, and
// everything else is flexible and sized by the solver.

import type { ItemId, MachineId, PurityId, RecipeId, TransportTierId } from '../catalog'

/**
 * How machine counts are presented:
 *   - fractional: e.g. 2.4 Smelters at the node's clock
 *   - underclock: rounded up to whole machines sharing one clock (3 at 80%)
 */
export type MachineMode = 'fractional' | 'underclock'

export interface PlanSettings {
  machineMode: MachineMode
  /** Belt and pipe marks used for over-capacity warnings. */
  beltTier?: TransportTierId
  pipeTier?: TransportTierId
}

interface PlanNodeBase {
  id: string
  position: { x: number; y: number }
  label?: string
}

/** A group of identical machines running one recipe. */
export interface RecipeNode extends PlanNodeBase {
  kind: 'recipe'
  recipe: RecipeId
  machine: MachineId
  /**
   * True: `count` machines at `clock` is a hard limit ("I have 4 Constructors").
   * False: the solver derives the count; `clock` is the preferred clock.
   */
  limited: boolean
  /** Machine count, used when limited; may be fractional. */
  count: number
  /** Clock speed, 1 = 100%. */
  clock: number
  /** Somersloops per machine. */
  sloops: number
  /**
   * Generator groups only: a 🎯 power target in MW, or Max to burn all the
   * fuel the plan can supply. Either makes the group an anchor, like a goal.
   * Absent: flexible, sized by demand for its waste.
   */
  power?: number | 'max'
}

/** Extractors on a group of resource sites (nodes, or satellites of one well). */
export interface ExtractorNode extends PlanNodeBase {
  kind: 'extractor'
  machine: MachineId
  resource: ItemId
  /** True: the sites' output at `clock` is a hard limit. */
  limited: boolean
  /** One extractor per site. Purity is ignored by extractors that don't use it. */
  sites: { purity: PurityId; count: number }[]
  clock: number
  /**
   * Somersloops per extractor. Vanilla extractors have no slots, so this stays
   * 0 and has no effect; modded extractors that declare an amplifier use it.
   */
  sloops: number
}

/** Items arriving from outside the plan (another factory, hand-gathered…). */
export interface SupplyNode extends PlanNodeBase {
  kind: 'supply'
  item: ItemId
  /** True: `perMin` is all that's available. False: shows what must be brought in. */
  limited: boolean
  perMin: number
}

/** What the plan should deliver: a rate, or as much as the limits allow. */
export interface GoalNode extends PlanNodeBase {
  kind: 'goal'
  item: ItemId
  target: number | 'max'
}

export type PlanNode = RecipeNode | ExtractorNode | SupplyNode | GoalNode

/** A belt or pipe carrying one item from an output port to an input port. */
export interface PlanEdge {
  id: string
  source: string
  target: string
  item: ItemId
  /**
   * When several edges feed the same input, demand is split by share
   * (default 1 each, i.e. evenly).
   */
  share?: number
}

export interface Plan {
  schemaVersion: 1
  name: string
  /** Packs the plan was built with. */
  packs: { id: string; version: string }[]
  settings: PlanSettings
  nodes: PlanNode[]
  edges: PlanEdge[]
}
