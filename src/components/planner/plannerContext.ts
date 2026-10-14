import { createContext, useContext } from 'react'
import type { Catalog, ItemId } from '../../catalog'
import type { PlanNode, PlanSettings, SolveResult } from '../../planner'
import type { EdgeStyle } from './storage'

/** What node and edge components need, without threading it through React Flow data. */
export interface PlannerContextValue {
  catalog: Catalog
  result: SolveResult
  settings: PlanSettings
  updateNode: (id: string, patch: Partial<PlanNode>) => void
  openSplit: (nodeId: string, item: ItemId) => void
  /** Locked alternates are left out of pickers. */
  isRecipeHidden: (id: string) => boolean
  edgeStyle: EdgeStyle
}

export const PlannerContext = createContext<PlannerContextValue | null>(null)

export function usePlanner(): PlannerContextValue {
  const ctx = useContext(PlannerContext)
  if (!ctx) throw new Error('usePlanner outside PlannerContext')
  return ctx
}
