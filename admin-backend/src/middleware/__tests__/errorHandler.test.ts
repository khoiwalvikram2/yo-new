/**
 * The HTTP error handler must not echo server-side failure detail to callers.
 *
 * Driver errors put the failing SQL and its bound parameters in
 * `error.message`; returning that verbatim on a 500 hands an anonymous caller
 * the schema and whatever values were in flight. Client errors (4xx) are the
 * opposite case — their message is the useful part.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { errorHandler } from '../errorHandler.js'

function fakeReply() {
  const state: { status?: number; body?: any } = {}
  const reply: any = {
    status(code: number) {
      state.status = code
      return reply
    },
    send(payload: any) {
      state.body = payload
      return reply
    },
  }
  return { reply, state }
}

const fakeRequest = () =>
  ({ url: '/graphql', method: 'POST', log: { error: () => {} } }) as any

const err = (message: string, statusCode?: number, code?: string) =>
  Object.assign(new Error(message), { statusCode, code }) as any

describe('errorHandler', () => {
  it('hides the message of a 500 behind a generic string', () => {
    const { reply, state } = fakeReply()
    errorHandler(
      err('Failed query: select * from users where token = $1 -- params: ["secret"]'),
      fakeRequest(),
      reply
    )
    assert.equal(state.status, 500)
    assert.equal(state.body.error.message, 'Internal Server Error')
    assert.equal(state.body.error.code, 'INTERNAL_ERROR')
  })

  it('does not leak SQL, parameters or table names on a 500', () => {
    const { reply, state } = fakeReply()
    errorHandler(
      err('duplicate key value violates unique constraint "agent_credentials_tenant_username_key"'),
      fakeRequest(),
      reply
    )
    const serialized = JSON.stringify(state.body)
    assert.ok(!serialized.includes('agent_credentials'), 'table name must not reach the client')
    assert.ok(!serialized.includes('unique constraint'), 'constraint detail must not reach the client')
  })

  it('logs the real error so it stays diagnosable', () => {
    const { reply } = fakeReply()
    let logged: any = null
    const request: any = { url: '/x', method: 'GET', log: { error: (o: any) => { logged = o } } }
    const original = err('connection to 10.0.0.4:5432 refused')
    errorHandler(original, request, reply)
    assert.ok(logged, 'the handler must log')
    assert.equal(logged.err, original, 'the original error is preserved for the operator')
  })

  it('passes a 4xx message through — that message is for the caller', () => {
    const { reply, state } = fakeReply()
    errorHandler(err('Username is required', 400, 'FST_ERR_VALIDATION'), fakeRequest(), reply)
    assert.equal(state.status, 400)
    assert.equal(state.body.error.message, 'Username is required')
    assert.equal(state.body.error.code, 'FST_ERR_VALIDATION')
  })

  it('treats a 401 as a client error', () => {
    const { reply, state } = fakeReply()
    errorHandler(err('Invalid credentials', 401), fakeRequest(), reply)
    assert.equal(state.status, 401)
    assert.equal(state.body.error.message, 'Invalid credentials')
  })

  it('defaults a statusless error to a masked 500', () => {
    const { reply, state } = fakeReply()
    errorHandler(err('something internal blew up'), fakeRequest(), reply)
    assert.equal(state.status, 500)
    assert.equal(state.body.error.message, 'Internal Server Error')
  })
})
