import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { type PortionRequest, type Solution, solvePortions } from './solver'
import { MACRO_KEYS, type Macros, partitionWares, type Recipe, roundMacro, roundMacros, toNonNegative, type Ware } from './types'

const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export function makeClient(apiKey: string) {
  // Direct browser access: the key never leaves this device except to api.anthropic.com.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 })
}

export interface ErrorInfo {
  message: string
  /** True when the user should fix their API key or model in Settings. */
  fixInSettings: boolean
}

/** Classifies an error once, so its message and the action offered for it cannot drift apart. */
export function describeError(e: unknown): ErrorInfo {
  const info = (message: string, fixInSettings = false) => ({ message, fixInSettings })
  if (e instanceof Anthropic.AuthenticationError) return info('The API key was rejected. Check it in Settings.', true)
  if (e instanceof Anthropic.PermissionDeniedError) return info('This API key is not allowed to use that model.', true)
  if (e instanceof Anthropic.RateLimitError) return info('Rate limited by the Claude API. Wait a minute and try again.')
  if (e instanceof Anthropic.APIConnectionError) return info('Could not reach the Claude API. Are you online?')
  if (e instanceof Anthropic.APIError) return info(`Claude API error ${e.status ?? ''}: ${e.message}`)
  return info(e instanceof Error ? e.message : String(e))
}

function textOf(msg: BetaMessage): string {
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
}

// ---------------------------------------------------------------------------
// Nutrition label reading
// ---------------------------------------------------------------------------

export interface LabelReading {
  readable: boolean
  name: string
  brand: string
  per100: Macros
  basis_note: string
}

const LABEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['readable', 'name', 'brand', 'protein_g', 'carbs_g', 'fat_g', 'kcal', 'basis_note'],
  properties: {
    readable: { type: 'boolean', description: 'False if no nutrition table can be read in the photo.' },
    name: { type: 'string', description: 'Product name if visible, else empty string.' },
    brand: { type: 'string', description: 'Brand if visible, else empty string.' },
    protein_g: { type: 'number', description: 'Protein per 100 g (or 100 ml).' },
    carbs_g: { type: 'number', description: 'Total carbohydrate per 100 g, including sugars, excluding fibre.' },
    fat_g: { type: 'number', description: 'Total fat per 100 g.' },
    kcal: { type: 'number', description: 'Energy in kcal per 100 g. Convert from kJ (÷ 4.184) if only kJ is shown.' },
    basis_note: {
      type: 'string',
      description: 'One short sentence on what the label showed, e.g. "Per 100 g column read directly" or "Converted from per 30 g serving".',
    },
  },
} as const

/** Turns Claude's reply about a label photo into a reading, or throws a message the user can act on. */
export function parseLabelReply(msg: Pick<BetaMessage, 'stop_reason' | 'content'>): LabelReading {
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined to read this image.')
  if (msg.stop_reason === 'max_tokens') throw new Error('The label reading was cut off. Please try again.')
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(textOf(msg as BetaMessage))
  } catch {
    throw new Error('Claude did not return a readable answer. Please try again.')
  }
  if (!raw || typeof raw !== 'object') throw new Error('Claude did not return a readable answer. Please try again.')
  if (raw.readable !== true) return { readable: false, name: '', brand: '', per100: { protein: 0, carbs: 0, fat: 0, kcal: 0 }, basis_note: '' }
  const [protein, carbs, fat, kcal] = [raw.protein_g, raw.carbs_g, raw.fat_g, raw.kcal].map(toNonNegative)
  if (protein === undefined || carbs === undefined || fat === undefined || kcal === undefined) {
    throw new Error('Claude returned numbers that do not make sense. Please try again.')
  }
  return {
    readable: true,
    name: typeof raw.name === 'string' ? raw.name : '',
    brand: typeof raw.brand === 'string' ? raw.brand : '',
    per100: { protein, carbs, fat, kcal: Math.round(kcal) },
    basis_note: typeof raw.basis_note === 'string' ? raw.basis_note : '',
  }
}

export async function readNutritionLabel(
  client: Anthropic,
  model: string,
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png',
  signal?: AbortSignal,
): Promise<LabelReading> {
  const msg = await client.beta.messages.create(
    {
      model,
      max_tokens: 4000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: LABEL_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            {
              type: 'text',
              text:
                'This is a photo of a food nutrition label. Read the macronutrients per 100 g. ' +
                'If only a per-serving column is shown, convert to per 100 g using the stated serving size. ' +
                'Carbohydrates means total available carbohydrate (the "Carbohydrate" line, not fibre). ' +
                'Labels may be in any language (e.g. Danish: Protein, Kulhydrat, Fedt, Energi).',
            },
          ],
        },
      ],
    },
    { signal },
  )
  return parseLabelReply(msg)
}

// ---------------------------------------------------------------------------
// Meal generation agent
// ---------------------------------------------------------------------------

export type BuyWillingness = 'none' | 'some' | 'happy'

export const BUY_LIMITS: Record<BuyWillingness, number> = { none: 0, some: 2, happy: Infinity }

export interface MealRequest {
  target: Macros
  willingness: BuyWillingness
  wish: string
}

export type AgentEvent =
  | { kind: 'thinking'; text: string }
  | { kind: 'attempt'; solutionId: string; solution: Solution }
  | { kind: 'rejected'; reason: string }
  | { kind: 'note'; text: string }

function formatMacros(m: Macros) {
  const r = roundMacros(m)
  return { protein_g: r.protein, carbs_g: r.carbs, fat_g: r.fat, kcal: r.kcal }
}

const TOOLS: BetaTool[] = [
  {
    name: 'compute_portions',
    description:
      'Given a set of ingredients (by ware_id) and optional gram bounds, the app computes the exact grams of each ' +
      'that bring the meal closest to the macro target, and returns the grams, the totals and the deviation per macro. ' +
      'Call this with a candidate ingredient set, read the deviations, then adjust the set or bounds and call again. ' +
      'Each call returns a solution_id you can submit.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ingredients'],
      properties: {
        ingredients: {
          type: 'array',
          minItems: 1,
          maxItems: 12,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['ware_id'],
            properties: {
              ware_id: { type: 'string' },
              min_grams: { type: 'number', description: 'Lower bound so the ingredient stays meaningful in the dish.' },
              max_grams: { type: 'number', description: 'Upper bound for a sensible single-person portion (default 600).' },
              fixed_grams: { type: 'number', description: 'Use exactly this amount, e.g. 1 egg = 55 g.' },
            },
          },
        },
      },
    },
  },
  {
    name: 'submit_recipe',
    description:
      'Submit the final recipe built on one solution from compute_portions. Ingredient amounts are taken from that ' +
      'solution exactly, so write the steps using those gram amounts.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['solution_id', 'title', 'summary', 'extras', 'steps'],
      properties: {
        solution_id: { type: 'string' },
        title: { type: 'string' },
        summary: { type: 'string', description: 'One or two sentences describing the dish.' },
        extras: {
          type: 'array',
          items: { type: 'string' },
          description: 'Seasonings with negligible macros not in the computation, e.g. "salt and pepper", "1 tsp cumin".',
        },
        steps: { type: 'array', items: { type: 'string' }, description: 'Cooking steps in order, with amounts and times.' },
        tips: { type: 'string', description: 'Optional serving or variation tips.' },
      },
    },
  },
]

function wareLine(w: Ware) {
  const p = w.per100
  const status = w.status === 'frozen' ? ' [frozen]' : ''
  return `- ${w.id} | ${w.name}${w.brand ? ` (${w.brand})` : ''}${status} | per 100 g: P ${p.protein} C ${p.carbs} F ${p.fat} kcal ${p.kcal}${w.notes ? ` | note: ${w.notes}` : ''}`
}

function buildPrompt(req: MealRequest, have: Ware[], buy: Ware[], limit: number) {
  const buyRule =
    limit === 0
      ? 'The user does not want to buy anything: use only wares from the HAVE list.'
      : limit === Infinity
        ? 'The user is happy to buy wares from the BUY list as needed, though using HAVE wares is still preferred.'
        : `The user is willing to buy at most ${limit} different wares from the BUY list; prefer HAVE wares.`

  const system =
    'You plan single meals for one person who tracks macronutrients. You pick ingredients and write the recipe; ' +
    'the app does all gram arithmetic. Never compute grams or macros yourself.\n\n' +
    'Process:\n' +
    '1. Choose a dish that suits the wares and the wish, and pick a candidate set of ingredients by ware_id.\n' +
    '2. Call compute_portions with culinary bounds (min/max grams) so the dish stays sensible. Use fixed_grams for ' +
    'things that come in units (eggs) or where amounts matter for taste.\n' +
    '3. Read the deviations. If any macro is off by more than about 10 %, change the ingredient set or bounds ' +
    '(swap a fatty item for a lean one, add a carb source, and so on) and call again. Stop after the fit is good ' +
    'or after about 6 attempts, taking the best one.\n' +
    '4. Call submit_recipe with the best solution_id, writing steps that use the exact grams from that solution.\n\n' +
    'Rules:\n' +
    '- Every ingredient with meaningful macros (including cooking oil, butter, sugar, milk) must be a ware passed to ' +
    'compute_portions. If no oil or fat ware is listed, cook without added fat.\n' +
    '- "extras" is only for seasonings with negligible macros: salt, pepper, dried spices, vinegar, water, a few herbs.\n' +
    '- Frozen wares are fine; mention thawing or cooking from frozen in the steps.\n' +
    '- Ingredients that come out at 0 g should be removed from the set before submitting.\n' +
    `- ${buyRule}\n` +
    '- Write in English. Keep steps concrete with times and temperatures.'

  const user =
    `Macro target for this meal: protein ${roundMacro('protein', req.target.protein)} g, carbs ${roundMacro('carbs', req.target.carbs)} g, ` +
    `fat ${roundMacro('fat', req.target.fat)} g, energy ${roundMacro('kcal', req.target.kcal)} kcal.\n` +
    (req.wish.trim() ? `Wish for this meal: ${req.wish.trim()}\n` : '') +
    `\nHAVE (at home, want to use):\n${have.map(wareLine).join('\n') || '(none)'}\n` +
    (limit > 0 ? `\nBUY (willing to buy):\n${buy.map(wareLine).join('\n') || '(none)'}\n` : '')

  return { system, user }
}

interface ComputeIngredient {
  ware_id: string
  min_grams?: number
  max_grams?: number
  fixed_grams?: number
}
interface SubmitInput {
  solution_id: string
  title: string
  summary: string
  extras: string[]
  steps: string[]
  tips?: string
}

/** A tool input checked and rebuilt as its type, or a message telling Claude what was wrong. */
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

type Loose = Record<string, unknown>
const isObj = (v: unknown): v is Loose => !!v && typeof v === 'object' && !Array.isArray(v)
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

function parseCompute(input: unknown): Parsed<ComputeIngredient[]> {
  if (!isObj(input) || !Array.isArray(input.ingredients) || input.ingredients.length === 0) {
    return fail('ingredients must be a non-empty array')
  }
  const out: ComputeIngredient[] = []
  for (const ing of input.ingredients as unknown[]) {
    if (!isObj(ing) || typeof ing.ware_id !== 'string') return fail('Each ingredient must be an object with a string ware_id')
    const bound = (v: unknown) => (v === undefined ? { ok: true as const, n: undefined } : { ok: toNonNegative(v) !== undefined, n: toNonNegative(v) })
    const [min, max, fixed] = [ing.min_grams, ing.max_grams, ing.fixed_grams].map(bound)
    if (!min.ok || !max.ok || !fixed.ok) return fail(`Bounds for ${ing.ware_id} must be non-negative numbers`)
    out.push({ ware_id: ing.ware_id, min_grams: min.n, max_grams: max.n, fixed_grams: fixed.n })
  }
  return { ok: true, value: out }
}

function parseSubmit(input: unknown): Parsed<SubmitInput> {
  if (!isObj(input)) return fail('submit_recipe input must be an object')
  const { solution_id, title, summary, steps, extras, tips } = input
  if (typeof solution_id !== 'string') return fail('solution_id must be a string')
  if (typeof title !== 'string' || !title.trim()) return fail('title must be a non-empty string')
  if (typeof summary !== 'string') return fail('summary must be a string')
  if (!isStringArray(steps) || steps.length === 0) return fail('steps must be a non-empty array of strings')
  if (!isStringArray(extras)) return fail('extras must be an array of strings')
  if (tips !== undefined && typeof tips !== 'string') return fail('tips must be a string')
  return { ok: true, value: { solution_id, title: title.trim(), summary, steps, extras, tips } }
}

export async function generateMeal(
  client: Anthropic,
  model: string,
  req: MealRequest,
  wares: Ware[],
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<Recipe> {
  const { have, buy } = partitionWares(wares)
  const limit = BUY_LIMITS[req.willingness]
  const allowed = new Map((limit > 0 ? [...have, ...buy] : have).map((w) => [w.id, w]))
  if (have.length === 0 && (limit === 0 || buy.length === 0)) {
    throw new Error('No usable wares. Add some to your "Have" list (or allow buying) first.')
  }

  const { system, user } = buildPrompt(req, have, buy, limit)
  const messages: BetaMessageParam[] = [{ role: 'user', content: user }]
  const solutions = new Map<string, Solution>()
  let counter = 0

  const compute = (input: unknown): { content: string; isError: boolean } => {
    const parsed = parseCompute(input)
    if (!parsed.ok) return { content: parsed.error, isError: true }
    const requests: PortionRequest[] = []
    const seen = new Set<string>()
    for (const ing of parsed.value) {
      const w = allowed.get(ing.ware_id)
      if (!w) return { content: `Unknown or not allowed ware_id: ${ing.ware_id}`, isError: true }
      if (seen.has(w.id)) return { content: `Duplicate ware_id: ${w.id}`, isError: true }
      seen.add(w.id)
      requests.push({ ware: w, minGrams: ing.min_grams, maxGrams: ing.max_grams, fixedGrams: ing.fixed_grams })
    }
    const buyCount = requests.filter((r) => r.ware.list === 'buy').length
    if (buyCount > limit) {
      return { content: `Uses ${buyCount} BUY wares but the user allows at most ${limit}.`, isError: true }
    }
    const solution = solvePortions(requests, req.target)
    const id = `S${++counter}`
    solutions.set(id, solution)
    onEvent({ kind: 'attempt', solutionId: id, solution })
    const pct = (k: (typeof MACRO_KEYS)[number]) => `${solution.relativeDeviation[k] >= 0 ? '+' : ''}${Math.round(solution.relativeDeviation[k] * 100)}%`
    return {
      isError: false,
      content: JSON.stringify({
        solution_id: id,
        grams: solution.portions.map((p) => ({ ware_id: p.ware.id, name: p.ware.name, grams: p.grams })),
        totals: formatMacros(solution.totals),
        target: formatMacros(solution.target),
        deviation: Object.fromEntries(MACRO_KEYS.map((k) => [k, pct(k)])),
        worst_deviation_pct: Math.round(solution.worstRelative * 100),
      }),
    }
  }

  for (let turn = 0; turn < 16; turn++) {
    if (signal?.aborted) throw new Error('Cancelled')
    const response = await client.beta.messages.create(
      {
        model,
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: 'medium' },
        system,
        tools: TOOLS,
        messages,
      },
      { signal },
    )

    for (const block of response.content) {
      if (block.type === 'thinking' && block.thinking) onEvent({ kind: 'thinking', text: block.thinking })
      if (block.type === 'text' && block.text.trim()) onEvent({ kind: 'note', text: block.text })
    }

    if (response.stop_reason === 'refusal') throw new Error('Claude declined this request.')
    if (response.stop_reason === 'max_tokens') throw new Error('The response was cut off. Please try again.')

    messages.push({ role: 'assistant', content: response.content as BetaContentBlockParam[] })

    if (response.stop_reason === 'pause_turn') continue

    const toolUses = response.content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use')
    if (toolUses.length === 0) {
      messages.push({ role: 'user', content: 'Please continue: use compute_portions and finish with submit_recipe.' })
      continue
    }

    const results: BetaToolResultBlockParam[] = []
    for (const tu of toolUses) {
      if (tu.name === 'compute_portions') {
        const r = compute(tu.input)
        if (r.isError) onEvent({ kind: 'rejected', reason: r.content })
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.content, is_error: r.isError })
      } else if (tu.name === 'submit_recipe') {
        const parsed = parseSubmit(tu.input)
        const sol = parsed.ok ? solutions.get(parsed.value.solution_id) : undefined
        if (!parsed.ok || !sol) {
          const reason = parsed.ok ? `Unknown solution_id: ${parsed.value.solution_id}` : parsed.error
          onEvent({ kind: 'rejected', reason })
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: reason, is_error: true })
          continue
        }
        const input = parsed.value
        const kept = sol.portions.filter((p) => p.grams > 0)
        return {
          id: crypto.randomUUID(),
          title: input.title,
          summary: input.summary,
          ingredients: kept.map((p) => ({ wareId: p.ware.id, name: p.ware.name, grams: p.grams, fromBuyList: p.ware.list === 'buy' })),
          extras: input.extras,
          steps: input.steps,
          tips: input.tips,
          totals: sol.totals,
          target: sol.target,
          createdAt: Date.now(),
        }
      } else {
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Unknown tool ${tu.name}`, is_error: true })
      }
    }
    messages.push({ role: 'user', content: results })
  }
  throw new Error('Claude did not finish a recipe in time. Try again, perhaps with a looser target.')
}
