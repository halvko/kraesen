import { useEffect, useRef, useState } from 'react'
import { type AgentEvent, type Shopping, SHOPPING_LABEL } from '../claude'
import { useStore } from '../store'
import { MACRO_KEYS, type Macros, offered, type Recipe, roundMacro, STOCKS, zeroMacros } from '../types'
import { FoodRow } from './FoodRow'
import { MacroInputs, MacroSummary } from './MacroInputs'
import { GoalsForm, KeyForm, RulesForm } from './ProfileForms'
import { RecipeView } from './RecipeView'
import { Sheet } from './Sheet'

const SHARES = [
  { label: '¼', value: 0.25 },
  { label: '⅓', value: 1 / 3 },
  { label: '½', value: 0.5 },
]

const SHOPPINGS: Shopping[] = ['none', 'few', 'any']

const scale = (m: Macros, f: number): Macros => Object.fromEntries(MACRO_KEYS.map((k) => [k, roundMacro(k, m[k] * f)])) as Macros

const macroLine = (m: Macros) => `${m.protein} g protein · ${m.carbs} g carbs · ${m.fat} g fat · ${m.kcal} kcal`

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Joins with commas and a final "and". */
const joinAnd = (parts: string[]) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`)

/** An attempt's ingredients, leaving out any the solver set to 0 g. */
const portionLine = (a: Extract<AgentEvent, { kind: 'attempt' }>) =>
  a.solution.portions
    .filter((p) => p.grams > 0)
    .map((p) => `${p.ware.name} ${p.grams} g`)
    .join(', ')

type SheetKind = 'goals' | 'rules' | 'key' | 'stock'

interface Props {
  goToKitchen: () => void
}

export function CookPage({ goToKitchen }: Props) {
  const { state, update } = useStore()
  const [sheet, setSheet] = useState<SheetKind | null>(null)
  const close = () => setSheet(null)

  const sheets = (
    <>
      {sheet === 'goals' && (
        <Sheet title="Your daily goals" onClose={close}>
          <GoalsForm onSaved={close} />
        </Sheet>
      )}
      {sheet === 'rules' && (
        <Sheet title="Food rules" onClose={close}>
          <RulesForm onSaved={close} />
        </Sheet>
      )}
      {sheet === 'key' && (
        <Sheet title="Claude API key" onClose={close}>
          <KeyForm onSaved={close} />
        </Sheet>
      )}
      {sheet === 'stock' && <StockSheet onClose={close} />}
    </>
  )

  const foods = offered(state.wares)
  const steps: { kind: SheetKind | 'foods'; title: string; hint: string; done: boolean }[] = [
    { kind: 'goals', title: 'Your daily goals', hint: 'Protein, carbs, fat and energy for a whole day.', done: !!state.profile },
    {
      kind: 'rules',
      title: 'Food rules',
      hint: 'Diet, allergies, things you never eat. Claude always follows them.',
      done: state.settings.rulesAnswered,
    },
    { kind: 'key', title: 'Claude API key', hint: 'Plans meals and reads labels. Stays in this browser.', done: !!state.settings.apiKey },
    {
      kind: 'foods',
      title: 'Add your first foods',
      hint: 'What is in your kitchen? Claude cooks only with what you list.',
      done: foods.home.length + foods.freezer.length > 0,
    },
  ]

  if (steps.some((s) => !s.done)) {
    const next = steps.find((s) => !s.done)
    return (
      <div className="page">
        <section className="card setup">
          <h2>Welcome to Kraesen</h2>
          <p className="hint">Four short steps, and Claude can plan your first meal.</p>
          <ol className="setup-steps">
            {steps.map((s) => (
              <li key={s.kind} className={s.done ? 'done' : s === next ? 'next' : ''}>
                <span className="tick" aria-hidden="true">
                  {s.done ? '✓' : ''}
                </span>
                <div>
                  <strong>{s.title}</strong>
                  <span className="hint">{s.hint}</span>
                </div>
                <button
                  type="button"
                  className={s === next ? '' : 'secondary'}
                  aria-label={`${s.done ? 'Change' : 'Start'}: ${s.title}`}
                  onClick={() => (s.kind === 'foods' ? goToKitchen() : setSheet(s.kind))}
                >
                  {s.done ? 'Change' : 'Start'}
                </button>
              </li>
            ))}
          </ol>
        </section>
        {sheets}
      </div>
    )
  }

  return (
    <div className="page">
      {state.upgradeNotice && (
        <section className="card notice" role="status">
          <p>
            Foods now have one setting: Home, Freezer, Shop or Not now. Extras like salt now come only from your Staples. Add them in
            Kitchen.
          </p>
          <div className="row">
            <button type="button" onClick={goToKitchen}>
              Open Kitchen
            </button>
            <button type="button" className="secondary" onClick={() => update((s) => ({ ...s, upgradeNotice: false }))}>
              Got it
            </button>
          </div>
        </section>
      )}
      <Planner openSheet={setSheet} goToKitchen={goToKitchen} />
      {sheets}
    </div>
  )
}

function Planner({ openSheet, goToKitchen }: { openSheet: (k: SheetKind) => void; goToKitchen: () => void }) {
  const { state, update } = useStore()
  const daily = state.profile?.dailyGoals ?? zeroMacros()
  const rules = state.profile?.foodPreferences ?? ''
  const staples = state.profile?.staples ?? []
  const foods = offered(state.wares)

  const [share, setShare] = useState<number | null>(1 / 3)
  const [target, setTarget] = useState<Macros>(() => scale(daily, 1 / 3))
  const [adjusting, setAdjusting] = useState(false)
  const [shoppingChoice, setShopping] = useState<Shopping>('none')
  const [wish, setWish] = useState('')
  const [running, setRunning] = useState(false)
  const [editing, setEditing] = useState(false)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [error, setError] = useState<{ message: string; fixInSettings: boolean } | null>(null)
  const [saved, setSaved] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  // With nothing set to Shop there is nothing to buy, whatever was picked before.
  const shopping: Shopping = foods.shop.length > 0 ? shoppingChoice : 'none'
  const usable = foods.home.length + foods.freezer.length + (shopping === 'none' ? 0 : foods.shop.length)

  const pickShare = (v: number) => {
    setShare(v)
    setTarget(scale(daily, v))
  }

  const run = async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setRunning(true)
    setEditing(false)
    setEvents([])
    setRecipe(null)
    setError(null)
    setSaved(false)
    // The Claude SDK is loaded on first use to keep the initial download small.
    const { describeError, generateMeal, makeClient } = await import('../claude')
    try {
      const r = await generateMeal(
        makeClient(state.settings.apiKey),
        state.settings.model,
        { target, shopping, wish, rules, staples },
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
  const latest = attempts.at(-1)
  const collapsed = running || (!!recipe && !editing)

  const shareLabel = SHARES.find((s) => share !== null && Math.abs(share - s.value) < 1e-6)?.label
  const summary = [
    shareLabel ? `${shareLabel} of my day` : `${target.kcal} kcal`,
    foods.shop.length > 0 ? SHOPPING_LABEL[shopping].toLowerCase() : '',
    wish.trim() ? `“${wish.trim()}”` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const stockParts = [
    foods.home.length ? `${plural(foods.home.length, 'food')} at home` : '',
    foods.freezer.length ? `${foods.freezer.length} in the freezer` : '',
    shopping !== 'none' && foods.shop.length ? `${foods.shop.length} from the shop` : '',
  ].filter(Boolean)

  return (
    <>
      {collapsed ? (
        <section className="card collapsed">
          <p className="request-summary">
            <strong>Your request:</strong> {summary}
          </p>
          <div className="row">
            {running ? (
              <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            ) : (
              <button type="button" className="link" onClick={() => setEditing(true)}>
                Change request
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="card">
          <h2>Plan a meal</h2>
          <div className="field">
            <span className="field-label">How big a meal?</span>
            <div className="row">
              {SHARES.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className={share !== null && Math.abs(share - s.value) < 1e-6 ? 'chip active' : 'chip'}
                  aria-pressed={share !== null && Math.abs(share - s.value) < 1e-6}
                  onClick={() => pickShare(s.value)}
                >
                  {s.label}
                </button>
              ))}
              <span className="hint">of my day</span>
            </div>
            <p className="hint">
              {macroLine(target)}.{' '}
              <button type="button" className="link" aria-expanded={adjusting} onClick={() => setAdjusting((v) => !v)}>
                {adjusting ? 'Done' : 'Adjust'}
              </button>
            </p>
            {adjusting && (
              <MacroInputs
                idPrefix="target"
                value={target}
                onChange={(m) => {
                  setTarget(m)
                  setShare(null)
                }}
              />
            )}
          </div>

          {foods.shop.length > 0 && (
            <div className="field">
              <span className="field-label">Shopping</span>
              <div className="segmented wide" role="radiogroup" aria-label="Shopping">
                {SHOPPINGS.map((s) => (
                  <button key={s} type="button" role="radio" className={shopping === s ? 'on' : ''} aria-checked={shopping === s} onClick={() => setShopping(s)}>
                    {SHOPPING_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label>
            <span className="field-label">Anything in mind?</span>
            <input value={wish} onChange={(e) => setWish(e.target.value)} placeholder="something warm, quick lunch, no oven" />
          </label>

          <ul className="context-lines">
            <li>
              Using {stockParts.length ? joinAnd(stockParts) : 'no foods'}.{' '}
              <button type="button" className="link" onClick={() => openSheet('stock')}>
                Check what's in
              </button>
            </li>
            <li>
              {rules ? `Rules: ${rules.replace(/[.\s]+$/, '')}.` : 'No food rules.'}{' '}
              <button type="button" className="link" onClick={() => openSheet('rules')}>
                {rules ? 'Edit' : 'Add'}
              </button>
            </li>
            <li>
              {staples.length ? `Seasonings: ${staples.join(', ')}.` : 'No seasonings listed, so no salt or spices.'}{' '}
              <button type="button" className="link" onClick={goToKitchen}>
                {staples.length ? 'Edit' : 'Add'}
              </button>
            </li>
          </ul>

          <button type="button" onClick={run} disabled={usable === 0}>
            Make a meal
          </button>
          {usable === 0 && <p className="hint">Set a food to Home or Freezer first, or allow shopping.</p>}
        </section>
      )}

      {(running || attempts.length > 0) && (
        <section className="card progress" aria-live="polite">
          {running && <h3>{latest ? `Trying combination ${attempts.length + 1}…` : 'Claude is choosing ingredients…'}</h3>}
          {running && latest && (
            <div>
              <p className="hint">Latest fit</p>
              <div className="attempt-ingredients">{portionLine(latest)}</div>
              <MacroSummary macros={latest.solution.totals} target={latest.solution.target} />
            </div>
          )}
          {!running && <p className="hint">{attempts.length === 1 ? 'Fitted in one try.' : `Fitted in ${attempts.length} tries.`}</p>}
          {(running ? attempts.length > 1 : attempts.length > 0) && (
            <details>
              <summary>Show attempts ({attempts.length})</summary>
              <ol>
                {attempts.map((a) => (
                  <li key={a.solutionId}>
                    <div className="attempt-ingredients">{portionLine(a)}</div>
                    <MacroSummary macros={a.solution.totals} target={a.solution.target} />
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>
      )}

      {error && (
        <div className="error card" role="alert">
          <p>{error.message}</p>
          {error.fixInSettings && (
            <button type="button" className="secondary" onClick={() => openSheet('key')}>
              Fix the key
            </button>
          )}
        </div>
      )}

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
              {saved ? 'Saved' : 'Save'}
            </button>
            <button type="button" className="secondary" onClick={run} disabled={running}>
              Try another
            </button>
          </div>
        </section>
      )}
    </>
  )
}

/** Every food Claude may see, with its stock control, so stale stock can be fixed without leaving Cook. */
function StockSheet({ onClose }: { onClose: () => void }) {
  const { state } = useStore()
  // The order is fixed when the sheet opens, so a food set to Not now stays in place and can be set back.
  const [ids] = useState(() =>
    state.wares
      .filter((w) => w.stock !== 'off')
      .sort((a, b) => STOCKS.indexOf(a.stock) - STOCKS.indexOf(b.stock) || a.name.localeCompare(b.name))
      .map((w) => w.id),
  )
  const shown = ids.flatMap((id) => state.wares.filter((w) => w.id === id))
  return (
    <Sheet title="Check what's in" onClose={onClose}>
      <p className="hint">Ran out of something? Set it to Shop if you would buy it, or Not now.</p>
      {shown.length === 0 ? (
        <p className="hint">No foods yet. Add some in Kitchen.</p>
      ) : (
        <ul className="ware-list">
          {shown.map((w) => (
            <FoodRow key={w.id} food={w} />
          ))}
        </ul>
      )}
    </Sheet>
  )
}
