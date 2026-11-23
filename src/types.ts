export type MacroKey = 'protein' | 'carbs' | 'fat' | 'kcal'

export const MACRO_KEYS: MacroKey[] = ['protein', 'carbs', 'fat', 'kcal']

export const sameMacros = (a: Macros, b: Macros) => MACRO_KEYS.every((k) => a[k] === b[k])

export const MACRO_LABELS: Record<MacroKey, string> = {
  protein: 'Protein',
  carbs: 'Carbs',
  fat: 'Fat',
  kcal: 'Energy',
}

export const MACRO_UNITS: Record<MacroKey, string> = {
  protein: 'g',
  carbs: 'g',
  fat: 'g',
  kcal: 'kcal',
}

export type Macros = Record<MacroKey, number>

/**
 * Where a food is right now, as one fact: at home, in the freezer, at the shop
 * (not at home, but the user would buy it), or not now (kept for its macros;
 * Claude never sees it).
 */
export type Stock = 'home' | 'freezer' | 'shop' | 'off'

export const STOCKS: Stock[] = ['home', 'freezer', 'shop', 'off']

export const STOCK_LABEL: Record<Stock, string> = { home: 'Home', freezer: 'Freezer', shop: 'Shop', off: 'Not now' }

export const STOCK_HINT: Record<Stock, string> = {
  home: 'In the fridge, the cupboard or the garden. Claude may use it.',
  freezer: 'Frozen at home. Claude plans thawing or cooks it from frozen.',
  shop: 'Not at home, but you would buy it. Used only when you allow shopping.',
  off: 'Kept with its macros for later. Claude never sees it.',
}

export type WareSource = 'custom' | 'openfoodfacts' | 'label'

export interface Ware {
  id: string
  name: string
  brand?: string
  barcode?: string
  source: WareSource
  /** Macros per 100 g. */
  per100: Macros
  stock: Stock
  notes?: string
  createdAt: number
}

export interface Profile {
  name: string
  dailyGoals: Macros
  /** Free text sent with every meal request as hard rules; empty for none. */
  foodRules: string
  /** Seasonings the user has and accepts. Claude's extras may only come from here; empty means none. */
  staples: string[]
}

export interface Settings {
  apiKey: string
  /** True once the user has saved or skipped the food rules step of the first-run setup. */
  rulesAnswered: boolean
}

export interface RecipeIngredient {
  wareId: string
  name: string
  grams: number
  /** True when the food was set to Shop when the recipe was made. */
  toBuy: boolean
}

export interface Recipe {
  id: string
  title: string
  summary: string
  ingredients: RecipeIngredient[]
  extras: string[]
  steps: string[]
  tips?: string
  totals: Macros
  target: Macros
  createdAt: number
}

export interface AppState {
  version: 2
  profile: Profile | null
  settings: Settings
  wares: Ware[]
  recipes: Recipe[]
  /** True after an upgrade from version 1, until the user dismisses the note about stock and staples. */
  upgradeNotice: boolean
}


export const emptyState = (): AppState => ({
  version: 2,
  profile: null,
  settings: { apiKey: '', rulesAnswered: false },
  wares: [],
  recipes: [],
  upgradeNotice: false,
})

export const zeroMacros = (): Macros => ({ protein: 0, carbs: 0, fat: 0, kcal: 0 })

/** Kcal to whole numbers, grams to one decimal: the one rounding rule for displaying and prompting macros. */
export function roundMacro(k: MacroKey, v: number): number {
  return k === 'kcal' ? Math.round(v) : Math.round(v * 10) / 10
}

export function roundMacros(m: Macros): Macros {
  const out = zeroMacros()
  for (const k of MACRO_KEYS) out[k] = roundMacro(k, m[k])
  return out
}

/** How much shopping a meal may need. */
export type Shopping = 'none' | 'few' | 'any'

/** The most different Shop foods a meal may use. */
export const SHOP_LIMITS: Record<Shopping, number> = { none: 0, few: 2, any: Infinity }

export const SHOPPING_LABEL: Record<Shopping, string> = { none: 'Only what I have', few: 'A couple of things', any: 'Shop freely' }

export interface MealFoods {
  home: Ware[]
  freezer: Ware[]
  /** Empty when the meal may not use the shop. */
  shop: Ware[]
  /** All of the above. */
  all: Ware[]
}

/** The foods a meal may use with this shopping choice. Foods that are "Not now" are never offered. */
export function mealFoods(wares: Ware[], shopping: Shopping): MealFoods {
  const by = (stock: Stock) => wares.filter((w) => w.stock === stock)
  const home = by('home')
  const freezer = by('freezer')
  const shop = SHOP_LIMITS[shopping] > 0 ? by('shop') : []
  return { home, freezer, shop, all: [...home, ...freezer, ...shop] }
}

export type Loose = Record<string, unknown>
/** True for a plain object: not null and not an array. */
export const isObj = (v: unknown): v is Loose => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * The one rule for macro and gram values from outside the app (stored data, Open
 * Food Facts, Claude, form inputs): a finite number ≥ 0, numeric strings allowed.
 * Returns undefined otherwise, so each caller picks its own fallback.
 */
export function toNonNegative(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n >= 0 ? n : undefined
}
