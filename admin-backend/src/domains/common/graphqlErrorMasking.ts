import { GraphQLError } from 'graphql'
import mercurius from 'mercurius'

/**
 * What a failed GraphQL operation may tell its caller (MAT-09).
 *
 * mercurius was registered without an errorFormatter, so a resolver that let a database error through handed it to
 * the browser as it was. drizzle's message is "Failed query: <the SQL>\nparams: <every bound value>": a duplicate
 * matka code returned the whole INSERT with the tenant, the creator id and the settings JSON. matkaRepo now maps its
 * own writes, but any other resolver could still do the same. middleware/errorHandler.ts already keeps driver detail
 * out of HTTP errors; this is the same rule for GraphQL, where every resolver error arrives with status 200.
 *
 * Only database detail is masked. A message thrown on purpose ("Forbidden: ...", "Player not found", "A matka with
 * this code already exists") reaches the caller unchanged, including one that keeps the driver error as its cause
 * for the server log. The original is logged, so the detail is still there for diagnosis.
 */
export const DATABASE_ERROR_MESSAGE = 'The request could not be completed because of a server error. Please try again.'

const SQLSTATE = /^[0-9A-Z]{5}$/

/** A node-postgres DatabaseError: a five-character SQLSTATE code and a severity. */
function isDriverError(e: any): boolean {
  return !!e && typeof e === 'object' && typeof e.code === 'string' && SQLSTATE.test(e.code) && typeof e.severity === 'string'
}

/**
 * Whether an error would hand its caller database internals:
 *   - drizzle's "Failed query: " anywhere in the message, which also catches a resolver that wrapped it
 *     ("Failed to save: Failed query: insert into ...");
 *   - the driver's own error reaching the caller as it was thrown (constraint, column and type names, input values);
 *   - a message that quotes a driver error found in its cause chain.
 * A message of the resolver's own whose cause is a driver error is not exposing anything, and passes.
 */
export function exposesDatabaseDetail(error: unknown): boolean {
  const outer = error as any
  const message = typeof outer?.message === 'string' ? outer.message : ''
  if (message.includes('Failed query: ')) return true
  const thrown = outer?.originalError ?? outer
  let current: any = thrown
  for (let depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    if (isDriverError(current)) {
      if (current === thrown) return true
      const text = typeof current.message === 'string' ? current.message.trim() : ''
      if (text && message.includes(text)) return true
    }
    current = current.cause
  }
  return false
}

/**
 * mercurius's errorFormatter: every error that would expose database detail is replaced by a generic one at the same
 * path, after logging the original; everything else, and the status code and the response shape, are what
 * mercurius's default formatter makes of them. Used by the HTTP, batched and subscription paths alike.
 */
export function maskDatabaseErrors(execution: any, context: any) {
  const errors = (execution?.errors ?? []).map((error: GraphQLError) => {
    if (!exposesDatabaseDetail(error)) return error
    const log = context?.reply?.log ?? context?.app?.log
    log?.error?.(
      { err: (error as any)?.originalError ?? error, path: error?.path },
      'database error in a GraphQL operation (masked for the caller)'
    )
    return new GraphQLError(DATABASE_ERROR_MESSAGE, {
      nodes: error?.nodes,
      source: error?.source,
      positions: error?.positions,
      path: error?.path,
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    })
  })
  return mercurius.defaultErrorFormatter({ ...execution, errors }, context)
}
