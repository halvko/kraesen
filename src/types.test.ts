import { describe, expect, it } from 'vitest'
import { addLookups, findLookup, type FoodLookup, normalizeQuery, sameMacros, toNonNegative } from './types'

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

describe('normalizeQuery', () => {
  it('ignores case, spacing and punctuation, and keeps Danish letters and numbers', () => {
    expect(normalizeQuery('  Hjemmedyrkede   TOMATER! ')).toBe('hjemmedyrkede tomater')
    expect(normalizeQuery('Rød-kål, rå')).toBe('rød kål rå')
    expect(normalizeQuery('Skyr 0,2%')).toBe('skyr 0 2%')
    expect(normalizeQuery('2% mælk')).not.toBe(normalizeQuery('mælk'))
    // "å" typed as one character or as "a" plus a combining ring gives the same key.
    expect(normalizeQuery('Kål, r\u00e5')).toBe(normalizeQuery('Kål, ra\u030a'))
  })
})

describe('lookup cache', () => {
  const l = (query: string, createdAt: number): FoodLookup => ({
    key: normalizeQuery(query),
    query,
    per100: { protein: 1, carbs: 1, fat: 1, kcal: 17 },
    source: { name: 'Frida' },
    createdAt,
  })

  it('finds a lookup by a name typed differently', () => {
    expect(findLookup([l('Tomater', 1)], ' tomater!')?.createdAt).toBe(1)
    expect(findLookup([l('Tomater', 1)], 'tomat')).toBeUndefined()
  })

  it('puts new lookups first and replaces an older one for the same name', () => {
    expect(addLookups([l('kål', 1), l('Tomater', 2)], [l('tomater', 3)]).map((x) => x.createdAt)).toEqual([3, 1])
  })
})
