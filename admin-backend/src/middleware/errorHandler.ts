import { FastifyError, FastifyReply, FastifyRequest } from 'fastify'

/**
 * Client errors (4xx) carry messages meant for the caller — validation
 * failures, auth problems — so they are passed through.
 *
 * Server errors (5xx) are not. An unexpected failure here is usually a driver
 * error, and those carry the failing SQL and its bound parameters in
 * `error.message`; returning that verbatim hands an anonymous caller the schema
 * and whatever values were in flight. The detail is logged instead, where it is
 * still available for diagnosis.
 */
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  const status = error.statusCode && Number.isFinite(error.statusCode) ? Number(error.statusCode) : 500

  if (status >= 500) {
    request.log.error(
      { err: error, url: request.url, method: request.method },
      'unhandled server error'
    )
    reply.status(status).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error' },
    })
    return
  }

  reply.status(status).send({
    error: {
      code: error.code || 'BAD_REQUEST',
      message: error.message || 'Bad Request',
    },
  })
}
