import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { addLookups, findLookup, type FoodLookup, type Macros, normalizeQuery, sameMacros, type SourceRef, type Stock, STOCK_HINT, STOCK_LABEL, STOCKS, type Ware } from '../types'
import { MacroInputs } from './MacroInputs'
import { KeyForm } from './ProfileForms'
import { Sheet } from './Sheet'

export interface FoodDraft {
  name: string
  brand?: string
  barcode?: string
  source: Ware['source']
  per100: Macros
  stock: Stock
  notes?: string
  sourceRef?: SourceRef
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
  a.sourceRef?.name === b.sourceRef?.name &&
  a.sourceRef?.url === b.sourceRef?.url

function SourceLine({ source }: { source: SourceRef }) {
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
      {source.note ? <small> {source.note}</small> : null}
    </p>
  )
}

type LookupState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; lookup: FoodLookup; cached: boolean }
  | { kind: 'failed'; message: string; fixKey: boolean }

/**
 * Looks up macros per 100 g for a name with Claude and web search, and keeps every result so the
 * same name is answered from this device the next time. apply is called only while the name in
 * the form is still the one that was looked up.
 */
function useMacroLookup(currentName: string, apply: (l: FoodLookup) => void) {
  const { state, update } = useStore()
  const [st, setSt] = useState<LookupState>({ kind: 'idle' })
  // Aborted when the editor closes, so a lookup still running neither changes a closed form nor keeps spending.
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])
  const nameRef = useRef(currentName)
  useEffect(() => {
    nameRef.current = currentName
  })

  const run = async (query: string, fresh = false) => {
    const cached = fresh ? undefined : findLookup(state.lookups, query)
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
        setSt({ kind: 'failed', message: `Claude could not find a food called "${query.trim()}". Try another name, or type the numbers yourself.`, fixKey: false })
        return
      }
      update((s) => ({ ...s, lookups: addLookups(s.lookups, [r.lookup]) }))
      // The name was changed while Claude searched: keep the result for that name, but leave this form alone.
      if (normalizeQuery(nameRef.current) !== r.lookup.key) {
        setSt({ kind: 'idle' })
        return
      }
      apply(r.lookup)
      setSt({ kind: 'done', lookup: r.lookup, cached: false })
    } catch (e) {
      if (ac.signal.aborted) return
      const { message, fixKey } = describeError(e)
      setSt({ kind: 'failed', message: `${message} You can also type the numbers yourself.`, fixKey })
    }
  }
  const cancel = () => {
    abortRef.current?.abort()
    setSt({ kind: 'idle' })
  }
  /** Hides the result note once the user has changed the numbers it describes. */
  const dismiss = () => setSt((cur) => (cur.kind === 'done' ? { kind: 'idle' } : cur))
  return { st, run, cancel, dismiss, hasKey: !!state.settings.apiKey }
}

export function FoodEditor({ initial, title, banner, onSave, onCancel, onDelete }: Props) {
  const [d, setD] = useState<FoodDraft>(initial)
  const next = clean(d)
  const saved = onDelete !== undefined
  const changed = !saved || !sameDraft(next, clean(initial))
  const lookup = useMacroLookup(d.name, (l) => setD((cur) => ({ ...cur, per100: l.per100, source: 'lookup', sourceRef: l.source })))
  const [keySheet, setKeySheet] = useState(false)
  const lookupButton = useRef<HTMLButtonElement>(null)
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
            {lookup.hasKey ? (
              <button
                ref={lookupButton}
                type="button"
                className="secondary"
                // aria-disabled instead of disabled while busy, so keyboard focus stays on the button.
                disabled={!next.name}
                aria-disabled={busy || undefined}
                onClick={() => !busy && lookup.run(next.name)}
              >
                {busy ? 'Looking up…' : 'Look up macros'}
              </button>
            ) : (
              <button type="button" className="secondary" onClick={() => setKeySheet(true)}>
                Add API key to look up macros
              </button>
            )}
            {lookup.st.kind === 'done' && lookup.st.cached && (
              <button type="button" className="secondary" onClick={() => lookup.run(next.name, true)}>
                Look up again
              </button>
            )}
            {busy && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  lookup.cancel()
                  lookupButton.current?.focus()
                }}
              >
                Stop
              </button>
            )}
          </div>
          {lookup.hasKey && lookup.st.kind === 'idle' && !d.sourceRef && (
            <p className="hint">Claude searches food databases such as Frida and USDA for the name above. Danish or English is fine.</p>
          )}
          {busy && (
            <p className="hint" role="status">
              Claude is searching food databases… this can take up to a minute.
            </p>
          )}
          {lookup.st.kind === 'failed' && (
            <div className="error" role="alert">
              <p>{lookup.st.message}</p>
              {lookup.st.fixKey && (
                <button type="button" className="secondary" onClick={() => setKeySheet(true)}>
                  Fix the key
                </button>
              )}
            </div>
          )}
          {lookup.st.kind === 'done' && (
            <p className="banner">
              {lookup.st.cached
                ? `Filled in from your saved lookup of "${lookup.st.lookup.query}". `
                : 'Filled in by Claude from the source below. '}
              Check the numbers before saving.
            </p>
          )}
        </div>
      )}
      <h3>Per 100 g</h3>
      <MacroInputs
        idPrefix="food"
        value={d.per100}
        // Numbers typed by hand are the user's own: the looked-up source no longer applies.
        onChange={(per100) => {
          if (d.source === 'lookup') lookup.dismiss()
          setD({ ...d, per100, ...(d.source === 'lookup' ? { source: 'custom', sourceRef: undefined } : {}) })
        }}
      />
      {d.sourceRef && <SourceLine source={d.sourceRef} />}
      {keySheet && (
        <Sheet title="Claude API key" onClose={() => setKeySheet(false)}>
          <KeyForm onSaved={() => setKeySheet(false)} />
        </Sheet>
      )}
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
