/**
 * The turn loop, exercised end to end with the provider stubbed.
 *
 * This is the part that has never run for real — the account has no credits —
 * and it is where the assistant's promises actually hold or fail:
 *
 *   - a read tool runs and its result reaches the model;
 *   - a write tool produces a proposal and changes nothing;
 *   - a tool that throws becomes data the model can explain, not a dead turn;
 *   - the transcript replays in an order the API will accept;
 *   - a model that never stops calling tools is cut off.
 *
 * `fetch` is replaced rather than the client, so the real request building,
 * retry policy and response parsing are all still under test.
 *
 * Requires DATABASE_URL. Uses its own tenant and cleans up.
 */
import { before, after, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-not-used'

const TENANT = `ai-orch-${randomUUID().slice(0, 8)}`
const ADMIN = 910001

const realFetch = globalThis.fetch

/** Queued provider replies, consumed one per model call. */
let scripted: any[] = []
/** Every request body the code sent, so the conversation shape can be inspected. */
let sentBodies: any[] = []

function assistantSays(content: string) {
  return { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { total_tokens: 10 } }
}

function assistantCallsTool(name: string, args: Record<string, unknown>, id = `call_${randomUUID().slice(0, 6)}`) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { total_tokens: 20 },
  }
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')

  const { upsertSettings } = await import('../entitlement.js')
  await upsertSettings({ tenant: TENANT, enabled: true, chatLimit: 100, limitPeriod: 'monthly', updatedBy: 'test' })

  globalThis.fetch = (async (_url: any, init: any) => {
    sentBodies.push(JSON.parse(init.body))
    const next = scripted.shift()
    if (!next) throw new Error('the test ran out of scripted provider replies')
    return {
      ok: true,
      status: 200,
      json: async () => next,
      text: async () => JSON.stringify(next),
    }
  }) as any
})

beforeEach(() => {
  scripted = []
  sentBodies = []
})

after(async () => {
  globalThis.fetch = realFetch
  const { db } = await import('@src/db/client.js')
  const { aiConversations, aiMessages, aiActionProposals, aiWhitelabelSettings } = await import('@shared/db/schema.js')
  const { eq } = await import('drizzle-orm')
  await db.delete(aiActionProposals).where(eq(aiActionProposals.tenant, TENANT))
  await db.delete(aiMessages).where(eq(aiMessages.tenant, TENANT))
  await db.delete(aiConversations).where(eq(aiConversations.tenant, TENANT))
  await db.delete(aiWhitelabelSettings).where(eq(aiWhitelabelSettings.tenant, TENANT))
})

/** A context carrying whatever permissions a case needs, and nothing more. */
const ctx = (permissions: Array<{ domain: string; actions: string[] }> = []) => ({
  user: { sub: String(ADMIN), roles: [] },
  permissions,
  tenant: TENANT,
  whitelabel: { id: TENANT },
})

const CASINO_MANAGER = [{ domain: 'casino', actions: ['manage'] }]

async function runTurn(
  message: string,
  conversationId?: string,
  permissions: Array<{ domain: string; actions: string[] }> = []
) {
  const { runTurn: run } = await import('../orchestrator.js')
  return run({
    tenant: TENANT,
    adminUserId: ADMIN,
    conversationId: conversationId ?? null,
    message,
    ctx: ctx(permissions),
  })
}

describe('assistant turn loop', () => {
  it('returns the reply when the model answers without tools', async () => {
    scripted = [assistantSays('There are 642 players.')]
    const turn = await runTurn('how many players?')
    assert.equal(turn.reply, 'There are 642 players.')
    assert.deepEqual(turn.proposals, [])
    assert.deepEqual(turn.toolsUsed, [])
  })

  it('sends the system prompt and the operator message on the first call', async () => {
    scripted = [assistantSays('ok')]
    await runTurn('a question')
    const messages = sentBodies[0].messages
    assert.equal(messages[0].role, 'system')
    assert.match(messages[0].content, /admin portal/i)
    assert.equal(messages.at(-1).role, 'user')
    assert.equal(messages.at(-1).content, 'a question')
  })

  it('offers the tool catalogue to the model', async () => {
    scripted = [assistantSays('ok')]
    await runTurn('anything')
    const tools = sentBodies[0].tools
    assert.ok(Array.isArray(tools) && tools.length > 20, 'the catalogue should be offered')
    assert.ok(tools.every((t: any) => t.type === 'function' && t.function?.name))
  })

  it('runs a read tool and feeds its result back as untrusted data', async () => {
    scripted = [assistantCallsTool('list_whitelabels', {}), assistantSays('Two whitelabels.')]
    const turn = await runTurn('list the whitelabels')

    assert.deepEqual(turn.toolsUsed, ['list_whitelabels'])
    assert.equal(turn.reply, 'Two whitelabels.')

    const second = sentBodies[1].messages
    const toolMessage = second.at(-1)
    assert.equal(toolMessage.role, 'tool', 'the result must come back as a tool message')
    assert.match(
      toolMessage.content,
      /untrusted_database_content/,
      'results are labelled so their contents cannot pass as instructions'
    )
  })

  it('places a tool reply directly after the assistant message that asked for it', async () => {
    // The API rejects a tool message that does not follow its tool_calls message.
    scripted = [assistantCallsTool('list_whitelabels', {}), assistantSays('done')]
    await runTurn('list them')

    const messages = sentBodies[1].messages
    const toolIndex = messages.findIndex((m: any) => m.role === 'tool')
    assert.ok(toolIndex > 0)
    const preceding = messages[toolIndex - 1]
    assert.equal(preceding.role, 'assistant')
    assert.ok(preceding.tool_calls?.length, 'the message before a tool reply must be the one that requested it')
    assert.equal(messages[toolIndex].tool_call_id, preceding.tool_calls[0].id, 'ids must match')
  })

  it('turns a throwing tool into data instead of breaking the turn', async () => {
    // The tool is made to throw rather than relying on a resolver to refuse:
    // most read resolvers perform no permission check of their own, so a
    // permissionless context does not reliably produce a failure.
    const { getTool } = await import('../tools/registry.js')
    const tool: any = getTool('list_whitelabels')
    const original = tool.handler
    tool.handler = async () => {
      throw new Error('the database is unreachable')
    }

    try {
      scripted = [assistantCallsTool('list_whitelabels', {}), assistantSays('I could not read that.')]
      const turn = await runTurn('list the whitelabels')

      assert.equal(turn.reply, 'I could not read that.', 'the turn still completes')
      const toolMessage = sentBodies[1].messages.at(-1)
      assert.equal(toolMessage.role, 'tool')
      assert.match(
        toolMessage.content,
        /the database is unreachable/,
        'the failure reaches the model so it can explain, rather than aborting the turn'
      )
    } finally {
      tool.handler = original
    }
  })

  it('refuses a tool the model invents', async () => {
    scripted = [assistantCallsTool('delete_everything', {}), assistantSays('That is not something I can do.')]
    const turn = await runTurn('delete everything')
    const toolMessage = sentBodies[1].messages.at(-1)
    assert.match(toolMessage.content, /No such tool/i)
    assert.deepEqual(turn.proposals, [], 'and nothing is queued')
  })

  it('queues a write as a proposal and applies nothing', async () => {
    const { db } = await import('@src/db/client.js')
    const { aiActionProposals } = await import('@shared/db/schema.js')
    const { eq } = await import('drizzle-orm')

    scripted = [
      assistantCallsTool('toggle_casino_vendor', { vendorId: '7', enabled: false }),
      assistantSays('I have queued that for your confirmation.'),
    ]
    const turn = await runTurn('disable vendor 7', undefined, CASINO_MANAGER)

    assert.equal(turn.proposals.length, 1)
    assert.match(turn.proposals[0].summary, /Disable casino vendor 7/i)

    const stored = await db.select().from(aiActionProposals).where(eq(aiActionProposals.tenant, TENANT))
    assert.equal(stored.length, 1)
    assert.equal(stored[0].status, 'pending', 'queued, not performed')

    const toolMessage = sentBodies[1].messages.at(-1)
    assert.match(toolMessage.content, /has NOT been applied/i, 'the model is told it did not take effect')
  })

  it('handles arguments the model sends as invalid JSON', async () => {
    scripted = [
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_whitelabels', arguments: '{not json' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { total_tokens: 5 },
      },
      assistantSays('I could not read those arguments.'),
    ]
    const turn = await runTurn('do a thing')
    assert.equal(turn.reply, 'I could not read those arguments.')
    assert.match(sentBodies[1].messages.at(-1).content, /not valid JSON/i)
  })

  it('stops a model that never stops calling tools', async () => {
    // More tool calls than the iteration ceiling allows.
    scripted = Array.from({ length: 12 }, () => assistantCallsTool('list_whitelabels', {}))
    const turn = await runTurn('loop forever')
    assert.match(turn.reply, /could not finish/i, 'the turn ends with an explanation rather than hanging')
    assert.ok(sentBodies.length <= 7, `the loop must be bounded, made ${sentBodies.length} calls`)
  })

  it('carries earlier turns into the next request', async () => {
    scripted = [assistantSays('first answer')]
    const first = await runTurn('first question')

    scripted = [assistantSays('second answer')]
    await runTurn('second question', first.conversationId)

    // The second request is the one that must carry both turns.
    const messages = sentBodies[1].messages
    const userMessages = messages.filter((m: any) => m.role === 'user').map((m: any) => m.content)
    assert.deepEqual(userMessages, ['first question', 'second question'], 'history replays in order')
  })

  it('counts each operator message against the allowance', async () => {
    const { getEntitlement } = await import('../entitlement.js')
    const before = await getEntitlement(TENANT)
    scripted = [assistantSays('ok')]
    await runTurn('one more question')
    const after = await getEntitlement(TENANT)
    assert.equal(after.used, before.used + 1, 'exactly one message is claimed per turn')
  })

  it('refuses the turn, and sends nothing, once the allowance is spent', async () => {
    const { upsertSettings } = await import('../entitlement.js')
    const { AiNotEntitledError } = await import('../entitlement.js')
    await upsertSettings({ tenant: TENANT, enabled: true, chatLimit: 1, limitPeriod: 'monthly', updatedBy: 'test' })

    scripted = [assistantSays('should never be reached')]
    await assert.rejects(() => runTurn('blocked question'), (e: Error) => e instanceof AiNotEntitledError)
    assert.equal(sentBodies.length, 0, 'nothing is sent to the provider when the allowance is gone')

    await upsertSettings({ tenant: TENANT, enabled: true, chatLimit: 100, limitPeriod: 'monthly', updatedBy: 'test' })
  })

  it('refuses to queue a change the caller has no permission for', async () => {
    // Most of these mutations check nothing themselves, so without this gate an
    // operator who cannot reach the screen could still make the change simply by
    // asking for it.
    const { db } = await import('@src/db/client.js')
    const { aiActionProposals } = await import('@shared/db/schema.js')
    const { eq } = await import('drizzle-orm')

    const before = await db.select().from(aiActionProposals).where(eq(aiActionProposals.tenant, TENANT))

    scripted = [
      assistantCallsTool('toggle_casino_vendor', { vendorId: '9', enabled: false }),
      assistantSays('You do not have permission for that.'),
    ]
    // A player-desk operator: no casino authority.
    const turn = await runTurn('disable vendor 9', undefined, [{ domain: 'players', actions: ['view'] }])

    assert.deepEqual(turn.proposals, [], 'nothing may be queued')
    const after = await db.select().from(aiActionProposals).where(eq(aiActionProposals.tenant, TENANT))
    assert.equal(after.length, before.length, 'and no proposal row is written')

    const toolMessage = sentBodies[1].messages.at(-1)
    assert.match(toolMessage.content, /permission/i, 'the model is told why, so it can explain')
  })

  it('refuses at confirmation too, when permission has since been lost', async () => {
    // A proposal can sit for minutes. Authority is checked again by the operator
    // who actually confirms it, not only by the one who asked.
    const { confirmProposal } = await import('../proposals.js')

    scripted = [
      assistantCallsTool('toggle_casino_vendor', { vendorId: '11', enabled: true }),
      assistantSays('Queued.'),
    ]
    const turn = await runTurn('enable vendor 11', undefined, CASINO_MANAGER)
    assert.equal(turn.proposals.length, 1)

    const outcome = await confirmProposal({
      tenant: TENANT,
      proposalId: turn.proposals[0].id,
      adminUserId: ADMIN,
      ctx: ctx([{ domain: 'players', actions: ['view'] }]),
    })
    assert.equal(outcome.status, 'failed')
    assert.match(outcome.message, /permission/i)
  })
})
