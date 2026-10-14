import type { Plan } from '../../planner'

// Plans and preferences live in localStorage. Each plan is stored whole, keyed
// by a local id; the active one is restored on the next visit.

const PLANS_KEY = 'satisfactory-tools.planner.plans.v1'
const PREFS_KEY = 'satisfactory-tools.planner.prefs.v1'

export interface SavedPlan {
  id: string
  updatedAt: number
  plan: Plan
}

export interface PlanStore {
  activeId: string
  plans: Record<string, SavedPlan>
  /** Tab order. */
  order: string[]
}

export type EdgeStyle = 'step' | 'straight' | 'curved'

export interface Prefs {
  /** Alternate recipes the player hasn't unlocked; hidden from pickers. */
  lockedAlternates: string[]
  /** How belts are drawn: right-angled (like the balancer), straight, or curved. */
  edgeStyle: EdgeStyle
  /** Recipe the player last picked per item; ⚡ Build chain uses it first. */
  preferredRecipes: Record<string, string>
  /** ⚡ Build chain connects to nodes already making an item instead of adding new ones. */
  buildReuse: boolean
  /** The recipe dropdown compares options at the node's rate rather than per machine. */
  compareAtRate: boolean
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or unavailable (private mode): keep working in memory.
  }
}

export function loadStore(): PlanStore | null {
  const store = read<PlanStore>(PLANS_KEY)
  if (!store || !store.plans || !store.plans[store.activeId]) return null
  // Older saves had no tab order: oldest first. Drop ids whose plan is gone.
  const known = (store.order ?? []).filter((id) => store.plans[id])
  const missing = Object.values(store.plans)
    .filter((p) => !known.includes(p.id))
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .map((p) => p.id)
  return { ...store, order: [...known, ...missing] }
}

export function saveStore(store: PlanStore) {
  write(PLANS_KEY, store)
}

export function loadPrefs(): Prefs {
  return { lockedAlternates: [], edgeStyle: 'step', preferredRecipes: {}, buildReuse: true, compareAtRate: true, ...read<Prefs>(PREFS_KEY) }
}

export function savePrefs(prefs: Prefs) {
  write(PREFS_KEY, prefs)
}

export function newPlanId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Offer the plan as a .json download. */
export function downloadPlan(plan: Plan) {
  const blob = new Blob([JSON.stringify(plan, null, 1)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${plan.name.replace(/[^\w\- ]+/g, '').trim() || 'plan'}.json`
  a.click()
  URL.revokeObjectURL(url)
}
