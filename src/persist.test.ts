import { describe, expect, it } from 'vitest'
import { exportJson, importJson, normalize } from './persist'
import { type AppState, emptyState } from './types'

const sample = (): AppState => ({
  ...emptyState(),
  profile: { name: 'Erik', dailyGoals: { protein: 150, carbs: 200, fat: 70, kcal: 2050 } },
  settings: { apiKey: 'sk-ant-secret', model: 'claude-opus-5-5' },
  wares: [
    {
      id: 'w1',
      name: 'Kale',
      source: 'custom',
      per100: { protein: 4.3, carbs: 4.4, fat: 0.9, kcal: 49 },
      list: 'have',
      status: 'frozen',
      createdAt: 1,
    },
  ],
  recipes: [
    {
      id: 'r1',
      title: 'Kale soup',
      summary: 'Green.',
      ingredients: [{ wareId: 'w1', name: 'Kale', grams: 200, fromBuyList: false }],
      extras: ['salt'],
      steps: ['Boil.'],
      totals: { protein: 8.6, carbs: 8.8, fat: 1.8, kcal: 98 },
      target: { protein: 10, carbs: 10, fat: 2, kcal: 100 },
      createdAt: 2,
    },
  ],
})

describe('export and import', () => {
  it('round-trips wares, recipes and goals, never exports the key, and keeps the key on this device', () => {
    const text = exportJson(sample())
    expect(text).not.toContain('sk-ant-secret')
    const current = { ...emptyState(), settings: { apiKey: 'sk-ant-mine', model: 'claude-sonnet-5-5' } }
    const next = importJson(text, current)
    expect(next.settings.apiKey).toBe('sk-ant-mine')
    expect(next.wares).toEqual(sample().wares)
    expect(next.recipes).toEqual(sample().recipes)
    expect(next.profile).toEqual(sample().profile)
  })

  it('rejects files that are not JSON or not an export', () => {
    expect(() => importJson('{oops', emptyState())).toThrow('not valid JSON')
    expect(() => importJson('{"hello": 1}', emptyState())).toThrow('does not look like a Kraesen export')
    expect(() => importJson('[]', emptyState())).toThrow('does not look like a Kraesen export')
  })
})

describe('normalize', () => {
  it('repairs wares with missing or bad fields and drops ones without id or name', () => {
    const s = normalize({
      wares: [
        { id: 'a', name: 'Egg' },
        { id: 'b', name: 'Oats', per100: { protein: '13', carbs: -5, fat: 'x' }, list: 'catalog', status: 'weird' },
        { name: 'no id' },
        null,
      ],
    })
    expect(s.wares).toHaveLength(2)
    expect(s.wares[0]).toMatchObject({ per100: { protein: 0, carbs: 0, fat: 0, kcal: 0 }, list: 'neither', status: 'available', source: 'custom' })
    expect(s.wares[1]).toMatchObject({ per100: { protein: 13, carbs: 0, fat: 0, kcal: 0 }, list: 'neither', status: 'available' })
  })

  it('drops recipes without ingredients and cleans non-string steps', () => {
    const s = normalize({
      recipes: [
        { id: 'r', title: 'T' },
        { id: 'r2', title: 'T2', ingredients: [{ name: 'Kale', grams: 10 }, { grams: 5 }], steps: ['a', { text: 'b' }] },
      ],
    })
    expect(s.recipes).toHaveLength(1)
    expect(s.recipes[0].ingredients).toEqual([{ wareId: '', name: 'Kale', grams: 10, fromBuyList: false }])
    expect(s.recipes[0].steps).toEqual(['a'])
  })

  it('ignores a profile without goals', () => {
    expect(normalize({ profile: {} }).profile).toBeNull()
  })
})
