import { useState } from 'react'
import { cleanStaples } from '../persist'
import { useStore } from '../store'

/** Seasonings the user has and accepts. Claude's extras may only come from this list. */
export function StaplesCard() {
  const { state, update } = useStore()
  const staples = state.profile?.staples ?? []
  const [draft, setDraft] = useState('')

  // Staples live on the profile, like the food rules; the goals step creates it.
  if (!state.profile) {
    return (
      <section className="card" id="staples">
        <h2>Staples</h2>
        <p className="hint">Seasonings Claude may add. Save your daily goals in Settings first.</p>
      </section>
    )
  }
  const setStaples = (next: string[]) => update((s) => (s.profile ? { ...s, profile: { ...s.profile, staples: cleanStaples(next) } } : s))
  const add = () => {
    // "salt, pepper" adds two.
    setStaples([...staples, ...draft.split(',')])
    setDraft('')
  }

  return (
    <section className="card" id="staples">
      <h2>
        Staples <span className="count">{staples.length}</span>
      </h2>
      <p className="hint">
        Seasonings you have and are happy to use, like salt, pepper or spices. Claude adds nothing else.
        {staples.length === 0 && ' With none listed, recipes come without seasoning.'}
      </p>
      {staples.length > 0 && (
        <ul className="staples">
          {staples.map((st) => (
            <li key={st} className="staple">
              {st}
              <button type="button" className="icon" aria-label={`Remove ${st}`} onClick={() => setStaples(staples.filter((x) => x !== st))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim()) add()
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. salt, black pepper" aria-label="Add a staple" />
        <button type="submit" className="secondary" disabled={!draft.trim()}>
          Add
        </button>
      </form>
    </section>
  )
}
