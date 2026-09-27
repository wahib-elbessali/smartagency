import { describe, expect, it } from 'vitest'
import { SCREENS } from './screens'

describe('SCREENS', () => {
  /* Counter staffing once reused Employee presence's icon under another
     import name. Two screens that measure different things must not look
     like one in the navigation. */
  it('gives every screen its own icon', () => {
    const icons = SCREENS.map((screen) => screen.icon)
    expect(new Set(icons).size).toBe(icons.length)
  })
})
