// Recipes compared at a node's rate: what each alternate would take to make
// what the node makes now. The recipe picker shows these so choosing an
// alternate is a matter of reading numbers (90 screws: 22.5 rods vs 1.7 steel
// beams). Each option is sized exactly as the solver sizes a flexible group
// after the switch (setRecipe keeps the machine, clock and Somersloops when
// they fit), so the numbers match what the node shows once it's picked.

import type { Catalog, Machine, Recipe } from '../catalog'
import { generatorOf, recipeItem } from './edit'
import { groupPowerMw, machineSetup, machinesFor, recipeFlows } from './rates'
import type { MachineSetup, NodeFlows } from './rates'
import type { NodeResult } from './solve'
import type { MachineMode, RecipeNode } from './types'

export interface RecipeAtRate {
  machine: Machine
  setup: MachineSetup
  flows: NodeFlows
  powerMw: number
}

/**
 * The rate options are compared at: the node's main product per minute, or a
 * generator group's machines (every fuel makes the same MW per generator).
 * Undefined when the node makes nothing, so there's nothing to compare.
 */
export function nodeRate(catalog: Catalog, node: RecipeNode, res: NodeResult | undefined): number | undefined {
  const recipe = catalog.recipes.get(node.recipe)
  if (!recipe || !res || res.activity <= 1e-9) return undefined
  if (generatorOf(catalog, recipe)) return res.activity
  const item = recipeItem(catalog, recipe)
  const produced = res.outputs.find((p) => p.item === item)?.produced ?? 0
  return produced > 1e-9 ? produced : undefined
}

/** `recipe` in place of the node's, sized to make `rate` (see nodeRate). */
export function recipeAtRate(catalog: Catalog, node: RecipeNode, recipe: Recipe, rate: number, mode: MachineMode): RecipeAtRate | undefined {
  const machine = catalog.machines.get(recipe.machines.includes(node.machine) ? node.machine : recipe.machines[0])
  if (!machine) return undefined
  const sloops = Math.min(node.sloops, machine.amplifier?.slots ?? 0)
  const item = recipeItem(catalog, recipe)
  const throughput = machine.generation ? rate : item ? machinesFor(recipe, machine, item, rate, sloops) : undefined
  if (throughput === undefined) return undefined
  const setup = machineSetup(machine, throughput, mode, { clock: node.clock })
  return {
    machine,
    setup,
    flows: recipeFlows(recipe, machine, setup.count, setup.clock, sloops),
    powerMw: groupPowerMw(machine, setup.count, setup.clock, sloops, recipe),
  }
}
