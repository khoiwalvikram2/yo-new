import { getEnv } from '@src/config/env.js'

/**
 * Minimal OpenAI Chat Completions wrapper.
 *
 * Deliberately not the official SDK: this needs one endpoint, and a dependency
 * that ships its own fetch stack and retry policy is more surface than the call
 * warrants. Timeouts and retries are explicit here so their behaviour is
 * visible at the call site.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatCompletionResult {
  message: ChatMessage
  finishReason: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
}

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const REQUEST_TIMEOUT_MS = 60_000
const MAX_ATTEMPTS = 3

export class OpenAiNotConfiguredError extends Error {
  constructor() {
    super('The AI assistant is not configured. Set OPENAI_API_KEY to enable it.')
    this.name = 'OpenAiNotConfiguredError'
  }
}

/** The key works but the account cannot pay for the call. Retrying cannot help. */
export class OpenAiQuotaError extends Error {
  constructor() {
    super(
      'The OpenAI account has no remaining credits. Add credits at ' +
        'https://platform.openai.com/settings/organization/billing to use the assistant.'
    )
    this.name = 'OpenAiQuotaError'
  }
}

export function isAiConfigured(): boolean {
  return Boolean(getEnv().OPENAI_API_KEY)
}

/**
 * Retry only what a retry can fix.
 *
 * A 429 covers two unrelated cases: a rate limit, which clears on its own, and
 * an exhausted credit balance, which does not. Retrying the second wastes three
 * calls and several seconds before reporting a failure that was certain from
 * the first response, so the body decides.
 */
function isRetryable(status: number, body: string): boolean {
  if (status >= 500) return true
  if (status !== 429) return false
  return !isQuotaExhausted(body)
}

function isQuotaExhausted(body: string): boolean {
  return /insufficient_quota|credit_balance_exhausted|no credits remaining/i.test(body)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function chatCompletion(params: {
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  temperature?: number
}): Promise<ChatCompletionResult> {
  const env = getEnv()
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) throw new OpenAiNotConfiguredError()

  const body = {
    model: env.OPENAI_MODEL,
    messages: params.messages,
    ...(params.tools?.length ? { tools: params.tools, tool_choice: 'auto' } : {}),
    temperature: params.temperature ?? 0.1,
  }

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok) {
        const detail = await res.text().catch(() => '')

        if (isQuotaExhausted(detail)) {
          console.error('[ai] OpenAI credit balance exhausted')
          throw new OpenAiQuotaError()
        }

        // The upstream body can echo request content; keep it out of the thrown
        // message and let the caller log the status instead.
        const err = new Error(`OpenAI request failed with status ${res.status}`)
        if (isRetryable(res.status, detail) && attempt < MAX_ATTEMPTS) {
          lastError = err
          console.warn(`[ai] OpenAI ${res.status}, retrying (attempt ${attempt}/${MAX_ATTEMPTS})`)
          await sleep(attempt * 1000)
          continue
        }
        console.error(`[ai] OpenAI ${res.status}: ${detail.slice(0, 300)}`)
        throw err
      }

      const json: any = await res.json()
      const choice = json.choices?.[0]
      if (!choice) throw new Error('OpenAI returned no choices')

      return {
        message: choice.message,
        finishReason: choice.finish_reason,
        usage: {
          promptTokens: json.usage?.prompt_tokens ?? 0,
          completionTokens: json.usage?.completion_tokens ?? 0,
          totalTokens: json.usage?.total_tokens ?? 0,
        },
      }
    } catch (err: any) {
      clearTimeout(timer)
      const isAbort = err?.name === 'AbortError'
      if (attempt < MAX_ATTEMPTS && (isAbort || err?.name === 'TypeError')) {
        lastError = err
        console.warn(`[ai] OpenAI ${isAbort ? 'timeout' : 'network error'}, retrying (attempt ${attempt}/${MAX_ATTEMPTS})`)
        await sleep(attempt * 1000)
        continue
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError ?? new Error('OpenAI request failed')
}
