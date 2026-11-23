import { describe, expect, it } from 'vitest'
import { exportJson, importJson, normalize } from './persist'
import { type AppState, emptyState } from './types'

const sample = (): AppState => ({
  ...emptyState(),
  profile: {
    name: 'Erik',
    dailyGoals: { protein: 150, carbs: 200, fat: 70, kcal: 2050 },
    foodRules: 'pescatarian',
    staples: ['salt', 'cumin'],
  },
  settings: { apiKey: 'sk-ant-secret', model: 'claude-opus-5-5', rulesAnswered: true },
  wares: [
    {
      id: 'w1',
      name: 'Kale',
      source: 'custom',
      per100: { protein: 4.3, carbs: 4.4, fat: 0.9, kcal: 49 },
      stock: 'freezer',
      createdAt: 1,
    },
  ],
  recipes: [
    {
      id: 'r1',
      title: 'Kale soup',
      summary: 'Green.',
      ingredients: [{ wareId: 'w1', name: 'Kale', grams: 200, toBuy: false }],
      extras: ['salt'],
      steps: ['Boil.'],
      totals: { protein: 8.6, carbs: 8.8, fat: 1.8, kcal: 98 },
      target: { protein: 10, carbs: 10, fat: 2, kcal: 100 },
      createdAt: 2,
    },
  ],
})

describe('export and import', () => {
  it('round-trips foods, recipes, goals and staples, never exports the key, and keeps the key on this device', () => {
    const text = exportJson(sample())
    expect(text).not.toContain('sk-ant-secret')
    const current = { ...emptyState(), settings: { apiKey: 'sk-ant-mine', model: 'claude-sonnet-5-5', rulesAnswered: false } }
    const next = importJson(text, current)
    expect(next.settings.apiKey).toBe('sk-ant-mine')
    expect(next.settings.rulesAnswered).toBe(true)
    expect(next.wares).toEqual(sample().wares)
    expect(next.recipes).toEqual(sample().recipes)
    expect(next.profile).toEqual(sample().profile)
    expect(next.upgradeNotice).toBe(false)
  })

  it('never exports the upgrade notice, and shows it after importing a version 1 backup', () => {
    expect(exportJson({ ...sample(), upgradeNotice: true })).not.toContain('upgradeNotice')
    const v1 = JSON.stringify({ version: 1, wares: [{ id: 'a', name: 'Cod', list: 'have', status: 'available' }] })
    const next = importJson(v1, emptyState())
    expect(next.upgradeNotice).toBe(true)
    expect(next.wares[0].stock).toBe('home')
  })

  it('keeps a notice not yet dismissed on this device when importing a version 2 backup', () => {
    const next = importJson(exportJson(sample()), { ...emptyState(), upgradeNotice: true })
    expect(next.upgradeNotice).toBe(true)
  })

  it('rejects files that are not JSON or not an export', () => {
    expect(() => importJson('{oops', emptyState())).toThrow('not valid JSON')
    expect(() => importJson('{"hello": 1}', emptyState())).toThrow('does not look like a Kraesen export')
    expect(() => importJson('[]', emptyState())).toThrow('does not look like a Kraesen export')
  })
})

describe('upgrade from version 1', () => {
  const v1Ware = (list: string, status: string, notes?: string) => ({ id: `${list}-${status}`, name: 'X', list, status, notes })

  it('maps each old list and status pair to one stock value, offering less when unclear', () => {
    const pairs: [string, string, string][] = [
      ['have', 'available', 'home'],
      ['have', 'frozen', 'freezer'],
      ['have', 'out', 'off'],
      ['buy', 'available', 'shop'],
      ['buy', 'frozen', 'shop'],
      ['buy', 'out', 'off'],
      ['neither', 'available', 'off'],
      ['catalog', 'frozen', 'off'],
    ]
    const s = normalize({ version: 1, wares: pairs.map(([l, st]) => v1Ware(l, st)) })
    expect(s.wares.map((w) => w.stock)).toEqual(pairs.map((p) => p[2]))
  })

  it('keeps "frozen" in the notes of a shop food that was frozen', () => {
    const s = normalize({ version: 1, wares: [v1Ware('buy', 'frozen'), v1Ware('buy', 'frozen', 'big bag')] })
    expect(s.wares.map((w) => w.notes)).toEqual(['frozen', 'frozen; big bag'])
  })

  it('renames fromBuyList to toBuy in saved recipes', () => {
    const s = normalize({ recipes: [{ id: 'r', title: 'T', ingredients: [{ name: 'Feta', grams: 30, fromBuyList: true }] }] })
    expect(s.recipes[0].ingredients[0].toBuy).toBe(true)
  })

  it('shows the upgrade notice once there were foods, and treats food rules as answered for an existing profile', () => {
    const s = normalize({ version: 1, profile: { dailyGoals: {} }, wares: [v1Ware('have', 'available')] })
    expect(s.version).toBe(2)
    expect(s.upgradeNotice).toBe(true)
    expect(s.settings.rulesAnswered).toBe(true)
    expect(s.profile?.staples).toEqual([])
    expect(normalize({ version: 1 }).upgradeNotice).toBe(false)
  })

  it('does not bring the notice back for data already on version 2', () => {
    const s = normalize({ version: 2, profile: { dailyGoals: {} }, wares: [v1Ware('have', 'available')] })
    expect(s.upgradeNotice).toBe(false)
    expect(s.settings.rulesAnswered).toBe(false)
  })
})

describe('normalize', () => {
  it('repairs foods with missing or bad fields and drops ones without id or name', () => {
    const s = normalize({
      version: 2,
      wares: [
        { id: 'a', name: 'Egg', stock: 'home' },
        { id: 'b', name: 'Oats', per100: { protein: '13', carbs: -5, fat: 'x' }, stock: 'weird' },
        { name: 'no id' },
        null,
      ],
    })
    expect(s.wares).toHaveLength(2)
    expect(s.wares[0]).toMatchObject({ per100: { protein: 0, carbs: 0, fat: 0, kcal: 0 }, stock: 'home', source: 'custom' })
    expect(s.wares[1]).toMatchObject({ per100: { protein: 13, carbs: 0, fat: 0, kcal: 0 }, stock: 'off' })
  })

  it('drops recipes without ingredients and cleans non-string steps', () => {
    const s = normalize({
      recipes: [
        { id: 'r', title: 'T' },
        { id: 'r2', title: 'T2', ingredients: [{ name: 'Kale', grams: 10 }, { grams: 5 }], steps: ['a', { text: 'b' }] },
      ],
    })
    expect(s.recipes).toHaveLength(1)
    expect(s.recipes[0].ingredients).toEqual([{ wareId: '', name: 'Kale', grams: 10, toBuy: false }])
    expect(s.recipes[0].steps).toEqual(['a'])
  })

  it('ignores a profile without goals', () => {
    expect(normalize({ profile: {} }).profile).toBeNull()
  })

  it('reads a profile saved before food rules and staples existed', () => {
    expect(normalize({ profile: { dailyGoals: { protein: 1 } } }).profile).toMatchObject({ foodRules: '', staples: [] })
  })

  it('trims food rules, and trims and de-duplicates staples', () => {
    const p = normalize({ profile: { dailyGoals: {}, foodRules: '  no sweeteners  ', staples: [' Salt', 'salt', '', 'cumin'] } }).profile
    expect(p?.foodRules).toBe('no sweeteners')
    expect(p?.staples).toEqual(['Salt', 'cumin'])
  })
})
