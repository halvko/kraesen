import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUnion,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { type PortionRequest, type Solution, solvePortions } from './solver'
import { type FoodLookup, isObj, isWebUrl, MACRO_KEYS, normalizeQuery, type SourceRef, type MealFoods, mealFoods, type Macros, type Recipe, roundMacro, roundMacros, SHOP_LIMITS, type Shopping, toNonNegative, type Ware } from './types'

/** Every Claude call uses this model. */
const MODEL = { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }

const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export function makeClient(apiKey: string) {
  // Direct browser access: the key never leaves this device except to api.anthropic.com.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 })
}

export interface ErrorInfo {
  message: string
  /** True when the fix is a different API key. */
  fixKey: boolean
}

/** Turns an error into a message for the user, and says whether the fix is a different key. */
export function describeError(e: unknown): ErrorInfo {
  const info = (message: string, fixKey = false) => ({ message, fixKey })
  if (e instanceof Anthropic.AuthenticationError) return info('The API key was rejected.', true)
  if (e instanceof Anthropic.PermissionDeniedError) return info(`This API key is not allowed to use ${MODEL.label}.`, true)
  if (e instanceof Anthropic.RateLimitError) return info('Rate limited by the Claude API. Wait a minute and try again.')
  if (e instanceof Anthropic.APIConnectionError) return info('Could not reach the Claude API. Are you online?')
  if (e instanceof Anthropic.APIError && /web.?(search|fetch)/i.test(e.message)) {
    return info(`Claude API error ${e.status ?? ''}: ${e.message} Web search may be turned off for this key's organization in the Claude Console.`)
  }
  if (e instanceof Anthropic.APIError) return info(`Claude API error ${e.status ?? ''}: ${e.message}`)
  return info(e instanceof Error ? e.message : String(e))
}

/** Sends a one-token request with this key. Throws when the key is rejected or the API cannot be reached. */
export async function checkKey(apiKey: string): Promise<void> {
  await makeClient(apiKey).beta.messages.create({
    model: MODEL.id,
    max_tokens: 1,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    messages: [{ role: 'user', content: 'Hi' }],
  })
}

function textOf(msg: BetaMessage): string {
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
}

// ---------------------------------------------------------------------------
// Tool-use loop shared by the macro lookup and the meal agent
// ---------------------------------------------------------------------------

/** What a client tool call produced: a result to send back to Claude, or the loop's final answer. */
type ToolOutcome<T> = { result: string; isError: boolean } | { done: T }

interface ToolLoop<T> {
  system: string
  tools: BetaToolUnion[]
  firstMessage: string
  maxTurns: number
  /** Shows Claude's summarized thinking in the response. */
  thinking?: boolean
  /** Said to Claude when it stops without calling a tool. */
  nudge: string
  /** Error shown when a response hits max_tokens. */
  cutOff: string
  /** Error shown when maxTurns runs out. */
  giveUp: string
  /** Called with each response before its tool calls are handled. */
  onResponse?: (content: BetaMessage['content']) => void
  /** One handler per client tool, by name; the loop answers any other name itself. */
  handlers: Record<string, (input: unknown) => ToolOutcome<T>>
  signal?: AbortSignal
}

/**
 * Sends the conversation, resumes paused server tool turns, and answers every client tool call
 * in a response (an unanswered call would make the next request fail) until a handler is done.
 */
async function runToolLoop<T>(client: Anthropic, loop: ToolLoop<T>): Promise<T> {
  const messages: BetaMessageParam[] = [{ role: 'user', content: loop.firstMessage }]
  for (let turn = 0; turn < loop.maxTurns; turn++) {
    if (loop.signal?.aborted) throw new Error('Cancelled')
    const response = await client.beta.messages.create(
      {
        model: MODEL.id,
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        ...(loop.thinking ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}),
        output_config: { effort: 'medium' },
        system: loop.system,
        tools: loop.tools,
        messages,
      },
      { signal: loop.signal },
    )
    loop.onResponse?.(response.content)
    if (response.stop_reason === 'refusal') throw new Error('Claude declined this request.')
    if (response.stop_reason === 'max_tokens') throw new Error(loop.cutOff)
    messages.push({ role: 'assistant', content: response.content as BetaContentBlockParam[] })
    // The server's tool loop paused; sending the conversation back resumes it.
    if (response.stop_reason === 'pause_turn') continue

    const toolUses = response.content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use')
    if (toolUses.length === 0) {
      messages.push({ role: 'user', content: loop.nudge })
      continue
    }
    const results: BetaToolResultBlockParam[] = []
    for (const tu of toolUses) {
      const handler = Object.hasOwn(loop.handlers, tu.name) ? loop.handlers[tu.name] : undefined
      const outcome: ToolOutcome<T> = handler ? handler(tu.input) : { result: `Unknown tool ${tu.name}`, isError: true }
      if ('done' in outcome) return outcome.done
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: outcome.result, is_error: outcome.isError })
    }
    messages.push({ role: 'user', content: results })
  }
  throw new Error(loop.giveUp)
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
  let raw: unknown
  try {
    raw = JSON.parse(textOf(msg as BetaMessage))
  } catch {
    throw new Error('Claude did not return a readable answer. Please try again.')
  }
  if (!isObj(raw)) throw new Error('Claude did not return a readable answer. Please try again.')
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
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png',
  signal?: AbortSignal,
): Promise<LabelReading> {
  const msg = await client.beta.messages.create(
    {
      model: MODEL.id,
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
// Macro lookup for any food, with web search
// ---------------------------------------------------------------------------

const ESTIMATE_TOOL: BetaTool = {
  name: 'submit_macros',
  description:
    'Submit the macronutrients per 100 g for the food, with the source they came from. Call this once, after ' +
    'searching. If the text is not a food, set found to false and use 0 and empty strings for the rest.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['found', 'protein_g', 'carbs_g', 'fat_g', 'fibre_g', 'alcohol_g', 'kcal', 'source_name', 'source_url', 'note'],
    properties: {
      found: { type: 'boolean', description: 'False if the text does not describe a food or drink.' },
      protein_g: { type: 'number', description: 'Protein per 100 g.' },
      carbs_g: { type: 'number', description: 'Available carbohydrate per 100 g, fibre NOT included.' },
      fat_g: { type: 'number', description: 'Total fat per 100 g.' },
      fibre_g: { type: 'number', description: 'Dietary fibre per 100 g; 0 if unknown.' },
      alcohol_g: { type: 'number', description: 'Alcohol per 100 g; 0 for most foods.' },
      kcal: { type: 'number', description: 'Energy in kcal per 100 g, as the source gives it.' },
      source_name: {
        type: 'string',
        description: 'The database or site and the entry used, e.g. "Frida (DTU Fødevareinstituttet): Tomat, rå".',
      },
      source_url: { type: 'string', description: 'The URL of the page the numbers came from, exactly as found; empty if none.' },
      note: {
        type: 'string',
        description: 'One short English sentence on what was assumed, e.g. "Raw, edible part; fibre subtracted from USDA total carbohydrate".',
      },
    },
  },
}

export const LOOKUP_SYSTEM =
  'You look up the macronutrients per 100 g of a food for a meal-planning app. The user writes in Danish or English, ' +
  'often briefly ("hjemmedyrkede tomater", "rugbrød", "frozen peas").\n\n' +
  'Use web search to find the numbers in a food composition database; do not answer from memory alone. Prefer, in order:\n' +
  '1. Frida, the Danish food composition database (frida.fooddata.dk), from DTU Fødevareinstituttet.\n' +
  '2. USDA FoodData Central (fdc.nal.usda.gov) or another national food composition database.\n' +
  "3. For a branded product, the producer's own page or a shop page that shows the nutrition table.\n" +
  'Use web fetch to read a promising page when the search result alone does not show the numbers.\n\n' +
  'Rules:\n' +
  '- Pick the entry closest to what the user wrote. Home-grown or organic produce uses the ordinary entry. Assume raw ' +
  'and the edible part unless the text says cooked, dried, canned and so on.\n' +
  '- Carbohydrate means available carbohydrate, without fibre. Frida and EU labels already give it that way. USDA ' +
  '"Carbohydrate, by difference" includes fibre: subtract the fibre.\n' +
  '- Energy in kcal; convert from kJ by dividing by 4.184 if only kJ is given.\n' +
  '- Then call submit_macros once. source_url must be a page you actually saw in a search result or fetched.'

export type MacroEstimate = { found: false } | { found: true; lookup: FoodLookup }

/** Every URL Claude saw in a search result or fetched while answering, without a trailing slash. */
function seenUrls(content: BetaMessage['content']): string[] {
  return content.flatMap((b) => {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) return b.content.map((r) => trimSlash(r.url))
    if (b.type === 'web_fetch_tool_result' && b.content.type === 'web_fetch_result') return [trimSlash(b.content.url)]
    return []
  })
}

const trimSlash = (u: string) => u.replace(/\/+$/, '')

/** Energy from the macros (Atwater factors). */
export const atwaterKcal = (m: { protein: number; carbs: number; fat: number; fibre: number; alcohol: number }) =>
  4 * m.protein + 4 * m.carbs + 9 * m.fat + 2 * m.fibre + 7 * m.alcohol

/**
 * submit_macros read into a lookup. energyDoubt is set when the energy does not fit the macros:
 * `numbers` identifies the submission, so the caller can ask once and accept the same numbers again.
 */
export type ParsedEstimate =
  | { ok: false; error: string }
  | { ok: true; value: MacroEstimate; energyDoubt?: { numbers: string; message: string } }

/**
 * Reads submit_macros input into a lookup, or says what was wrong. Macros over 100 g per 100 g or
 * a missing number are errors; energy that does not fit the macros (such as kJ given as kcal) is
 * a doubt for the caller to raise. The source URL is kept only when Claude saw it during this
 * lookup, so a made-up link is never shown as the source.
 */
export function parseEstimate(input: unknown, query: string, urls: Set<string>, now = Date.now()): ParsedEstimate {
  if (!isObj(input)) return fail('submit_macros input must be an object')
  if (input.found !== true) return { ok: true, value: { found: false } }
  const [protein, carbs, fat, fibre, alcohol, kcal] = [input.protein_g, input.carbs_g, input.fat_g, input.fibre_g, input.alcohol_g, input.kcal].map(
    toNonNegative,
  )
  if (protein === undefined || carbs === undefined || fat === undefined || fibre === undefined || alcohol === undefined || kcal === undefined) {
    return fail('All numbers must be non-negative')
  }
  if (protein + carbs + fat + fibre + alcohol > 100.5) return fail('The macros add up to more than 100 g per 100 g. Check the numbers.')
  const expected = atwaterKcal({ protein, carbs, fat, fibre, alcohol })
  const energyDoubt =
    Math.abs(kcal - expected) > Math.max(15, 0.2 * expected)
      ? {
          numbers: JSON.stringify([protein, carbs, fat, fibre, alcohol, kcal]),
          message:
            `kcal ${kcal} does not fit the macros, which give about ${Math.round(expected)} kcal. ` +
            'Check that kcal is not kJ, and that fibre and alcohol are filled in. If these are the numbers the ' +
            'source gives (for example for polyols), submit them again unchanged.',
        }
      : undefined
  const name = typeof input.source_name === 'string' ? input.source_name.trim() : ''
  if (!name) return fail('source_name must name where the numbers came from')
  const rawUrl = typeof input.source_url === 'string' ? input.source_url.trim() : ''
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  const source: SourceRef = { name }
  if (isWebUrl(rawUrl) && urls.has(trimSlash(rawUrl))) source.url = rawUrl
  if (note) source.note = note
  return {
    ok: true,
    value: {
      found: true,
      lookup: { key: normalizeQuery(query), query: query.trim(), per100: roundMacros({ protein, carbs, fat, kcal }), source, createdAt: now },
    },
    ...(energyDoubt ? { energyDoubt } : {}),
  }
}

/** Looks up the macros per 100 g of any food with Claude and web search. The caller caches the result. */
export function estimateMacros(client: Anthropic, query: string, signal?: AbortSignal): Promise<MacroEstimate> {
  const seen = new Set<string>()
  const energyQueried = new Set<string>()
  return runToolLoop<MacroEstimate>(client, {
    system: LOOKUP_SYSTEM,
    tools: [
      { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
      { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 4 },
      ESTIMATE_TOOL,
    ],
    firstMessage: `Food: ${query.trim()}`,
    maxTurns: 8,
    nudge: 'Please finish by calling submit_macros.',
    cutOff: 'The lookup was cut off. Please try again.',
    giveUp: 'Claude did not finish the lookup. Please try again.',
    onResponse: (content) => seenUrls(content).forEach((u) => seen.add(u)),
    handlers: {
      submit_macros: (input) => {
        const parsed = parseEstimate(input, query, seen)
        if (!parsed.ok) return { result: parsed.error, isError: true }
        // Some foods are right and still don't fit (polyols, erythritol): ask once, then accept the same numbers.
        const doubt = parsed.energyDoubt
        if (doubt && !energyQueried.has(doubt.numbers)) {
          energyQueried.add(doubt.numbers)
          return { result: doubt.message, isError: true }
        }
        return { done: parsed.value }
      },
    },
    signal,
  })
}

// ---------------------------------------------------------------------------
// Meal generation agent
// ---------------------------------------------------------------------------

export interface MealRequest {
  target: Macros
  shopping: Shopping
  wish: string
  /** The user's food rules from Settings; empty for none. */
  rules: string
  /** Seasonings the user has and accepts; the only allowed extras. */
  staples: string[]
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

const COMPUTE_TOOL: BetaTool =   {
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
  }

/** Water may always be added; everything else must be one of the user's staples. */
const WATER = 'water'

/**
 * The tools for one request. The extras schema names the user's staples as the
 * only choices, so every extra is a staple by construction.
 */
function toolsFor(staples: string[]): BetaTool[] {
  return [
    COMPUTE_TOOL,
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
            description:
              'Seasonings with negligible macros that are not in the computation. Each is one of STAPLES, or water. ' +
              'Empty when STAPLES is empty and no water is needed.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['staple'],
              properties: {
                staple: { type: 'string', enum: [...staples, WATER] },
                amount: { type: 'string', description: 'Optional, e.g. "1 tsp", "a pinch", "to taste".' },
              },
            },
          },
          steps: { type: 'array', items: { type: 'string' }, description: 'Cooking steps in order, with amounts and times.' },
          tips: {
            type: 'string',
            description:
              'Optional serving or variation tips. Like everything else, tips must not mention any food that is not in ' +
              "the user's lists or STAPLES.",
          },
        },
      },
    },
  ]
}

function wareLine(w: Ware) {
  const p = w.per100
  return `- ${w.id} | ${w.name}${w.brand ? ` (${w.brand})` : ''} | per 100 g: P ${p.protein} C ${p.carbs} F ${p.fat} kcal ${p.kcal}${w.notes ? ` | note: ${w.notes}` : ''}`
}

export function buildPrompt(req: MealRequest, foods: MealFoods) {
  const limit = SHOP_LIMITS[req.shopping]
  const shopRule =
    limit === 0
      ? 'The user does not want to shop: use only HOME and FREEZER foods.'
      : limit === Infinity
        ? 'The user is happy to buy SHOP foods as needed, though HOME and FREEZER foods are still preferred.'
        : `The user is willing to buy at most ${limit} different SHOP foods; prefer HOME and FREEZER foods.`

  const system =
    'You plan single meals for one person who tracks macronutrients. You pick ingredients and write the recipe; ' +
    'the app does all gram arithmetic. Never compute grams or macros yourself.\n\n' +
    'Process:\n' +
    '1. Choose a dish that suits the foods and the wish, and pick a candidate set of ingredients by ware_id.\n' +
    '2. Call compute_portions with culinary bounds (min/max grams) so the dish stays sensible. Use fixed_grams for ' +
    'things that come in units (eggs) or where amounts matter for taste.\n' +
    '3. Read the deviations. If any macro is off by more than about 10 %, change the ingredient set or bounds ' +
    '(swap a fatty item for a lean one, add a carb source, and so on) and call again. Stop after the fit is good ' +
    'or after about 6 attempts, taking the best one.\n' +
    '4. Call submit_recipe with the best solution_id, writing steps that use the exact grams from that solution.\n\n' +
    'Whitelist (strict):\n' +
    "- The user's lists below are the ONLY foods available. Never use, suggest or mention any other food: not as an " +
    'ingredient, garnish, extra, tip or variation. The user may be on a restricted diet.\n' +
    '- Food rules are hard rules. They override the wish and everything else. If a listed food conflicts with a rule, ' +
    'do not use it.\n' +
    '- Extras may only come from STAPLES. Water is always allowed. If STAPLES is empty, use no extras other than water.\n\n' +
    'Other rules:\n' +
    '- Every ingredient with meaningful macros (including cooking oil, butter, sugar, milk) must be a food passed to ' +
    'compute_portions. If no oil or fat is listed, cook without added fat.\n' +
    '- FREEZER foods are frozen: include thawing or cook-from-frozen steps.\n' +
    '- Ingredients that come out at 0 g should be removed from the set before submitting.\n' +
    `- ${shopRule}\n` +
    '- Write in English. Keep steps concrete with times and temperatures.'

  const group = (title: string, ws: Ware[]) => `\n${title}:\n${ws.map(wareLine).join('\n') || '(none)'}\n`
  const shopTitle = limit === Infinity ? 'SHOP (not at home, willing to buy)' : `SHOP (not at home, buy at most ${limit} different)`
  const user =
    `Macro target for this meal: protein ${roundMacro('protein', req.target.protein)} g, carbs ${roundMacro('carbs', req.target.carbs)} g, ` +
    `fat ${roundMacro('fat', req.target.fat)} g, energy ${roundMacro('kcal', req.target.kcal)} kcal.\n` +
    (req.rules.trim() ? `Food rules (always follow): ${req.rules.trim()}\n` : '') +
    (req.wish.trim() ? `Wish for this meal: ${req.wish.trim()}\n` : '') +
    `STAPLES: ${req.staples.join(', ') || '(none)'}\n` +
    group('HOME (at home)', foods.home) +
    group('FREEZER (at home, frozen)', foods.freezer) +
    (limit > 0 ? group(shopTitle, foods.shop) : '')

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

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

function parseCompute(input: unknown): Parsed<ComputeIngredient[]> {
  if (!isObj(input) || !Array.isArray(input.ingredients) || input.ingredients.length === 0) {
    return fail('ingredients must be a non-empty array')
  }
  const out: ComputeIngredient[] = []
  for (const ing of input.ingredients as unknown[]) {
    if (!isObj(ing) || typeof ing.ware_id !== 'string') return fail('Each ingredient must be an object with a string ware_id')
    if ([ing.min_grams, ing.max_grams, ing.fixed_grams].some((v) => v !== undefined && toNonNegative(v) === undefined)) {
      return fail(`Bounds for ${ing.ware_id} must be non-negative numbers`)
    }
    out.push({
      ware_id: ing.ware_id,
      min_grams: toNonNegative(ing.min_grams),
      max_grams: toNonNegative(ing.max_grams),
      fixed_grams: toNonNegative(ing.fixed_grams),
    })
  }
  return { ok: true, value: out }
}

/** Reads one extra as "staple, amount", or says why it is not allowed. Staples match ignoring case. */
function parseExtra(v: unknown, staples: string[]): Parsed<string> {
  if (!isObj(v) || typeof v.staple !== 'string') return fail('Each extra must be an object with a string staple')
  if (v.amount !== undefined && typeof v.amount !== 'string') return fail('An extra\'s amount must be a string')
  const wanted = v.staple.trim().toLowerCase()
  const staple = [...staples, WATER].find((st) => st.toLowerCase() === wanted)
  if (!staple) {
    return fail(`Extras may only come from STAPLES (${staples.join(', ') || 'none'}) or water. "${v.staple}" is not one. Remove it and submit again.`)
  }
  const amount = v.amount?.trim()
  return { ok: true, value: amount ? `${staple}, ${amount}` : staple }
}

function parseSubmit(input: unknown, staples: string[]): Parsed<SubmitInput> {
  if (!isObj(input)) return fail('submit_recipe input must be an object')
  const { solution_id, title, summary, steps, extras, tips } = input
  if (typeof solution_id !== 'string') return fail('solution_id must be a string')
  if (typeof title !== 'string' || !title.trim()) return fail('title must be a non-empty string')
  if (typeof summary !== 'string') return fail('summary must be a string')
  if (!isStringArray(steps) || steps.length === 0) return fail('steps must be a non-empty array of strings')
  if (!Array.isArray(extras)) return fail('extras must be an array')
  const extraLines: string[] = []
  for (const e of extras) {
    const parsed = parseExtra(e, staples)
    if (!parsed.ok) return parsed
    extraLines.push(parsed.value)
  }
  if (tips !== undefined && typeof tips !== 'string') return fail('tips must be a string')
  return { ok: true, value: { solution_id, title: title.trim(), summary, steps, extras: extraLines, tips } }
}

export async function generateMeal(
  client: Anthropic,
  req: MealRequest,
  wares: Ware[],
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<Recipe> {
  const foods = mealFoods(wares, req.shopping)
  const limit = SHOP_LIMITS[req.shopping]
  const allowed = new Map(foods.all.map((w) => [w.id, w]))
  if (allowed.size === 0) {
    throw new Error('No foods to cook with. Set some foods to Home or Freezer in Kitchen, or allow shopping.')
  }

  const { system, user } = buildPrompt(req, foods)
  const tools = toolsFor(req.staples)
  const solutions = new Map<string, Solution>()
  let counter = 0

  const compute = (input: unknown): ToolOutcome<Recipe> => {
    const parsed = parseCompute(input)
    if (!parsed.ok) return { result: parsed.error, isError: true }
    const requests: PortionRequest[] = []
    const seen = new Set<string>()
    for (const ing of parsed.value) {
      const w = allowed.get(ing.ware_id)
      if (!w) return { result: `Unknown or not offered ware_id: ${ing.ware_id}. Use only the listed foods.`, isError: true }
      if (seen.has(w.id)) return { result: `Duplicate ware_id: ${w.id}`, isError: true }
      seen.add(w.id)
      requests.push({ ware: w, minGrams: ing.min_grams, maxGrams: ing.max_grams, fixedGrams: ing.fixed_grams })
    }
    const shopCount = requests.filter((r) => r.ware.stock === 'shop').length
    if (shopCount > limit) {
      return { result: `Uses ${shopCount} SHOP foods but the user allows at most ${limit}.`, isError: true }
    }
    const solution = solvePortions(requests, req.target)
    const id = `S${++counter}`
    solutions.set(id, solution)
    onEvent({ kind: 'attempt', solutionId: id, solution })
    const pct = (k: (typeof MACRO_KEYS)[number]) => `${solution.relativeDeviation[k] >= 0 ? '+' : ''}${Math.round(solution.relativeDeviation[k] * 100)}%`
    return {
      isError: false,
      result: JSON.stringify({
        solution_id: id,
        grams: solution.portions.map((p) => ({ ware_id: p.ware.id, name: p.ware.name, grams: p.grams })),
        totals: formatMacros(solution.totals),
        target: formatMacros(solution.target),
        deviation: Object.fromEntries(MACRO_KEYS.map((k) => [k, pct(k)])),
        worst_deviation_pct: Math.round(solution.worstRelative * 100),
      }),
    }
  }

  const submit = (input: unknown): ToolOutcome<Recipe> => {
    const parsed = parseSubmit(input, req.staples)
    const sol = parsed.ok ? solutions.get(parsed.value.solution_id) : undefined
    if (!parsed.ok || !sol) {
      const reason = parsed.ok ? `Unknown solution_id: ${parsed.value.solution_id}` : parsed.error
      onEvent({ kind: 'rejected', reason })
      return { result: reason, isError: true }
    }
    const recipe = parsed.value
    const kept = sol.portions.filter((p) => p.grams > 0)
    return {
      done: {
        id: crypto.randomUUID(),
        title: recipe.title,
        summary: recipe.summary,
        ingredients: kept.map((p) => ({ wareId: p.ware.id, name: p.ware.name, grams: p.grams, toBuy: p.ware.stock === 'shop' })),
        extras: recipe.extras,
        steps: recipe.steps,
        tips: recipe.tips,
        totals: sol.totals,
        target: sol.target,
        createdAt: Date.now(),
      },
    }
  }

  return runToolLoop<Recipe>(client, {
    system,
    tools,
    firstMessage: user,
    maxTurns: 16,
    thinking: true,
    nudge: 'Please continue: use compute_portions and finish with submit_recipe.',
    cutOff: 'The response was cut off. Please try again.',
    giveUp: 'Claude did not finish a recipe in time. Try again, perhaps with a looser target.',
    onResponse: (content) => {
      for (const block of content) {
        if (block.type === 'thinking' && block.thinking) onEvent({ kind: 'thinking', text: block.thinking })
        if (block.type === 'text' && block.text.trim()) onEvent({ kind: 'note', text: block.text })
      }
    },
    handlers: {
      compute_portions: (input) => {
        const r = compute(input)
        if ('result' in r && r.isError) onEvent({ kind: 'rejected', reason: r.result })
        return r
      },
      submit_recipe: submit,
    },
    signal,
  })
}
