import { useState } from 'react'
import { useStore } from '../store'
import { DEFAULT_MODEL, type Macros, type Profile } from '../types'
import { MacroInputs } from './MacroInputs'

// The forms below are used both in Settings and in the first-run sheets on Cook.
// Each saves on its own; onSaved lets a sheet close afterwards.

const DEFAULT_GOALS: Macros = { protein: 140, carbs: 220, fat: 70, kcal: 2100 }

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (cheaper)' },
]

/** A profile with the given changes, starting from an empty one when there is none yet. */
const withProfile = (p: Profile | null, change: Partial<Profile>): Profile => ({
  name: '',
  dailyGoals: DEFAULT_GOALS,
  foodPreferences: '',
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
          onClick={() => {
            update((s) => ({ ...s, profile: withProfile(s.profile, { name: name.trim(), dailyGoals: goals }) }))
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
  const [rules, setRules] = useState(state.profile?.foodPreferences ?? '')
  const [note, flash] = useSavedNote()
  const save = (text: string) => {
    update((s) => ({
      ...s,
      profile: withProfile(s.profile, { foodPreferences: text.trim() }),
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
        <button type="button" onClick={() => save(rules)}>
          Save rules
        </button>
        {!state.settings.rulesAnswered && !rules.trim() && (
          <button type="button" className="secondary" onClick={() => save('')}>
            I have none
          </button>
        )}
        {note && <span className="hint">{note}</span>}
      </div>
    </>
  )
}

type Check = { kind: 'idle' } | { kind: 'checking' } | { kind: 'ok' } | { kind: 'failed'; message: string }

export function KeyForm({ onSaved }: { onSaved?: () => void }) {
  const { state, update } = useStore()
  const [apiKey, setApiKey] = useState(state.settings.apiKey)
  const [showKey, setShowKey] = useState(false)
  const [check, setCheck] = useState<Check>({ kind: 'idle' })
  const model = state.settings.model

  // The key is saved even when the check fails, so a network hiccup never blocks setup; the result says what happened.
  const checkAndSave = async () => {
    const key = apiKey.trim()
    update((s) => ({ ...s, settings: { ...s.settings, apiKey: key } }))
    setCheck({ kind: 'checking' })
    // The Claude SDK is loaded on first use to keep the initial download small.
    const { checkKey, describeError } = await import('../claude')
    try {
      await checkKey(key, model)
      setCheck({ kind: 'ok' })
      onSaved?.()
    } catch (e) {
      setCheck({ kind: 'failed', message: describeError(e).message })
    }
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
      <label>
        <span>Model</span>
        <select value={model} onChange={(e) => update((s) => ({ ...s, settings: { ...s.settings, model: e.target.value || DEFAULT_MODEL } }))}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button type="button" onClick={checkAndSave} disabled={!apiKey.trim() || check.kind === 'checking'}>
          {check.kind === 'checking' ? 'Checking…' : 'Check and save key'}
        </button>
        {check.kind === 'ok' && <span className="hint ok-note">Saved. The key works.</span>}
      </div>
      {check.kind === 'failed' && (
        <div className="error" role="alert">
          <p>Saved, but the check failed: {check.message}</p>
          {onSaved && (
            <button type="button" className="link" onClick={onSaved}>
              Continue anyway
            </button>
          )}
        </div>
      )}
    </>
  )
}
