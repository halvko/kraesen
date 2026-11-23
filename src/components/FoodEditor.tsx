import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { type FoodLookup, type Macros, normalizeQuery, sameMacros, type SourceRef, type Stock, STOCK_HINT, STOCK_LABEL, STOCKS, type Ware } from '../types'
import { MacroInputs } from './MacroInputs'

export interface FoodDraft {
  name: string
  brand?: string
  barcode?: string
  source: Ware['source']
  per100: Macros
  stock: Stock
  notes?: string
  ref?: SourceRef
}

interface Props {
  initial: FoodDraft
  title: string
  banner?: string
  onSave: (d: FoodDraft) => void
  onCancel: () => void
  /** Given only when editing a saved food, which also keeps Save off until something changes. */
  onDelete?: () => void
}

/** The draft as Save writes it: text trimmed, empty optional text left out. */
const clean = (f: FoodDraft): FoodDraft => ({ ...f, name: f.name.trim(), brand: f.brand?.trim() || undefined, notes: f.notes?.trim() || undefined })

const sameDraft = (a: FoodDraft, b: FoodDraft) =>
  a.name === b.name &&
  a.brand === b.brand &&
  sameMacros(a.per100, b.per100) &&
  a.stock === b.stock &&
  a.notes === b.notes &&
  a.ref?.name === b.ref?.name &&
  a.ref?.url === b.ref?.url

/** Shows where looked-up macros came from. */
function SourceLine({ source, note }: { source: SourceRef; note?: string }) {
  return (
    <p className="source-line">
      <span>Source: </span>
      {source.url ? (
        <a href={source.url} target="_blank" rel="noopener noreferrer">
          {source.name}
        </a>
      ) : (
        source.name
      )}
      {note ? <small> {note}</small> : null}
    </p>
  )
}

type LookupState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; lookup: FoodLookup; cached: boolean }
  | { kind: 'failed'; message: string }

/**
 * Looks up macros per 100 g for the typed name with Claude and web search. Every result is kept,
 * so the same name (ignoring case and spacing) is answered from this device the next time.
 */
function useMacroLookup(apply: (l: FoodLookup) => void) {
  const { state, update } = useStore()
  const [st, setSt] = useState<LookupState>({ kind: 'idle' })
  // Aborted when the editor closes, so a lookup still running neither changes a closed form nor keeps spending.
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const run = async (query: string, fresh = false) => {
    const key = normalizeQuery(query)
    const cached = fresh ? undefined : state.lookups.find((l) => l.key === key)
    if (cached) {
      apply(cached)
      setSt({ kind: 'done', lookup: cached, cached: true })
      return
    }
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setSt({ kind: 'busy' })
    // The Claude SDK is only downloaded when it is first needed.
    const { describeError, estimateMacros, makeClient } = await import('../claude')
    try {
      const r = await estimateMacros(makeClient(state.settings.apiKey), query, ac.signal)
      if (ac.signal.aborted) return
      if (!r.found) {
        setSt({ kind: 'failed', message: `Claude could not find a food called "${query.trim()}". Try another name, or type the numbers yourself.` })
        return
      }
      update((s) => ({ ...s, lookups: [r.lookup, ...s.lookups.filter((l) => l.key !== r.lookup.key)] }))
      apply(r.lookup)
      setSt({ kind: 'done', lookup: r.lookup, cached: false })
    } catch (e) {
      if (ac.signal.aborted) return
      const { message } = describeError(e)
      const hint = /web.?search|web.?fetch/i.test(message) ? ' Web search may be turned off for your API key\'s organization in the Claude Console.' : ''
      setSt({ kind: 'failed', message: message + hint })
    }
  }
  const cancel = () => {
    abortRef.current?.abort()
    setSt({ kind: 'idle' })
  }
  return { st, run, cancel, hasKey: !!state.settings.apiKey }
}

export function FoodEditor({ initial, title, banner, onSave, onCancel, onDelete }: Props) {
  const [d, setD] = useState<FoodDraft>(initial)
  const next = clean(d)
  const saved = onDelete !== undefined
  const changed = !saved || !sameDraft(next, clean(initial))
  const lookup = useMacroLookup((l) => setD((cur) => ({ ...cur, per100: l.per100, source: 'lookup', ref: l.source })))
  // Scanned products have their own label; the lookup is for foods without one.
  const canLookUp = d.source === 'custom' || d.source === 'lookup'
  const busy = lookup.st.kind === 'busy'
  return (
    <div className="card editor">
      <h2>{title}</h2>
      {banner && <p className="banner">{banner}</p>}
      <label>
        <span>Name</span>
        <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Garden tomatoes" autoFocus />
      </label>
      {(d.brand !== undefined || d.source === 'openfoodfacts' || d.source === 'label') && (
        <label>
          <span>Brand</span>
          <input value={d.brand ?? ''} onChange={(e) => setD({ ...d, brand: e.target.value })} />
        </label>
      )}
      {canLookUp && (
        <div className="lookup">
          <div className="row">
            <button type="button" className="secondary" disabled={!next.name || busy || !lookup.hasKey} onClick={() => lookup.run(next.name)}>
              Look up macros
            </button>
            {busy && (
              <button type="button" className="secondary" onClick={lookup.cancel}>
                Stop
              </button>
            )}
          </div>
          {!lookup.hasKey ? (
            <p className="hint">Add your Claude API key in Settings to look up macros for any food, in Danish or English.</p>
          ) : lookup.st.kind === 'idle' && !d.ref ? (
            <p className="hint">Claude searches food databases such as Frida and USDA for the name above. Danish or English is fine.</p>
          ) : null}
          {busy && <p className="hint" role="status">Claude is searching food databases… this can take up to a minute.</p>}
          {lookup.st.kind === 'failed' && (
            <p className="error" role="alert">
              {lookup.st.message}
            </p>
          )}
          {lookup.st.kind === 'done' && (
            <p className="banner">
              {lookup.st.cached
                ? `Filled in from your saved lookup of "${lookup.st.lookup.query}". `
                : 'Filled in by Claude from the source below. '}
              Check the numbers before saving.
              {lookup.st.cached && (
                <>
                  {' '}
                  <button type="button" className="link" onClick={() => lookup.run(next.name, true)}>
                    Look up again
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      )}
      <h3>Per 100 g</h3>
      <MacroInputs idPrefix="food" value={d.per100} onChange={(per100) => setD({ ...d, per100 })} />
      {d.ref && <SourceLine source={d.ref} note={lookup.st.kind === 'done' ? lookup.st.lookup.note : undefined} />}
      <fieldset className="stock-options">
        <legend>Where is it?</legend>
        {STOCKS.map((s) => (
          <label key={s} className={d.stock === s ? 'stock-option on' : 'stock-option'}>
            <input type="radio" name="stock" value={s} checked={d.stock === s} onChange={() => setD({ ...d, stock: s })} />
            <span>
              <strong>{STOCK_LABEL[s]}</strong>
              <small>{STOCK_HINT[s]}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <label>
        <span>Notes for Claude (optional)</span>
        <input value={d.notes ?? ''} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="e.g. very ripe, use soon" />
      </label>
      <div className="row">
        <button type="button" disabled={!next.name || !changed} onClick={() => onSave(next)}>
          Save food
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {onDelete && (
        <button type="button" className="secondary danger delete-food" onClick={onDelete}>
          Delete this food
        </button>
      )}
    </div>
  )
}
