import { describe, expect, it } from 'vitest'
import { parsePrefs } from '../storage'

describe('parsePrefs', () => {
  it('fills in defaults', () => {
    const p = parsePrefs(null)
    expect(p.lockedRecipes).toEqual([])
    expect(p.progress).toBeUndefined()
    expect(p.optimizeFor).toBe('resources')
  })

  it('moves locked alternates over to locked recipes', () => {
    const p = parsePrefs({ lockedAlternates: ['base:Recipe_Alternate_Screw_C'], edgeStyle: 'curved' })
    expect(p.lockedRecipes).toEqual(['base:Recipe_Alternate_Screw_C'])
    expect('lockedAlternates' in p).toBe(false)
    expect(p.edgeStyle).toBe('curved')
  })

  it('keeps valid progress and drops a broken one', () => {
    expect(parsePrefs({ progress: { tier: 4, research: ['base:Research_Quartz_1_1_C'] } }).progress).toEqual({ tier: 4, research: ['base:Research_Quartz_1_1_C'] })
    expect(parsePrefs({ progress: { tier: '4' } }).progress).toBeUndefined()
  })
})
