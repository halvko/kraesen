import type { Macros } from './types'

export interface OffProduct {
  barcode: string
  name: string
  brand?: string
  per100: Macros
  /** True when at least one macro was missing and defaulted to 0. */
  incomplete: boolean
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : undefined
}

/**
 * Looks up a barcode in Open Food Facts (read API, no key, CORS enabled).
 * Returns null when the product is unknown or has no usable nutrition data.
 */
export async function lookupBarcode(barcode: string): Promise<OffProduct | null> {
  const code = barcode.replace(/\D/g, '')
  if (!code) return null
  const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_en,brands,nutriments`
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Open Food Facts returned ${res.status}`)
  const data = await res.json()
  if (data.status !== 1 || !data.product) return null
  const p = data.product
  const n = p.nutriments ?? {}
  const protein = num(n.proteins_100g)
  const carbs = num(n.carbohydrates_100g)
  const fat = num(n.fat_100g)
  let kcal = num(n['energy-kcal_100g'])
  if (kcal === undefined) {
    const kj = num(n['energy-kj_100g']) ?? num(n.energy_100g)
    if (kj !== undefined) kcal = kj / 4.184
  }
  if ([protein, carbs, fat, kcal].every((v) => v === undefined)) return null
  return {
    barcode: code,
    name: p.product_name_en || p.product_name || `Product ${code}`,
    brand: typeof p.brands === 'string' ? p.brands.split(',')[0].trim() || undefined : undefined,
    per100: {
      protein: protein ?? 0,
      carbs: carbs ?? 0,
      fat: fat ?? 0,
      kcal: Math.round(kcal ?? 0),
    },
    incomplete: [protein, carbs, fat, kcal].some((v) => v === undefined),
  }
}
