import { useEffect, useRef, useState } from 'react'
import type { AgentEvent, BuyWillingness } from '../claude'
import { useStore } from '../store'
import { MACRO_KEYS, type Macros, type Recipe } from '../types'
import { MacroInputs, MacroSummary } from './MacroInputs'
import { RecipeView } from './RecipeView'

const SHARES = [
  { label: '¼', value: 0.25 },
  { label: '⅓', value: 1 / 3 },
  { label: '½', value: 0.5 },
]

const scale = (m: Macros, f: number): Macros =>
  Object.fromEntries(MACRO_KEYS.map((k) => [k, Math.round(m[k] * f * (k === 'kcal' ? 1 : 10)) / (k === 'kcal' ? 1 : 10)])) as Macros

export function MealPage({ goToSettings, goToWares }: { goToSettings: () => void; goToWares: () => void }) {
  const { state, update } = useStore()
  const daily = state.profile?.dailyGoals
  const [share, setShare] = useState(1 / 3)
  const [target, setTarget] = useState<Macros>(() => scale(daily ?? { protein: 0, carbs: 0, fat: 0, kcal: 0 }, 1 / 3))
  const [willingness, setWillingness] = useState<BuyWillingness>('some')
  const [wish, setWish] = useState('')
  const [running, setRunning] = useState(false)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  if (!daily || !state.settings.apiKey) {
    return (
      <div className="page">
        <section className="card">
          <h2>Welcome to Kraesen</h2>
          <p>Set your daily macro goals and paste a Claude API key to get started.</p>
          <button type="button" onClick={goToSettings}>
            Open settings
          </button>
        </section>
      </div>
    )
  }

  const usable = state.wares.filter((w) => w.status !== 'out')
  const haveCount = usable.filter((w) => w.list === 'have').length
  const buyCount = usable.filter((w) => w.list === 'buy').length

  const pickShare = (v: number) => {
    setShare(v)
    setTarget(scale(daily, v))
  }

  const run = async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setRunning(true)
    setEvents([])
    setRecipe(null)
    setError('')
    setSaved(false)
    // The Claude SDK is loaded on first use to keep the initial download small.
    const { describeError, generateMeal } = await import('../claude')
    try {
      const r = await generateMeal(
        state.settings.apiKey,
        state.settings.model,
        { target, willingness, wish },
        state.wares,
        (e) => setEvents((prev) => [...prev, e]),
        ac.signal,
      )
      setRecipe(r)
    } catch (e) {
      if (!ac.signal.aborted) setError(describeError(e))
    } finally {
      setRunning(false)
    }
  }

  const attempts = events.filter((e): e is Extract<AgentEvent, { kind: 'attempt' }> => e.kind === 'attempt')

  return (
    <div className="page">
      <section className="card">
        <h2>Plan a meal</h2>
        <div className="row share-row">
          <span>Share of daily goals:</span>
          {SHARES.map((s) => (
            <button key={s.label} type="button" className={Math.abs(share - s.value) < 1e-6 ? 'chip active' : 'chip'} onClick={() => pickShare(s.value)}>
              {s.label}
            </button>
          ))}
        </div>
        <MacroInputs idPrefix="target" value={target} onChange={setTarget} />
        <label>
          <span>Buying extra wares</span>
          <select value={willingness} onChange={(e) => setWillingness(e.target.value as BuyWillingness)}>
            <option value="none">Only what I have</option>
            <option value="some">A couple of things is fine</option>
            <option value="happy">Happy to shop</option>
          </select>
        </label>
        <label>
          <span>Wish (optional)</span>
          <input value={wish} onChange={(e) => setWish(e.target.value)} placeholder="e.g. something warm, quick lunch, no oven" />
        </label>
        <p className="hint">
          Using {haveCount} ware{haveCount === 1 ? '' : 's'} you have
          {willingness !== 'none' ? ` and ${buyCount} you could buy` : ''}.{' '}
          {haveCount === 0 && (
            <button type="button" className="link" onClick={goToWares}>
              Add wares
            </button>
          )}
        </p>
        <div className="row">
          <button type="button" onClick={run} disabled={running}>
            {running ? 'Planning…' : recipe ? 'Try another' : 'Generate meal'}
          </button>
          {running && (
            <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          )}
        </div>
      </section>

      {(running || attempts.length > 0) && (
        <section className="card progress">
          <h3>Fitting portions</h3>
          {attempts.length === 0 && <p className="hint">Claude is choosing ingredients…</p>}
          <ol>
            {attempts.map((a) => (
              <li key={a.solutionId}>
                <div className="attempt-ingredients">{a.solution.portions.map((p) => `${p.ware.name} ${p.grams} g`).join(', ')}</div>
                <MacroSummary macros={a.solution.totals} target={a.solution.target} />
              </li>
            ))}
          </ol>
          {running && attempts.length > 0 && <p className="hint">Refining…</p>}
        </section>
      )}

      {error && <p className="error card">{error}</p>}

      {recipe && (
        <section className="card">
          <RecipeView recipe={recipe} />
          <div className="row">
            <button
              type="button"
              disabled={saved}
              onClick={() => {
                update((s) => ({ ...s, recipes: [recipe, ...s.recipes] }))
                setSaved(true)
              }}
            >
              {saved ? 'Saved' : 'Save recipe'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
