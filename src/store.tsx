import { get, set } from 'idb-keyval'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { normalize } from './persist'
import type { AppState } from './types'

const KEY = 'kraesen-state-v1'

type Updater = (s: AppState) => AppState

interface StoreValue {
  state: AppState
  update: (fn: Updater) => void
  replace: (s: AppState) => void
}

const StoreContext = createContext<StoreValue | null>(null)

type Load = { kind: 'loading' } | { kind: 'ready'; state: AppState } | { kind: 'failed'; message: string }

export function StoreProvider({ children }: { children: ReactNode }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  // Saving starts only after a successful read, so a failed read can never
  // overwrite the stored data with an empty state.
  const canSave = useRef(false)

  useEffect(() => {
    get(KEY)
      .then((s) => {
        canSave.current = true
        setLoad({ kind: 'ready', state: normalize(s) })
      })
      .catch((e) => setLoad({ kind: 'failed', message: e instanceof Error ? e.message : String(e) }))
    // Ask the browser not to evict our data under storage pressure.
    navigator.storage?.persist?.().catch(() => {})
  }, [])

  const state = load.kind === 'ready' ? load.state : null
  useEffect(() => {
    if (state && canSave.current) set(KEY, state).catch((e) => console.error('Saving failed', e))
  }, [state])

  const update = useCallback((fn: Updater) => setLoad((l) => (l.kind === 'ready' ? { kind: 'ready', state: fn(l.state) } : l)), [])
  const replace = useCallback((s: AppState) => setLoad((l) => (l.kind === 'ready' ? { kind: 'ready', state: normalize(s) } : l)), [])

  if (load.kind === 'loading') return <div className="loading">Loading…</div>
  if (load.kind === 'failed') {
    return (
      <div className="loading" role="alert">
        <p>Kraesen could not read its saved data ({load.message}). Nothing has been changed.</p>
        <button type="button" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    )
  }
  return <StoreContext.Provider value={{ state: load.state, update, replace }}>{children}</StoreContext.Provider>
}

// eslint-disable-next-line react/only-export-components -- the hook belongs with its provider.
export function useStore(): StoreValue {
  const v = useContext(StoreContext)
  if (!v) throw new Error('useStore outside StoreProvider')
  return v
}
