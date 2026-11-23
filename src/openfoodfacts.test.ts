import { afterEach, describe, expect, it, vi } from 'vitest'
import { lookupBarcode } from './openfoodfacts'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

const found = (product: Record<string, unknown>) => ({ status: 1, product })

afterEach(() => vi.unstubAllGlobals())

describe('lookupBarcode', () => {
  it('reads macros per 100 g and prefers the English name and the first brand', async () => {
    mockFetch(200, found({
      product_name: 'Havregryn',
      product_name_en: 'Rolled oats',
      brands: 'Ø-mærket, Coop',
      nutriments: { proteins_100g: 13, carbohydrates_100g: 60, fat_100g: 7, 'energy-kcal_100g': 372 },
    }))
    const p = await lookupBarcode('5701234567890')
    expect(p).toEqual({
      barcode: '5701234567890',
      name: 'Rolled oats',
      brand: 'Ø-mærket',
      per100: { protein: 13, carbs: 60, fat: 7, kcal: 372 },
      incomplete: false,
    })
  })

  it('converts kJ to kcal when no kcal value is given', async () => {
    mockFetch(200, found({ product_name: 'X', nutriments: { proteins_100g: 1, carbohydrates_100g: 1, fat_100g: 1, 'energy-kj_100g': 1000 } }))
    expect((await lookupBarcode('1'))?.per100.kcal).toBe(239)
  })

  it('falls back to energy_100g (kJ) when neither kcal nor energy-kj is given', async () => {
    mockFetch(200, found({ product_name: 'X', nutriments: { proteins_100g: 1, carbohydrates_100g: 1, fat_100g: 1, energy_100g: 418.4 } }))
    expect((await lookupBarcode('1'))?.per100.kcal).toBe(100)
  })

  it('parses numeric strings', async () => {
    mockFetch(200, found({ product_name: 'X', nutriments: { proteins_100g: '12.5', carbohydrates_100g: '3', fat_100g: '0.5', 'energy-kcal_100g': '70' } }))
    expect((await lookupBarcode('1'))?.per100).toEqual({ protein: 12.5, carbs: 3, fat: 0.5, kcal: 70 })
  })

  it('treats values with units or decimal commas as missing', async () => {
    mockFetch(200, found({ product_name: 'X', nutriments: { proteins_100g: '12.5g', carbohydrates_100g: '3,5', fat_100g: 1, 'energy-kcal_100g': 70 } }))
    const p = await lookupBarcode('1')
    expect(p?.incomplete).toBe(true)
    expect(p?.per100).toEqual({ protein: 0, carbs: 0, fat: 1, kcal: 70 })
  })

  it('marks missing macros as incomplete and sets them to 0', async () => {
    mockFetch(200, found({ product_name: 'X', nutriments: { proteins_100g: 10 } }))
    const p = await lookupBarcode('1')
    expect(p?.incomplete).toBe(true)
    expect(p?.per100).toEqual({ protein: 10, carbs: 0, fat: 0, kcal: 0 })
  })

  it('returns null when the product has no nutrition data', async () => {
    mockFetch(200, found({ product_name: 'X', nutriments: {} }))
    expect(await lookupBarcode('1')).toBeNull()
  })

  it('returns null for an unknown product (status 0 or HTTP 404) and throws on server errors', async () => {
    mockFetch(200, { status: 0 })
    expect(await lookupBarcode('1')).toBeNull()
    mockFetch(404, {})
    expect(await lookupBarcode('1')).toBeNull()
    mockFetch(500, {})
    await expect(lookupBarcode('1')).rejects.toThrow('500')
  })

  it('names a product with no name after its barcode', async () => {
    mockFetch(200, found({ nutriments: { proteins_100g: 1 } }))
    expect((await lookupBarcode('42'))?.name).toBe('Ware 42')
  })

  it('strips non-digits from the barcode and skips the request for an empty one', async () => {
    const fn = mockFetch(200, { status: 0 })
    await lookupBarcode(' 57-01 ')
    expect(String((fn.mock.calls[0] as unknown[])[0])).toContain('/product/5701.json')
    fn.mockClear()
    expect(await lookupBarcode('abc')).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })
})
