import { useState } from 'react'
import { useStore } from '../store'
import { type Macros, type Profile, sameMacros } from '../types'
import { MacroInputs } from './MacroInputs'

// The forms below are used both in Settings and in the first-run sheets on Cook.
// Each saves on its own; onSaved lets a sheet close afterwards.

const DEFAULT_GOALS: Macros = { protein: 140, carbs: 220, fat: 70, kcal: 2100 }

/** A profile with the given changes; the goals step creates it, with no rules or staples yet. */
const withProfile = (p: Profile | null, change: Partial<Profile>): Profile => ({
  name: '',
  dailyGoals: DEFAULT_GOALS,
  foodRules: '',
  staples: [],
  ...p,
  ...change,
})

function useSavedNote() {
  const [note, setNote] = useState('')
  return [note, (text: string) => {
    setNote(text)
    setTimeout(() => setNote(''), 2500)
  }] as const
}

export function GoalsForm({ onSaved }: { onSaved?: () => void }) {
  const { state, update } = useStore()
  const [name, setName] = useState(state.profile?.name ?? '')
  const [goals, setGoals] = useState<Macros>(state.profile?.dailyGoals ?? DEFAULT_GOALS)
  const [note, flash] = useSavedNote()
  const derivedKcal = Math.round(goals.protein * 4 + goals.carbs * 4 + goals.fat * 9)
  const next = { name: name.trim(), dailyGoals: goals }
  const { profile } = state
  // Before the first save there is no profile, so the suggested goals can be saved as they are.
  const changed = !profile || next.name !== profile.name || !sameMacros(next.dailyGoals, profile.dailyGoals)
  return (
    <>
      <label>
        <span>Name (optional)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Erik" />
      </label>
      <MacroInputs idPrefix="goal" value={goals} onChange={setGoals} />
      <p className="hint">
        From protein, carbs and fat alone that is about {derivedKcal} kcal.
        {Math.abs(derivedKcal - goals.kcal) > goals.kcal * 0.1 && goals.kcal > 0 ? ' Your energy goal differs quite a bit from that.' : ''}
      </p>
      <div className="row">
        <button
          type="button"
          disabled={!changed}
          onClick={() => {
            update((s) => ({ ...s, profile: withProfile(s.profile, next) }))
            flash('Saved.')
            onSaved?.()
          }}
        >
          Save goals
        </button>
        {note && <span className="hint">{note}</span>}
      </div>
    </>
  )
}

export function RulesForm({ onSaved }: { onSaved?: () => void }) {
  const { state, update } = useStore()
  const [rules, setRules] = useState(state.profile?.foodRules ?? '')
  const [note, flash] = useSavedNote()
  const text = rules.trim()
  // Rules live on the profile, which the goals step creates; until then there is nowhere to keep them.
  if (!state.profile) return <p className="hint">Save your daily goals first.</p>
  const save = (value: string) => {
    update((s) => ({
      ...s,
      profile: s.profile && { ...s.profile, foodRules: value },
      settings: { ...s.settings, rulesAnswered: true },
    }))
    flash('Saved.')
    onSaved?.()
  }
  return (
    <>
      <label>
        <span>Anything Claude must always follow? Diet, allergies, things you never eat. Leave empty for none.</span>
        <textarea
          rows={3}
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          placeholder="e.g. pescatarian, no light or low-fat products, no artificial sweeteners"
        />
      </label>
      <div className="row">
        <button type="button" disabled={state.settings.rulesAnswered && text === state.profile.foodRules} onClick={() => save(text)}>
          Save rules
        </button>
        {!state.settings.rulesAnswered && !text && (
          <button type="button" className="secondary" onClick={() => save('')}>
            I have none
          </button>
        )}
        {note && <span className="hint">{note}</span>}
      </div>
    </>
  )
}

type Check = { kind: 'idle' } | { kind: 'checking' } | { kind: 'ok'; saved: boolean } | { kind: 'failed'; message: string } | { kind: 'savedAnyway' }

export function KeyForm({ onSaved }: { onSaved?: () => void }) {
  const { state, update } = useStore()
  const [apiKey, setApiKey] = useState(state.settings.apiKey)
  const [showKey, setShowKey] = useState(false)
  const [check, setCheck] = useState<Check>({ kind: 'idle' })
  const key = apiKey.trim()
  // An unchanged key can still be checked, e.g. one saved with "Save this key anyway" after a failed check.
  const unchanged = key === state.settings.apiKey

  // The key is saved when the check passes, or when the user chooses "Save this key anyway" after a failed check,
  // so a network hiccup never blocks setup. Saving comes after the check, because it can finish setup and close this form.
  const checkAndSave = async () => {
    setCheck({ kind: 'checking' })
    // The Claude SDK is loaded on first use to keep the initial download small.
    const { checkKey, describeError } = await import('../claude')
    let result: Check
    try {
      await checkKey(key)
      result = { kind: 'ok', saved: !unchanged }
    } catch (e) {
      result = { kind: 'failed', message: describeError(e).message }
    }
    setCheck(result)
    if (result.kind === 'ok' && result.saved) {
      update((s) => ({ ...s, settings: { ...s.settings, apiKey: key } }))
      onSaved?.()
    }
  }

  const saveAnyway = () => {
    update((s) => ({ ...s, settings: { ...s.settings, apiKey: key } }))
    setCheck({ kind: 'savedAnyway' })
    onSaved?.()
  }

  return (
    <>
      <p className="hint">
        Used to read nutrition labels and plan meals. It is stored only in this browser and sent only to api.anthropic.com. Get
        one at console.anthropic.com.
      </p>
      <div className="row">
        <input
          type={showKey ? 'text' : 'password'}
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value)
            setCheck({ kind: 'idle' })
          }}
          placeholder="sk-ant-…"
          autoComplete="off"
          aria-label="Claude API key"
        />
        <button type="button" className="secondary" onClick={() => setShowKey((v) => !v)}>
          {showKey ? 'Hide' : 'Show'}
        </button>
      </div>
      <div className="row">
        <button type="button" onClick={checkAndSave} disabled={!key || check.kind === 'checking' || (unchanged && check.kind === 'ok')}>
          {check.kind === 'checking' ? 'Checking…' : unchanged ? 'Check key' : 'Check and save key'}
        </button>
        {check.kind === 'ok' && <span className="hint ok-note">{check.saved ? 'The key works. Saved.' : 'The key works.'}</span>}
        {check.kind === 'savedAnyway' && <span className="hint">Saved without a working check.</span>}
      </div>
      {check.kind === 'failed' && (
        <div className="error" role="alert">
          <p>The check failed: {check.message}</p>
          {/* A saved key needs no saving; it stays as it is. */}
          {unchanged ? (
            <p>Your saved key is kept.</p>
          ) : (
            <button type="button" className="link" onClick={saveAnyway}>
              Save this key anyway
            </button>
          )}
        </div>
      )}
    </>
  )
}
