import type Anthropic from '@anthropic-ai/sdk'
import type { BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { describe, expect, it } from 'vitest'
import { type AgentEvent, generateMeal, type MealRequest, parseLabelReply } from './claude'
import type { Ware } from './types'

const ware = (id: string, list: Ware['list'], status: Ware['status'] = 'available'): Ware => ({
  id,
  name: id,
  source: 'custom',
  per100: { protein: 20, carbs: 10, fat: 5, kcal: 165 },
  list,
  status,
  createdAt: 0,
})

const WARES = [ware('have1', 'have'), ware('have2', 'have'), ware('buy1', 'buy'), ware('buy2', 'buy'), ware('buy3', 'buy'), ware('gone', 'have', 'out')]

const req = (willingness: MealRequest['willingness']): MealRequest => ({
  target: { protein: 40, carbs: 20, fat: 10, kcal: 330 },
  willingness,
  wish: '',
})

type Block = { type: 'tool_use'; id: string; name: string; input: unknown } | { type: 'text'; text: string }

const reply = (content: Block[], stop_reason = 'tool_use'): BetaMessage =>
  ({ id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason, stop_sequence: null, content, usage: {} }) as unknown as BetaMessage

const recipe = (solution_id: string) => ({
  solution_id,
  title: 'Dish',
  summary: 'Nice.',
  extras: ['salt'],
  steps: ['Cook.'],
})

/** A client whose replies are scripted; records every request's messages. */
function scripted(replies: BetaMessage[]) {
  const requests: BetaMessageParam[][] = []
  const client = {
    beta: {
      messages: {
        create: async (params: { messages: BetaMessageParam[] }) => {
          requests.push(structuredClone(params.messages))
          const next = replies.shift()
          if (!next) throw new Error('script ran out')
          return next
        },
      },
    },
  } as unknown as Anthropic
  return { client, requests }
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

const run = (client: Anthropic, willingness: MealRequest['willingness'] = 'some', events: AgentEvent[] = []) =>
  generateMeal(client, 'claude-opus-5-5', req(willingness), WARES, (e) => events.push(e))

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

  it('enforces the buy limit: none blocks buying, some allows two', async () => {
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
    const r = await run(some.client, 'some')
    expect(some.requests[1].at(-1)).toMatchObject({ content: [{ is_error: true }] })
    expect(r.ingredients.filter((i) => i.fromBuyList)).toHaveLength(2)
  })

  it('never offers wares that are out', async () => {
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

  it('stops on a refusal', async () => {
    const { client } = scripted([reply([], 'refusal')])
    await expect(run(client)).rejects.toThrow('declined')
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
