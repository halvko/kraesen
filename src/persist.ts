import {
  type AppState,
  DEFAULT_MODEL,
  emptyState,
  MACRO_KEYS,
  type Macros,
  type Profile,
  type Recipe,
  type RecipeIngredient,
  type Ware,
  type WareList,
  type WareSource,
  type WareStatus,
  isObj,
  toNonNegative,
} from './types'

// Stored and imported data is read tolerantly: anything malformed is repaired or
// dropped here, so the UI can trust the types. A backup edited by hand or written
// by another version of the app must never crash the app on load.

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined)

/** A usable macro or gram value, or 0. */
export const nonNegative = (v: unknown): number => toNonNegative(v) ?? 0

export function readMacros(v: unknown): Macros {
  const o = isObj(v) ? v : {}
  return Object.fromEntries(MACRO_KEYS.map((k) => [k, nonNegative(o[k])])) as Macros
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback

function readWare(v: unknown): Ware | null {
  if (!isObj(v)) return null
  const id = str(v.id)
  const name = str(v.name)?.trim()
  if (!id || !name) return null
  // Early builds called the third list "catalog".
  const list = v.list === 'catalog' ? 'neither' : v.list
  return {
    id,
    name,
    brand: str(v.brand) || undefined,
    barcode: str(v.barcode) || undefined,
    source: pick<WareSource>(v.source, ['custom', 'openfoodfacts', 'label'], 'custom'),
    per100: readMacros(v.per100),
    list: pick<WareList>(list, ['have', 'buy', 'neither'], 'neither'),
    status: pick<WareStatus>(v.status, ['available', 'frozen', 'out'], 'available'),
    notes: str(v.notes) || undefined,
    createdAt: nonNegative(v.createdAt),
  }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s): s is string => !!s) : [])

function readRecipe(v: unknown): Recipe | null {
  if (!isObj(v)) return null
  const id = str(v.id)
  const title = str(v.title)
  if (!id || !title || !Array.isArray(v.ingredients)) return null
  const ingredients: RecipeIngredient[] = v.ingredients.flatMap((i) => {
    if (!isObj(i) || !str(i.name)) return []
    return [{ wareId: str(i.wareId) ?? '', name: str(i.name)!, grams: nonNegative(i.grams), fromBuyList: i.fromBuyList === true }]
  })
  return {
    id,
    title,
    summary: str(v.summary) ?? '',
    ingredients,
    extras: strings(v.extras),
    steps: strings(v.steps),
    tips: str(v.tips) || undefined,
    totals: readMacros(v.totals),
    target: readMacros(v.target),
    createdAt: nonNegative(v.createdAt),
  }
}

function readProfile(v: unknown): Profile | null {
  if (!isObj(v) || !isObj(v.dailyGoals)) return null
  return { name: str(v.name) ?? '', dailyGoals: readMacros(v.dailyGoals) }
}

export function normalize(s: unknown): AppState {
  const base = emptyState()
  if (!isObj(s)) return base
  const settings = isObj(s.settings) ? s.settings : {}
  const list = <T>(v: unknown, read: (x: unknown) => T | null): T[] =>
    Array.isArray(v) ? v.map(read).filter((x): x is T => x !== null) : []
  return {
    version: 1,
    profile: readProfile(s.profile),
    settings: { apiKey: str(settings.apiKey) ?? '', model: str(settings.model) || DEFAULT_MODEL },
    wares: list(s.wares, readWare),
    recipes: list(s.recipes, readRecipe),
  }
}

/** Export everything except the API key. */
export function exportJson(state: AppState): string {
  const { settings, ...rest } = state
  return JSON.stringify({ ...rest, settings: { model: settings.model }, exportedAt: new Date().toISOString() }, null, 2)
}

/** Parses an export; throws with a readable message if the file is not one. Keeps this device's API key. */
export function importJson(text: string, current: AppState): AppState {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  if (!isObj(parsed) || !Array.isArray(parsed.wares)) {
    throw new Error('This file does not look like a Kraesen export.')
  }
  const next = normalize(parsed)
  next.settings.apiKey = current.settings.apiKey
  return next
}

export const newId = () => crypto.randomUUID()
