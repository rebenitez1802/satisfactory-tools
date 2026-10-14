import { createContext, useContext } from 'react'
import type { Catalog, ItemId, RecipeId } from '../../catalog'
import type { PlanNode, PlanSettings, SolveResult } from '../../planner'
import type { EdgeStyle } from './storage'

/** What node and edge components need, without threading it through React Flow data. */
export interface PlannerContextValue {
  catalog: Catalog
  result: SolveResult
  settings: PlanSettings
  updateNode: (id: string, patch: Partial<PlanNode>) => void
  /** Build checklist: mark nodes done with the machines they need now, or clear the mark. */
  markDone: (ids: string[], done: boolean) => void
  openSplit: (nodeId: string, item: ItemId) => void
  /** Locked alternates are left out of pickers. */
  isRecipeHidden: (id: string) => boolean
  edgeStyle: EdgeStyle
  /** Options for ⚡ Build chain: remembered recipes and whether to reuse nodes. */
  build: { preferred: Readonly<Record<ItemId, RecipeId>>; reuse: boolean }
  /** Remember the recipe the player picked for an item, for the next ⚡ Build chain. */
  rememberRecipe: (item: ItemId, recipe: RecipeId) => void
}

export const PlannerContext = createContext<PlannerContextValue | null>(null)

export function usePlanner(): PlannerContextValue {
  const ctx = useContext(PlannerContext)
  if (!ctx) throw new Error('usePlanner outside PlannerContext')
  return ctx
}
