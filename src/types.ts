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

/** Which list a ware is on. "catalog" means it is known but on neither list. */
export type WareList = 'have' | 'buy' | 'catalog'

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
