import type { AuthContext } from '../domains/common/auth.js'
import type { FastifyRequest } from 'fastify'

export type ResolverContext = {
  auth: AuthContext
  request?: FastifyRequest
  reply?: any
}

