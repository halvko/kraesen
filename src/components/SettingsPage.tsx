import { useRef, useState } from 'react'
import { exportJson, importJson, useStore } from '../store'
import { DEFAULT_MODEL, type Macros } from '../types'
import { MacroInputs } from './MacroInputs'

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (cheaper)' },
]

export function SettingsPage() {
  const { state, update, replace } = useStore()
  const [goals, setGoals] = useState<Macros>(
    state.profile?.dailyGoals ?? { protein: 140, carbs: 220, fat: 70, kcal: 2100 },
  )
  const [name, setName] = useState(state.profile?.name ?? '')
  const [apiKey, setApiKey] = useState(state.settings.apiKey)
  const [showKey, setShowKey] = useState(false)
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const save = () => {
    update((s) => ({
      ...s,
      profile: { name: name.trim(), dailyGoals: goals },
      settings: { ...s.settings, apiKey: apiKey.trim() },
    }))
    setMessage('Saved.')
    setTimeout(() => setMessage(''), 2000)
  }

  const download = () => {
    const blob = new Blob([exportJson(state)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `kraesen-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const onImport = async (file: File) => {
    try {
      const next = importJson(await file.text(), state)
      if (!confirm(`Replace all data on this device with ${next.wares.length} wares and ${next.recipes.length} recipes from the file?`)) return
      replace(next)
      setGoals(next.profile?.dailyGoals ?? goals)
      setName(next.profile?.name ?? '')
      setMessage('Imported.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Import failed.')
    }
  }

  const derivedKcal = Math.round(goals.protein * 4 + goals.carbs * 4 + goals.fat * 9)

  return (
    <div className="page">
      <section className="card">
        <h2>Daily goals</h2>
        <label>
          <span>Name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Erik" />
        </label>
        <MacroInputs idPrefix="goal" value={goals} onChange={setGoals} />
        <p className="hint">
          From protein, carbs and fat alone that is about {derivedKcal} kcal.
          {Math.abs(derivedKcal - goals.kcal) > goals.kcal * 0.1 && goals.kcal > 0 ? ' Your energy goal differs quite a bit from that.' : ''}
        </p>
      </section>

      <section className="card">
        <h2>Claude API key</h2>
        <p className="hint">
          Used to read nutrition labels and plan meals. It is stored only in this browser and sent only to
          api.anthropic.com. Get one at console.anthropic.com.
        </p>
        <div className="row">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
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
          <select
            value={state.settings.model}
            onChange={(e) => update((s) => ({ ...s, settings: { ...s.settings, model: e.target.value || DEFAULT_MODEL } }))}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="row sticky-actions">
        <button type="button" onClick={save}>
          Save
        </button>
        {message && <span className="hint">{message}</span>}
      </div>

      <section className="card">
        <h2>Backup</h2>
        <p className="hint">
          Everything lives on this device only. Export a JSON file now and then; the API key is never included.
        </p>
        <div className="row">
          <button type="button" className="secondary" onClick={download}>
            Export JSON
          </button>
          <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
            Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImport(f)
              e.target.value = ''
            }}
          />
        </div>
      </section>
    </div>
  )
}
