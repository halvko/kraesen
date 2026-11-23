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

  it('respects bounds', () => {
    const sol = solvePortions([{ ware: chicken, minGrams: 50, maxGrams: 80 }, { ware: rice, maxGrams: 40 }], {
      protein: 100,
      carbs: 200,
      fat: 20,
      kcal: 1500,
    })
    const grams = Object.fromEntries(sol.portions.map((p) => [p.ware.id, p.grams]))
    expect(grams.chicken).toBeLessThanOrEqual(80)
    expect(grams.chicken).toBeGreaterThanOrEqual(50)
    expect(grams.rice).toBeLessThanOrEqual(40)
  })

  it('is deterministic', () => {
    const req = [{ ware: chicken }, { ware: rice }, { ware: oil, maxGrams: 20 }]
    const target = { protein: 40, carbs: 60, fat: 15, kcal: 550 }
    expect(solvePortions(req, target)).toEqual(solvePortions(req, target))
  })

  it('handles zero-macro wares without blowing up', () => {
    const water = ware('water', 0, 0, 0, 0)
    const sol = solvePortions([{ ware: water, minGrams: 100, maxGrams: 300 }, { ware: chicken }], {
      protein: 30,
      carbs: 0,
      fat: 3,
      kcal: 160,
    })
    expect(sol.portions.every((p) => Number.isFinite(p.grams))).toBe(true)
  })
})
