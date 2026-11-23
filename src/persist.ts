import {
  type AppState,
  emptyState,
  MACRO_KEYS,
  type Macros,
  type Profile,
  type FoodLookup,
  normalizeQuery,
  type Recipe,
  type RecipeIngredient,
  type Stock,
  STOCKS,
  type SourceRef,
  type Ware,
  WARE_SOURCES,
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

/**
 * Version 1 kept two fields per food: a list (have, buy, neither) and a status
 * (available, frozen, out). Version 2 has one stock value. Where the old pair is
 * unclear, the food goes to the state that offers less to Claude: the app must
 * never decide that the user would buy something.
 */
function stockFromV1(list: unknown, status: unknown): { stock: Stock; frozenNote: boolean } {
  if (status === 'out') return { stock: 'off', frozenNote: false }
  if (list === 'have') return { stock: status === 'frozen' ? 'freezer' : 'home', frozenNote: false }
  if (list === 'buy') return { stock: 'shop', frozenNote: status === 'frozen' }
  return { stock: 'off', frozenNote: false }
}

/** A source reference; a url is kept only if it is an http(s) link, so a backup can't plant a javascript: link. */
function readRef(v: unknown): SourceRef | undefined {
  if (!isObj(v)) return undefined
  const name = str(v.name)?.trim()
  if (!name) return undefined
  const url = str(v.url)
  return /^https?:\/\//i.test(url ?? '') ? { name, url } : { name }
}

function readLookup(v: unknown): FoodLookup | null {
  if (!isObj(v)) return null
  const query = str(v.query)?.trim()
  const name = str(v.name)?.trim()
  const source = readRef(v.source)
  if (!query || !name || !source) return null
  return { key: normalizeQuery(query), query, name, per100: readMacros(v.per100), source, note: str(v.note) ?? '', createdAt: nonNegative(v.createdAt) }
}

/** Lookups without repeats of the same key; the first (newest) one wins. */
export function cleanLookups(v: unknown): FoodLookup[] {
  const seen = new Set<string>()
  return (Array.isArray(v) ? v : [])
    .map(readLookup)
    .filter((l): l is FoodLookup => {
      if (!l || !l.key || seen.has(l.key)) return false
      seen.add(l.key)
      return true
    })
}

function readWare(v: unknown, fromV1: boolean): Ware | null {
  if (!isObj(v)) return null
  const id = str(v.id)
  const name = str(v.name)?.trim()
  if (!id || !name) return null
  let notes = str(v.notes)?.trim() || undefined
  let stock: Stock
  if (!fromV1) {
    stock = pick<Stock>(v.stock, STOCKS, 'off')
  } else {
    const old = stockFromV1(v.list, v.status)
    stock = old.stock
    if (old.frozenNote) notes = notes ? `frozen; ${notes}` : 'frozen'
  }
  return {
    id,
    name,
    brand: str(v.brand) || undefined,
    barcode: str(v.barcode) || undefined,
    source: pick(v.source, WARE_SOURCES, 'custom'),
    per100: readMacros(v.per100),
    stock,
    notes,
    ref: readRef(v.ref),
    createdAt: nonNegative(v.createdAt),
  }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s): s is string => !!s) : [])

/** Staples trimmed, without blanks, and without repeats that differ only in case. */
export function cleanStaples(v: unknown): string[] {
  const seen = new Set<string>()
  return strings(v)
    .map((x) => x.trim())
    .filter((x) => {
      const k = x.toLowerCase()
      if (!x || seen.has(k)) return false
      seen.add(k)
      return true
    })
}

function readRecipe(v: unknown): Recipe | null {
  if (!isObj(v)) return null
  const id = str(v.id)
  const title = str(v.title)
  if (!id || !title || !Array.isArray(v.ingredients)) return null
  const ingredients: RecipeIngredient[] = v.ingredients.flatMap((i) => {
    if (!isObj(i) || !str(i.name)) return []
    return [{ wareId: str(i.wareId) ?? '', name: str(i.name)!, grams: nonNegative(i.grams), toBuy: i.toBuy === true || i.fromBuyList === true }]
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
  return {
    name: str(v.name) ?? '',
    dailyGoals: readMacros(v.dailyGoals),
    // Saved as foodPreferences before version 2.
    foodRules: (str(v.foodRules) ?? str(v.foodPreferences))?.trim() ?? '',
    staples: cleanStaples(v.staples),
  }
}

export function normalize(s: unknown): AppState {
  const base = emptyState()
  if (!isObj(s)) return base
  const settings = isObj(s.settings) ? s.settings : {}
  const list = <T>(v: unknown, read: (x: unknown) => T | null): T[] =>
    Array.isArray(v) ? v.map(read).filter((x): x is T => x !== null) : []
  const fromV1 = s.version !== 2
  const profile = readProfile(s.profile)
  const wares = list(s.wares, (w) => readWare(w, fromV1))
  return {
    version: 2,
    profile,
    settings: {
      apiKey: str(settings.apiKey) ?? '',
      // Users of version 1 have already been through Settings, food rules included.
      rulesAnswered: settings.rulesAnswered === true || (fromV1 && profile !== null),
    },
    wares,
    recipes: list(s.recipes, readRecipe),
    lookups: cleanLookups(s.lookups),
    upgradeNotice: fromV1 ? wares.length > 0 : s.upgradeNotice === true,
  }
}

/** Export everything except the API key. */
export function exportJson(state: AppState): string {
  const { settings, upgradeNotice: _notice, ...rest } = state
  return JSON.stringify({ ...rest, settings: { rulesAnswered: settings.rulesAnswered }, exportedAt: new Date().toISOString() }, null, 2)
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
  // Lookups are a cache, not the user's data: keep this device's too, so an import never makes the app look foods up again.
  next.lookups = cleanLookups([...next.lookups, ...current.lookups])
  next.upgradeNotice ||= current.upgradeNotice
  return next
}

export const newId = () => crypto.randomUUID()
