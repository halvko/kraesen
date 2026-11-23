import Anthropic from '@anthropic-ai/sdk'
import type { BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type AgentEvent, checkKey, describeError, estimateMacros, generateMeal, type MealRequest, parseEstimate, parseLabelReply, readNutritionLabel } from './claude'
import type { Ware } from './types'

const ware = (id: string, stock: Ware['stock']): Ware => ({
  id,
  name: id,
  source: 'custom',
  per100: { protein: 20, carbs: 10, fat: 5, kcal: 165 },
  stock,
  createdAt: 0,
})

const WARES = [ware('have1', 'home'), ware('cold1', 'freezer'), ware('buy1', 'shop'), ware('buy2', 'shop'), ware('buy3', 'shop'), ware('gone', 'off')]

const req = (shopping: MealRequest['shopping']): MealRequest => ({
  target: { protein: 40, carbs: 20, fat: 10, kcal: 330 },
  shopping,
  wish: '',
  rules: '',
  staples: ['salt', 'black pepper'],
})

type Block = { type: 'tool_use'; id: string; name: string; input: unknown } | { type: 'text'; text: string }

const reply = (content: Block[], stop_reason = 'tool_use'): BetaMessage =>
  ({ id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason, stop_sequence: null, content, usage: {} }) as unknown as BetaMessage

const recipe = (solution_id: string) => ({
  solution_id,
  title: 'Dish',
  summary: 'Nice.',
  extras: [{ staple: 'salt' }],
  steps: ['Cook.'],
})

/** A client whose replies are scripted; records every request's messages and model. */
function scripted(replies: BetaMessage[]) {
  const requests: BetaMessageParam[][] = []
  const models: string[] = []
  const client = {
    beta: {
      messages: {
        create: async (params: { messages: BetaMessageParam[]; model: string }) => {
          requests.push(structuredClone(params.messages))
          models.push(params.model)
          const next = replies.shift()
          if (!next) throw new Error('script ran out')
          return next
        },
      },
    },
  } as unknown as Anthropic
  return { client, requests, models }
}

/** The tool_result blocks the app sent in its last request. */
function lastResults(requests: BetaMessageParam[][]) {
  const msgs = requests[requests.length - 1]
  const content = msgs[msgs.length - 1].content
  return (Array.isArray(content) ? content : []).filter((b) => b.type === 'tool_result') as {
    tool_use_id: string
    content: string
    is_error?: boolean
  }[]
}

const run = (client: Anthropic, shopping: MealRequest['shopping'] = 'few', events: AgentEvent[] = []) =>
  generateMeal(client, req(shopping), WARES, (e) => events.push(e))

describe('generateMeal', () => {
  it('pairs every tool_use with a tool_result, errors on unknown tools, and builds the recipe from the chosen solution', async () => {
    const { client, requests } = scripted([
      reply([
        { type: 'tool_use', id: 'a', name: 'compute_portions', input: { ingredients: [{ ware_id: 'have1' }] } },
        { type: 'tool_use', id: 'b', name: 'make_coffee', input: {} },
      ]),
      reply([{ type: 'tool_use', id: 'c', name: 'submit_recipe', input: recipe('S1') }]),
    ])
    const r = await run(client)
    const results = lastResults(requests)
    expect(results.map((x) => x.tool_use_id)).toEqual(['a', 'b'])
    expect(results[0].is_error).toBe(false)
    expect(JSON.parse(results[0].content).solution_id).toBe('S1')
    expect(results[1].is_error).toBe(true)
    expect(r.title).toBe('Dish')
    expect(r.ingredients.map((i) => i.wareId)).toEqual(['have1'])
    expect(r.ingredients[0].grams).toBeGreaterThan(0)
  })

  it('enforces the shopping limit: none blocks shop foods, a couple allows two', async () => {
    const buyTwo = { ingredients: [{ ware_id: 'have1' }, { ware_id: 'buy1' }, { ware_id: 'buy2' }] }
    const buyThree = { ingredients: [...buyTwo.ingredients, { ware_id: 'buy3' }] }

    const none = scripted([
      reply([{ type: 'tool_use', id: 'a', name: 'compute_portions', input: { ingredients: [{ ware_id: 'buy1' }] } }]),
      reply([{ type: 'tool_use', id: 'b', name: 'submit_recipe', input: recipe('S1') }]),
      reply([{ type: 'tool_use', id: 'c', name: 'compute_portions', input: { ingredients: [{ ware_id: 'have1' }] } }]),
      reply([{ type: 'tool_use', id: 'd', name: 'submit_recipe', input: recipe('S1') }]),
    ])
    await run(none.client, 'none')
    expect(none.requests[1].at(-1)).toMatchObject({ content: [{ is_error: true }] })

    const some = scripted([
      reply([{ type: 'tool_use', id: 'a', name: 'compute_portions', input: buyThree }]),
      reply([{ type: 'tool_use', id: 'b', name: 'compute_portions', input: buyTwo }]),
      reply([{ type: 'tool_use', id: 'c', name: 'submit_recipe', input: recipe('S1') }]),
    ])
    const r = await run(some.client, 'few')
    expect(some.requests[1].at(-1)).toMatchObject({ content: [{ is_error: true }] })
    expect(r.ingredients.filter((i) => i.toBuy)).toHaveLength(2)
  })

  it('never offers foods that are set to Not now', async () => {
    const { client, requests } = scripted([
      reply([{ type: 'tool_use', id: 'a', name: 'compute_portions', input: { ingredients: [{ ware_id: 'gone' }] } }]),
      reply([{ type: 'tool_use', id: 'b', name: 'compute_portions', input: { ingredients: [{ ware_id: 'have1' }] } }]),
      reply([{ type: 'tool_use', id: 'c', name: 'submit_recipe', input: recipe('S1') }]),
    ])
    await run(client)
    expect(requests[0][0].content).not.toContain('gone')
    expect(requests[1].at(-1)).toMatchObject({ content: [{ is_error: true }] })
  })

  it('returns malformed tool inputs to Claude as errors instead of crashing', async () => {
    const { client, requests } = scripted([
      reply([{ type: 'tool_use', id: 'a', name: 'compute_portions', input: { ingredients: [null] } }]),
      reply([{ type: 'tool_use', id: 'b', name: 'compute_portions', input: { ingredients: [{ ware_id: 'have1', max_grams: -5 }] } }]),
      reply([{ type: 'tool_use', id: 'c', name: 'compute_portions', input: { ingredients: [{ ware_id: 'have1' }] } }]),
      reply([{ type: 'tool_use', id: 'd', name: 'submit_recipe', input: { ...recipe('S1'), title: { text: 'x' } } }]),
      reply([{ type: 'tool_use', id: 'e', name: 'submit_recipe', input: { ...recipe('S1'), steps: [{ text: 'x' }] } }]),
      reply([{ type: 'tool_use', id: 'f', name: 'submit_recipe', input: recipe('S9') }]),
      reply([{ type: 'tool_use', id: 'g', name: 'submit_recipe', input: recipe('S1') }]),
    ])
    const r = await run(client)
    for (const i of [1, 2, 4, 5, 6]) expect(requests[i].at(-1)).toMatchObject({ content: [{ is_error: true }] })
    expect(r.steps).toEqual(['Cook.'])
  })

  it('nudges Claude when it answers without tools, and gives up after a bounded number of turns', async () => {
    const chatty = Array.from({ length: 40 }, () => reply([{ type: 'text', text: 'Hmm.' }], 'end_turn'))
    const { client, requests } = scripted(chatty)
    await expect(run(client)).rejects.toThrow('did not finish')
    expect(requests.length).toBeLessThanOrEqual(16)
  })

  const firstPrompt = async (over: Partial<MealRequest> = {}) => {
    const { client, requests } = scripted([
      reply([{ type: 'tool_use', id: 'a', name: 'compute_portions', input: { ingredients: [{ ware_id: 'have1' }] } }]),
      reply([{ type: 'tool_use', id: 'b', name: 'submit_recipe', input: { ...recipe('S1'), extras: [] } }]),
    ])
    await generateMeal(client, { ...req('few'), ...over }, WARES, () => {})
    return requests[0][0].content as string
  }

  it('sends trimmed food rules with the request, and leaves out blank ones', async () => {
    expect(await firstPrompt({ rules: '  pescatarian  ' })).toContain('Food rules (always follow): pescatarian\n')
    expect(await firstPrompt({ rules: '   ' })).not.toContain('Food rules')
  })

  it('lists foods by stock with the staples, and leaves out the shop when shopping is off', async () => {
    const few = await firstPrompt()
    expect(few).toContain('STAPLES: salt, black pepper\n')
    expect(few).toMatch(/HOME \(at home\):\n- have1 /)
    expect(few).toMatch(/FREEZER \(at home, frozen\):\n- cold1 /)
    expect(few).toContain('SHOP (not at home, buy at most 2 different)')
    const none = await firstPrompt({ shopping: 'none', staples: [] })
    expect(none).not.toContain('SHOP')
    expect(none).toContain('STAPLES: (none)')
  })

  it('offers only the staples and water as extras, and sends a recipe back when an extra is anything else', async () => {
    const { client, requests } = scripted([
      reply([{ type: 'tool_use', id: 'a', name: 'compute_portions', input: { ingredients: [{ ware_id: 'have1' }] } }]),
      reply([{ type: 'tool_use', id: 'b', name: 'submit_recipe', input: { ...recipe('S1'), extras: [{ staple: 'salt' }, { staple: 'garlic', amount: '1 clove' }] } }]),
      reply([{ type: 'tool_use', id: 'c', name: 'submit_recipe', input: { ...recipe('S1'), extras: [{ staple: 'Salt', amount: 'to taste' }, { staple: 'water' }] } }]),
    ])
    const tools: unknown[] = []
    const spy = { beta: { messages: { create: (p: { tools: unknown[] }) => (tools.push(p.tools), client.beta.messages.create(p as never)) } } }
    const r = await generateMeal(spy as unknown as Anthropic, req('few'), WARES, () => {})
    expect(JSON.stringify(tools[0])).toContain('"enum":["salt","black pepper","water"]')
    const rejected = lastResults([requests[2]])[0]
    expect(rejected.is_error).toBe(true)
    expect(rejected.content).toContain('"garlic" is not one')
    expect(r.extras).toEqual(['salt, to taste', 'water'])
  })

  it('cooks with freezer foods, and allows any number of shop foods when shopping freely', async () => {
    const all = { ingredients: ['cold1', 'buy1', 'buy2', 'buy3'].map((ware_id) => ({ ware_id, fixed_grams: 50 })) }
    const { client, requests } = scripted([
      reply([{ type: 'tool_use', id: 'a', name: 'compute_portions', input: all }]),
      reply([{ type: 'tool_use', id: 'b', name: 'submit_recipe', input: recipe('S1') }]),
    ])
    const r = await run(client, 'any')
    expect(requests[1].at(-1)).toMatchObject({ content: [{ is_error: false }] })
    expect(r.ingredients.map((i) => [i.wareId, i.toBuy])).toEqual([
      ['cold1', false],
      ['buy1', true],
      ['buy2', true],
      ['buy3', true],
    ])
  })

  it('stops on a refusal', async () => {
    const { client } = scripted([reply([], 'refusal')])
    await expect(run(client)).rejects.toThrow('declined')
  })
})

describe('model', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('plans meals with Claude Sonnet 5.5 on every request', async () => {
    const { client, models } = scripted([
      reply([{ type: 'tool_use', id: 'a', name: 'compute_portions', input: { ingredients: [{ ware_id: 'have1' }] } }]),
      reply([{ type: 'tool_use', id: 'b', name: 'submit_recipe', input: recipe('S1') }]),
    ])
    await run(client)
    expect(models).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5-5'])
  })

  it('reads labels with Claude Sonnet 5.5', async () => {
    const label = { readable: true, name: 'Skyr', brand: 'Arla', protein_g: 11, carbs_g: 4, fat_g: 0.2, kcal: 63, basis_note: '' }
    const { client, models } = scripted([reply([{ type: 'text', text: JSON.stringify(label) }], 'end_turn')])
    await readNutritionLabel(client, 'aGk=', 'image/jpeg')
    expect(models).toEqual(['claude-sonnet-5-5'])
  })

  it('checks the key against Claude Sonnet 5.5', async () => {
    const bodies: { model: string }[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify(reply([{ type: 'text', text: 'Hi' }], 'end_turn')), { headers: { 'content-type': 'application/json' } })
    })
    await checkKey('sk-ant-test')
    expect(bodies.map((b) => b.model)).toEqual(['claude-sonnet-5-5'])
  })
})

describe('parseLabelReply', () => {
  const text = (t: string, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text: t }] }) as unknown as BetaMessage

  it('reads a complete reply', () => {
    const r = parseLabelReply(
      text(JSON.stringify({ readable: true, name: 'Skyr', brand: 'Arla', protein_g: 11, carbs_g: 4, fat_g: 0.2, kcal: 63.4, basis_note: 'Per 100 g.' })),
    )
    expect(r).toEqual({ readable: true, name: 'Skyr', brand: 'Arla', per100: { protein: 11, carbs: 4, fat: 0.2, kcal: 63 }, basis_note: 'Per 100 g.' })
  })

  it('accepts numbers sent as numeric strings', () => {
    const r = parseLabelReply(text(JSON.stringify({ readable: true, protein_g: '5', carbs_g: 1, fat_g: 1, kcal: 30 })))
    expect(r.per100.protein).toBe(5)
  })

  it('passes on an unreadable label', () => {
    expect(parseLabelReply(text(JSON.stringify({ readable: false }))).readable).toBe(false)
  })

  it('gives readable errors for cut-off, empty or nonsensical replies', () => {
    expect(() => parseLabelReply(text('{"readable": tr', 'max_tokens'))).toThrow('cut off')
    expect(() => parseLabelReply({ stop_reason: 'end_turn', content: [] } as unknown as BetaMessage)).toThrow('readable answer')
    expect(() => parseLabelReply(text(JSON.stringify({ readable: true, protein_g: -1, carbs_g: 1, fat_g: 1, kcal: 1 })))).toThrow('do not make sense')
    expect(() => parseLabelReply(text(JSON.stringify({ readable: true, protein_g: 'five', carbs_g: 1, fat_g: 1, kcal: 1 })))).toThrow('do not make sense')
  })
})

describe('describeError', () => {
  const headers = new Headers()
  it('offers a key fix only for key and permission errors', () => {
    const cases: [unknown, string, boolean][] = [
      [new Anthropic.AuthenticationError(401, undefined, 'bad key', headers), 'API key was rejected', true],
      [new Anthropic.PermissionDeniedError(403, undefined, 'no', headers), 'not allowed to use Claude Sonnet 5.5', true],
      [new Anthropic.RateLimitError(429, undefined, 'slow', headers), 'Rate limited', false],
      [new Anthropic.APIConnectionError({ message: 'offline' }), 'Could not reach', false],
      [new Anthropic.InternalServerError(500, undefined, 'boom', headers), 'Claude API error 500', false],
      [new Error('plain'), 'plain', false],
    ]
    for (const [e, message, fix] of cases) {
      const info = describeError(e)
      expect(info.message).toContain(message)
      expect(info.fixKey).toBe(fix)
    }
  })
})


describe('macro lookup', () => {
  const FRIDA = 'https://frida.fooddata.dk/food/1'
  const searched = (url: string) =>
    ({ type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url, title: 'Tomat', encrypted_content: '', page_age: null }] }) as unknown as Block
  const fetched = (url: string) =>
    ({ type: 'web_fetch_tool_result', tool_use_id: 'f1', content: { type: 'web_fetch_result', url, retrieved_at: null, content: {} } }) as unknown as Block
  const input = (over: Record<string, unknown> = {}) => ({
    found: true,
    protein_g: 0.7,
    carbs_g: 2.9,
    fat_g: 0.2,
    fibre_g: 1.2,
    alcohol_g: 0,
    kcal: 18.4,
    source_name: 'Frida: Tomat, rå',
    source_url: FRIDA,
    note: 'Raw.',
    ...over,
  })
  const submit = (over: Record<string, unknown> = {}, id = 'u1') => ({ type: 'tool_use', id, name: 'submit_macros', input: input(over) }) as Block
  const parse = (over: Record<string, unknown> = {}, urls: string[] = [FRIDA]) => parseEstimate(input(over), 'tomat', new Set(urls), new Set(), 1)
  const lookupOf = (r: ReturnType<typeof parse>) => (r.ok && r.value.found ? r.value.lookup : undefined)
  const errorOf = (r: ReturnType<typeof parse>) => (r.ok ? undefined : r.error)

  it('reads macros per 100 g, rounded, with the source and note', () => {
    expect(lookupOf(parse())).toEqual({
      key: 'tomat',
      query: 'tomat',
      per100: { protein: 0.7, carbs: 2.9, fat: 0.2, kcal: 18 },
      source: { name: 'Frida: Tomat, rå', url: FRIDA, note: 'Raw.' },
      createdAt: 1,
    })
  })

  it('links a source only when Claude saw that URL, ignoring a trailing slash', () => {
    expect(lookupOf(parse({}, ['https://usda.gov/x']))?.source.url).toBeUndefined()
    expect(lookupOf(parse({ source_url: FRIDA + '/' }))?.source.url).toBe(FRIDA + '/')
    expect(lookupOf(parse({ source_url: 'javascript:alert(1)' }, ['javascript:alert(1)']))?.source.url).toBeUndefined()
  })

  it('accepts macros up to 100 g per 100 g and rejects more', () => {
    expect(lookupOf(parse({ protein_g: 0, carbs_g: 0, fat_g: 100, fibre_g: 0, kcal: 900 }))).toBeDefined()
    expect(errorOf(parse({ protein_g: 80, carbs_g: 30 }))).toMatch(/more than 100 g/)
  })

  it('rejects energy that does not fit the macros, such as kJ given as kcal', () => {
    expect(errorOf(parse({ kcal: 77 }))).toMatch(/does not fit/)
    expect(errorOf(parse({ protein_g: 20, kcal: 0 }))).toMatch(/does not fit/)
  })

  it('accepts energy that does not fit when Claude sends the same numbers again', () => {
    // Xylitol: 100 g carbohydrate (polyols) and 240 kcal.
    const xylitol = { protein_g: 0, carbs_g: 100, fat_g: 0, fibre_g: 0, kcal: 240 }
    const queried = new Set<string>()
    expect(parseEstimate(input(xylitol), 'xylitol', new Set(), queried).ok).toBe(false)
    expect(parseEstimate(input({ ...xylitol, kcal: 250 }), 'xylitol', new Set(), queried).ok).toBe(false)
    expect(parseEstimate(input(xylitol), 'xylitol', new Set(), queried).ok).toBe(true)
  })

  it('rejects a missing number instead of reading it as 0', () => {
    expect(errorOf(parse({ fibre_g: undefined }))).toMatch(/non-negative/)
  })

  it('counts alcohol and fibre towards energy', () => {
    // Beer: 4.5 g alcohol and 3.6 g carbs give about 46 kcal.
    expect(lookupOf(parse({ protein_g: 0.5, carbs_g: 3.6, fat_g: 0, fibre_g: 0, alcohol_g: 4.5, kcal: 45 }))).toBeDefined()
  })

  it('rejects negative numbers and a missing source name', () => {
    expect(errorOf(parse({ fat_g: -1 }))).toMatch(/non-negative/)
    expect(errorOf(parse({ source_name: ' ' }))).toMatch(/source_name/)
  })

  it('reports a text that is not a food', () => {
    expect(parseEstimate({ ...input(), found: false }, 'asdf', new Set())).toEqual({ ok: true, value: { found: false } })
  })

  it('normalizes the cache key from what the user typed', async () => {
    const { client } = scripted([reply([searched(FRIDA), submit()])])
    const r = await estimateMacros(client, '  Hjemmedyrkede   TOMATER! ')
    expect(r.found && r.lookup.key).toBe('hjemmedyrkede tomater')
  })

  it('resumes a paused search by sending the turn back with no extra message', async () => {
    const { client, requests } = scripted([reply([searched(FRIDA)], 'pause_turn'), reply([submit()])])
    const r = await estimateMacros(client, 'tomat')
    expect(r.found && r.lookup.source.url).toBe(FRIDA)
    expect(requests[1].at(-1)?.role).toBe('assistant')
  })

  it('accepts a source URL that Claude fetched', async () => {
    const { client } = scripted([reply([fetched(FRIDA), submit()])])
    const r = await estimateMacros(client, 'tomat')
    expect(r.found && r.lookup.source.url).toBe(FRIDA)
  })

  it('answers every tool call when the first submission is wrong, and takes a later valid one', async () => {
    const { client, requests } = scripted([
      reply([submit({ kcal: 77 }, 'a'), { type: 'tool_use', id: 'b', name: 'other', input: {} }, submit({ kcal: 300 }, 'c')]),
      reply([submit()]),
    ])
    const r = await estimateMacros(client, 'tomat')
    expect(r.found && r.lookup.per100.kcal).toBe(18)
    const results = requests[1].at(-1)?.content as { tool_use_id: string; is_error?: boolean }[]
    expect(results.map((x) => [x.tool_use_id, x.is_error])).toEqual([
      ['a', true],
      ['b', true],
      ['c', true],
    ])
  })

  it('asks Claude to finish when it replies with text only', async () => {
    const { client, requests } = scripted([reply([{ type: 'text', text: 'Searching…' }], 'end_turn'), reply([submit()])])
    await estimateMacros(client, 'tomat')
    expect(requests[1].at(-1)).toEqual({ role: 'user', content: 'Please finish by calling submit_macros.' })
  })

  it('stops on a refusal or a cut-off reply', async () => {
    await expect(estimateMacros(scripted([reply([], 'refusal')]).client, 'x')).rejects.toThrow(/declined/)
    await expect(estimateMacros(scripted([reply([], 'max_tokens')]).client, 'x')).rejects.toThrow(/cut off/)
  })

  it('gives up after eight turns', async () => {
    const texts = Array.from({ length: 8 }, () => reply([{ type: 'text', text: 'hm' }], 'end_turn'))
    await expect(estimateMacros(scripted(texts).client, 'x')).rejects.toThrow(/did not finish/)
  })

  it('stops when cancelled', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(estimateMacros(scripted([]).client, 'x', ac.signal)).rejects.toThrow(/Cancelled/)
  })
})
