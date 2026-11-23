export type MacroKey = 'protein' | 'carbs' | 'fat' | 'kcal'

export const MACRO_KEYS: MacroKey[] = ['protein', 'carbs', 'fat', 'kcal']

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

/** Which list a ware is on: "have" (want to use it), "buy" (willing to buy it), or neither. */
export type WareList = 'have' | 'buy' | 'neither'

export type WareStatus = 'available' | 'frozen' | 'out'

export type WareSource = 'custom' | 'openfoodfacts' | 'label'

export interface Ware {
  id: string
  name: string
  brand?: string
  barcode?: string
  source: WareSource
  /** Macros per 100 g. */
  per100: Macros
  list: WareList
  status: WareStatus
  notes?: string
  createdAt: number
}

export interface Profile {
  name: string
  dailyGoals: Macros
  /** Free text sent with every meal request as a rule Claude must follow, e.g. "pescatarian, no sweeteners". */
  foodPreferences: string
}

export interface Settings {
  apiKey: string
  model: string
}

export interface RecipeIngredient {
  wareId: string
  name: string
  grams: number
  fromBuyList: boolean
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
  version: 1
  profile: Profile | null
  settings: Settings
  wares: Ware[]
  recipes: Recipe[]
}

export const DEFAULT_MODEL = 'claude-opus-5-5'

export const emptyState = (): AppState => ({
  version: 1,
  profile: null,
  settings: { apiKey: '', model: DEFAULT_MODEL },
  wares: [],
  recipes: [],
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

/** The wares a meal may use: not out, split by list. Wares on neither list are never offered. */
export function partitionWares(wares: Ware[]): { have: Ware[]; buy: Ware[] } {
  const usable = wares.filter((w) => w.status !== 'out')
  return { have: usable.filter((w) => w.list === 'have'), buy: usable.filter((w) => w.list === 'buy') }
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
