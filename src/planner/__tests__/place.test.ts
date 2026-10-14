import { describe, expect, it } from 'vitest'
import { placeBeside } from '../place'

describe('placeBeside', () => {
  const anchor = { x: 0, y: 0, w: 160, h: 100 }
  const size = { w: 160, h: 100 }

  it('puts producers left and consumers right, with a gap', () => {
    expect(placeBeside(anchor, 'right', size, [anchor])).toEqual({ x: 240, y: 0 })
    expect(placeBeside(anchor, 'left', size, [anchor])).toEqual({ x: -240, y: 0 })
  })

  it('steps down past nodes already there', () => {
    const taken = { x: 240, y: -20, w: 160, h: 100 }
    const below = { x: 230, y: 110, w: 170, h: 90 }
    expect(placeBeside(anchor, 'right', size, [anchor, taken, below])).toEqual({ x: 240, y: 230 })
  })
})
