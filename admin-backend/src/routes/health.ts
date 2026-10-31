import { FastifyInstance } from 'fastify'
import { pingDb } from '@/repos/healthRepo.js'

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    try {
      const healthy = await pingDb()
      return { status: healthy ? 'ok' : 'degraded' }
    } catch {
      return { status: 'degraded' }
    }
  })
}

