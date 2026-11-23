import { get, set } from 'idb-keyval'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { type AppState, DEFAULT_MODEL, emptyState } from './types'

const KEY = 'kraesen-state-v1'

type Updater = (s: AppState) => AppState

interface StoreValue {
  state: AppState
  update: (fn: Updater) => void
  replace: (s: AppState) => void
}

const StoreContext = createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null)
  const loaded = useRef(false)

  useEffect(() => {
    get<AppState>(KEY)
      .then((s) => setState(normalize(s)))
      .catch(() => setState(emptyState()))
      .finally(() => {
        loaded.current = true
      })
    // Ask the browser not to evict our data under storage pressure.
    navigator.storage?.persist?.().catch(() => {})
  }, [])

  useEffect(() => {
    if (state && loaded.current) set(KEY, state).catch((e) => console.error('Saving failed', e))
  }, [state])

  const update = useCallback((fn: Updater) => setState((s) => (s ? fn(s) : s)), [])
  const replace = useCallback((s: AppState) => setState(normalize(s)), [])

  if (!state) return <div className="loading">Loading…</div>
  return <StoreContext.Provider value={{ state, update, replace }}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const v = useContext(StoreContext)
  if (!v) throw new Error('useStore outside StoreProvider')
  return v
}

function normalize(s: unknown): AppState {
  const base = emptyState()
  if (!s || typeof s !== 'object') return base
  const o = s as Partial<AppState>
  return {
    version: 1,
    profile: o.profile ?? null,
    settings: { apiKey: o.settings?.apiKey ?? '', model: o.settings?.model || DEFAULT_MODEL },
    wares: Array.isArray(o.wares) ? o.wares : [],
    recipes: Array.isArray(o.recipes) ? o.recipes : [],
  }
}

/** Export everything except the API key. */
export function exportJson(state: AppState): string {
  const { settings, ...rest } = state
  return JSON.stringify({ ...rest, settings: { model: settings.model }, exportedAt: new Date().toISOString() }, null, 2)
}

export function importJson(text: string, current: AppState): AppState {
  const parsed = JSON.parse(text) as Partial<AppState>
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.wares)) {
    throw new Error('This file does not look like a Kraesen export.')
  }
  const next = normalize(parsed)
  // Keep the key already on this device; exports never contain it.
  next.settings.apiKey = current.settings.apiKey
  return next
}

export const newId = () => crypto.randomUUID()
