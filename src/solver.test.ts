import { describe, expect, it } from 'vitest'
import { solvePortions } from './solver'
import type { Ware } from './types'

const ware = (id: string, protein: number, carbs: number, fat: number, kcal: number): Ware => ({
  id,
  name: id,
  source: 'custom',
  per100: { protein, carbs, fat, kcal },
  list: 'have',
  status: 'available',
  createdAt: 0,
})

const chicken = ware('chicken', 31, 0, 3.6, 165)
const rice = ware('rice', 7, 78, 0.6, 350)
const oil = ware('oil', 0, 0, 100, 884)
const broccoli = ware('broccoli', 2.8, 7, 0.4, 34)

describe('solvePortions', () => {
  it('hits an achievable target closely', () => {
    // Build a target from known grams, then check the solver recovers a close fit.
    const target = { protein: 31 * 1.5 + 7 * 0.8 + 2.8, carbs: 78 * 0.8 + 7, fat: 3.6 * 1.5 + 0.6 * 0.8 + 10 + 0.4, kcal: 165 * 1.5 + 350 * 0.8 + 88.4 + 34 }
    const sol = solvePortions(
      [{ ware: chicken }, { ware: rice }, { ware: oil, maxGrams: 30 }, { ware: broccoli, fixedGrams: 100 }],
      target,
    )
    expect(sol.worstRelative).toBeLessThan(0.05)
    const grams = Object.fromEntries(sol.portions.map((p) => [p.ware.id, p.grams]))
    expect(grams.broccoli).toBe(100)
    expect(grams.chicken).toBeGreaterThan(120)
    expect(grams.chicken).toBeLessThan(180)
  })

  it('pushes against bounds when the target is out of reach, and honours fixedGrams', () => {
    const sol = solvePortions(
      [
        { ware: chicken, minGrams: 50, maxGrams: 80 },
        { ware: rice, maxGrams: 40 },
        { ware: broccoli, minGrams: 10, maxGrams: 20, fixedGrams: 150 },
      ],
      { protein: 100, carbs: 200, fat: 20, kcal: 1500 },
    )
    const grams = Object.fromEntries(sol.portions.map((p) => [p.ware.id, p.grams]))
    // The target needs far more of both, so both end at their upper bound.
    expect(grams.chicken).toBe(80)
    expect(grams.rice).toBe(40)
    // fixedGrams overrides min and max.
    expect(grams.broccoli).toBe(150)
  })

  it('treats a minimum above the maximum as a fixed amount at the minimum', () => {
    const sol = solvePortions([{ ware: rice, minGrams: 90, maxGrams: 50 }], { protein: 0, carbs: 0, fat: 0, kcal: 0 })
    expect(sol.portions[0].grams).toBe(90)
  })

  it('rounds to 1 g below 30 g and to 5 g from 30 g, without leaving the bounds', () => {
    // The exact optimum is 12.4 g of oil, which rounds to 12 g.
    const small = solvePortions([{ ware: oil }], { protein: 0, carbs: 0, fat: 12.4, kcal: 12.4 * 8.84 })
    expect(small.portions[0].grams).toBe(12)
    // The exact optimum is 137 g of chicken, which rounds to 135 g.
    const large = solvePortions([{ ware: chicken }], { protein: 31 * 1.37, carbs: 0, fat: 3.6 * 1.37, kcal: 165 * 1.37 })
    expect(large.portions[0].grams).toBe(135)
    // 300 g would fit, but the cap is 32 g, which must not round up to 35 g.
    const capped = solvePortions([{ ware: chicken, maxGrams: 32 }], { protein: 93, carbs: 0, fat: 10.8, kcal: 495 })
    expect(capped.portions[0].grams).toBe(32)
  })

  it('splits evenly between identical wares instead of piling onto one', () => {
    const twin = { ...chicken, id: 'chicken2', name: 'chicken2' }
    const sol = solvePortions([{ ware: chicken }, { ware: twin }], { protein: 62, carbs: 0, fat: 7.2, kcal: 330 })
    expect(sol.portions[0].grams).toBe(sol.portions[1].grams)
    expect(sol.portions[0].grams).toBe(100)
  })

  it('leaves a zero-macro ware at its minimum and still fits the rest', () => {
    const water = ware('water', 0, 0, 0, 0)
    const sol = solvePortions([{ ware: water, minGrams: 100, maxGrams: 300 }, { ware: chicken }], {
      protein: 30,
      carbs: 0,
      fat: 3,
      kcal: 160,
    })
    const grams = Object.fromEntries(sol.portions.map((p) => [p.ware.id, p.grams]))
    expect(grams.water).toBe(100)
    expect(grams.chicken).toBeGreaterThanOrEqual(90)
    expect(grams.chicken).toBeLessThanOrEqual(100)
  })

  it('gives finite results for an all-zero target', () => {
    const sol = solvePortions([{ ware: chicken }, { ware: rice }], { protein: 0, carbs: 0, fat: 0, kcal: 0 })
    expect(sol.portions.map((p) => p.grams)).toEqual([0, 0])
    expect(Number.isFinite(sol.worstRelative)).toBe(true)
  })
})
