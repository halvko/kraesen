import { describe, expect, it } from 'vitest'
import { addLookups, findLookup, type FoodLookup, lookupFits, normalizeQuery, sameMacros, toNonNegative, withTypedMacros } from './types'

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
  })

  it('treats a decimal comma and point alike, and keeps %', () => {
    expect(normalizeQuery('Skyr 0,2%')).toBe(normalizeQuery('skyr 0.2%'))
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

describe('looked-up foods', () => {
  const lookup: FoodLookup = { key: 'tomater', query: 'Tomater', per100: { protein: 0.7, carbs: 2.9, fat: 0.2, kcal: 18 }, source: { name: 'Frida' }, createdAt: 1 }
  const typed = { protein: 5, carbs: 2.9, fat: 0.2, kcal: 33 }

  it('fits the form only while the name still matches', () => {
    expect(lookupFits(' TOMATER ', lookup)).toBe(true)
    expect(lookupFits('agurk', lookup)).toBe(false)
  })

  it('drops the source when the macros are typed by hand', () => {
    const food = { per100: lookup.per100, source: 'lookup' as const, sourceRef: lookup.source }
    expect(withTypedMacros(food, typed)).toEqual({ per100: typed, source: 'custom', sourceRef: undefined })
  })

  it('keeps the source of a scanned food when its macros are typed', () => {
    const food = { per100: lookup.per100, source: 'openfoodfacts' as const }
    expect(withTypedMacros(food, typed)).toEqual({ per100: typed, source: 'openfoodfacts' })
  })
})
