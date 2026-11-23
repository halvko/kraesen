import { describe, expect, it } from 'vitest'
import { toNonNegative } from './types'

describe('toNonNegative', () => {
  it('accepts finite numbers ≥ 0 and numeric strings, and rejects everything else', () => {
    expect([0, 12.5, '3', ' 7 '].map(toNonNegative)).toEqual([0, 12.5, 3, 7])
    expect([-1, '-1', '', 'x', '5 g', NaN, Infinity, null, undefined, {}].map(toNonNegative)).toEqual(Array(10).fill(undefined))
  })
})
