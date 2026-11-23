import { describe, expect, it } from 'vitest'
import { sameMacros, toNonNegative } from './types'

describe('toNonNegative', () => {
  it('accepts finite numbers ≥ 0 and numeric strings, and rejects everything else', () => {
    expect([0, 12.5, '3', ' 7 '].map(toNonNegative)).toEqual([0, 12.5, 3, 7])
    expect([-1, '-1', '', 'x', '5 g', NaN, Infinity, null, undefined, {}].map(toNonNegative)).toEqual(Array(10).fill(undefined))
  })
})

describe('sameMacros', () => {
  it('is true only when every macro matches', () => {
    const m = { protein: 30, carbs: 50, fat: 10, kcal: 410 }
    expect(sameMacros(m, { ...m })).toBe(true)
    expect(sameMacros(m, { ...m, kcal: 400 })).toBe(false)
  })
})
