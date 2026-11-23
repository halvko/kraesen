import { MACRO_KEYS, type MacroKey, type Macros, type Ware, zeroMacros } from './types'

export interface PortionRequest {
  ware: Ware
  minGrams?: number
  maxGrams?: number
  fixedGrams?: number
}

export interface PortionResult {
  ware: Ware
  grams: number
}

export interface Solution {
  portions: PortionResult[]
  totals: Macros
  target: Macros
  /** Actual minus target, per macro. */
  deviation: Macros
  /** Deviation relative to target, per macro (0.1 = 10 % over). */
  relativeDeviation: Macros
  /** Largest absolute relative deviation across macros. */
  worstRelative: number
}

export const DEFAULT_MAX_GRAMS = 600

/**
 * Floors used when a target is tiny, so a 2 g fat target does not make a 1 g miss
 * look like a 50 % error and dominate the fit.
 */
const SCALE_FLOOR: Macros = { protein: 5, carbs: 5, fat: 3, kcal: 50 }

export function macrosFor(ware: Ware, grams: number): Macros {
  const out = zeroMacros()
  for (const k of MACRO_KEYS) out[k] = (ware.per100[k] * grams) / 100
  return out
}

export function sumMacros(portions: { ware: Ware; grams: number }[]): Macros {
  const total = zeroMacros()
  for (const p of portions) {
    const m = macrosFor(p.ware, p.grams)
    for (const k of MACRO_KEYS) total[k] += m[k]
  }
  return total
}

function roundStep(grams: number, lo: number, hi: number): number {
  // An amount the fit pushed against a bound stays exactly on it: rounding a
  // 32 g cap to 30 g would give away part of the fit for nothing.
  if (Math.abs(grams - lo) < 1e-6) return lo
  if (Math.abs(grams - hi) < 1e-6) return hi
  const step = grams >= 30 ? 5 : 1
  const r = Math.round(grams / step) * step
  return Math.min(hi, Math.max(lo, r))
}

/**
 * Picks grams within each ingredient's bounds (or exactly fixedGrams) that minimise
 * the squared relative error to the target over protein, carbs, fat and kcal.
 * Grams are rounded to 1 g below 30 g and to 5 g from 30 g, staying within bounds.
 * The same input always gives the same grams.
 */
export function solvePortions(requests: PortionRequest[], target: Macros): Solution {
  const n = requests.length
  const lo: number[] = []
  const hi: number[] = []
  for (const r of requests) {
    if (r.fixedGrams !== undefined) {
      lo.push(r.fixedGrams)
      hi.push(r.fixedGrams)
    } else {
      const min = Math.max(0, r.minGrams ?? 0)
      const max = Math.max(min, r.maxGrams ?? DEFAULT_MAX_GRAMS)
      lo.push(min)
      hi.push(max)
    }
  }

  // Bounded coordinate descent on a convex quadratic: each step minimises exactly
  // along one ingredient, clamped to its bounds.
  // A[m][i]: macro m per gram of ingredient i, weighted by 1/scale_m.
  const weights = MACRO_KEYS.map((k) => 1 / Math.max(Math.abs(target[k]), SCALE_FLOOR[k]))
  const A = MACRO_KEYS.map((k, m) => requests.map((r) => (r.ware.per100[k] / 100) * weights[m]))
  const t = MACRO_KEYS.map((k, m) => target[k] * weights[m])

  // Start in the middle of a sensible range so ties resolve the same way every time.
  const x = lo.map((l, i) => Math.min(hi[i], Math.max(l, (l + Math.min(hi[i], 200)) / 2)))
  const ridge = 1e-9

  const r = t.map((tm, m) => A[m].reduce((s, a, i) => s + a * x[i], 0) - tm)
  for (let sweep = 0; sweep < 5000; sweep++) {
    let maxChange = 0
    for (let i = 0; i < n; i++) {
      let g = ridge * x[i]
      let h = ridge
      for (let m = 0; m < A.length; m++) {
        g += A[m][i] * r[m]
        h += A[m][i] * A[m][i]
      }
      const next = Math.min(hi[i], Math.max(lo[i], x[i] - g / h))
      const delta = next - x[i]
      if (delta !== 0) {
        for (let m = 0; m < A.length; m++) r[m] += A[m][i] * delta
        x[i] = next
        maxChange = Math.max(maxChange, Math.abs(delta))
      }
    }
    if (maxChange < 1e-7) break
  }

  const portions: PortionResult[] = requests.map((req, i) => ({
    ware: req.ware,
    grams: roundStep(x[i], lo[i], hi[i]),
  }))
  return evaluate(portions, target)
}

/** How far actual is from target for one macro, relative to the target (0.1 = 10 % over). */
export function relativeDeviation(k: MacroKey, actual: number, target: number): number {
  return (actual - target) / Math.max(Math.abs(target), SCALE_FLOOR[k])
}

export function evaluate(portions: PortionResult[], target: Macros): Solution {
  const totals = sumMacros(portions)
  const deviation = zeroMacros()
  const relative = zeroMacros()
  let worstRelative = 0
  for (const k of MACRO_KEYS) {
    deviation[k] = totals[k] - target[k]
    relative[k] = relativeDeviation(k, totals[k], target[k])
    worstRelative = Math.max(worstRelative, Math.abs(relative[k]))
  }
  return { portions, totals, target, deviation, relativeDeviation: relative, worstRelative }
}
