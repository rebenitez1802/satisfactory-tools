// Game progress (roadmap #23, #24): which recipes the player can use. Pickers,
// the recipe dropdown, ⚡ Build chain and ✨ Optimize all ask through one
// `isRecipeHidden`, built here from two things the player sets:
//
// - Progress (optional; absent means everything is unlocked): the HUB tier
//   reached and the research ticked. A recipe is unlocked when any schematic
//   that unlocks it is: a milestone of that tier or lower, ticked research,
//   or an alternate whose required schematics are all unlocked (the hard
//   drive can be found). A recipe no schematic unlocks is always there.
// - Locks by hand, on top: any recipe, standard or alternate. For alternates
//   this is "I haven't found that hard drive".
//
// It's about the player's save, not one plan, so it lives in the prefs.

import type { Catalog, RecipeId, Schematic, SchematicId } from '../catalog'

export interface GameProgress {
  /** Highest HUB tier reached: its milestones and all lower ones are unlocked. */
  tier: number
  /** Research (MAM) the player has done. */
  research: SchematicId[]
}

/** Why a recipe can't be used, or 'ok'. */
export type RecipeAccess =
  | { state: 'ok' }
  | { state: 'locked' }
  /** Not unlocked yet; `needs` is the shortest way there (milestones and research not done yet). */
  | { state: 'progress'; needs: Schematic[] }

/** Schematics unlocked at this progress (all of them when there is none). */
export function unlockedSchematics(catalog: Catalog, progress: GameProgress | undefined): Set<SchematicId> {
  const all = [...catalog.schematics.values()]
  if (!progress) return new Set(all.map((s) => s.id))
  const research = new Set(progress.research)
  const memo = new Map<SchematicId, boolean>()
  const unlocked = (s: Schematic): boolean => {
    const known = memo.get(s.id)
    if (known !== undefined) return known
    memo.set(s.id, false) // a requirement cycle unlocks nothing
    const ok =
      s.kind === 'milestone'
        ? s.tier <= progress.tier
        : s.kind === 'research'
          ? research.has(s.id)
          : (s.requires ?? []).every((id) => {
              const req = catalog.schematics.get(id)
              return !req || unlocked(req)
            })
    memo.set(s.id, ok)
    return ok
  }
  return new Set(all.filter(unlocked).map((s) => s.id))
}

/** Whether each recipe can be used, and why not. */
export function recipeAccess(
  catalog: Catalog,
  progress: GameProgress | undefined,
  locked: ReadonlySet<RecipeId>,
): (id: RecipeId) => RecipeAccess {
  const unlocked = unlockedSchematics(catalog, progress)
  // What's still missing for a schematic: itself, or an alternate's requirements.
  const missing = (s: Schematic, seen = new Set<SchematicId>()): Schematic[] => {
    if (unlocked.has(s.id) || seen.has(s.id)) return []
    seen.add(s.id)
    if (s.kind !== 'alternate') return [s]
    return [...new Set((s.requires ?? []).flatMap((id) => (catalog.schematics.has(id) ? missing(catalog.schematics.get(id)!, seen) : [])))]
  }
  const effort = (needs: Schematic[]) => needs.length * 100 + Math.max(0, ...needs.map((s) => s.tier))
  return (id) => {
    const by = (catalog.schematicsFor.get(id) ?? []).flatMap((s) => catalog.schematics.get(s) ?? [])
    if (by.length && !by.some((s) => unlocked.has(s.id))) {
      const needs = by.map((s) => missing(s)).sort((a, b) => effort(a) - effort(b))[0]
      return { state: 'progress', needs }
    }
    return locked.has(id) ? { state: 'locked' } : { state: 'ok' }
  }
}

/** HUB tiers the loaded milestones span, lowest first. */
export function hubTiers(catalog: Catalog): number[] {
  return [...new Set([...catalog.schematics.values()].filter((s) => s.kind === 'milestone').map((s) => s.tier))].sort((a, b) => a - b)
}

/** What a recipe still needs, in words: "Tier 5 (Oil Processing)", "Research: Turbofuel". */
export function needsLabel(needs: Schematic[]): string {
  return needs.map((s) => (s.kind === 'milestone' ? `Tier ${s.tier} (${s.name})` : `Research: ${s.name}`)).join(' + ')
}
