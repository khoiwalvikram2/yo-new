import { FastifyInstance } from 'fastify'

export async function registerRequestLogger(app: FastifyInstance) {
  app.addHook('onRequest', async (req) => {
    req.log.info({ method: req.method, url: req.url }, 'request:begin')
  })
  app.addHook('onResponse', async (req, reply) => {
    req.log.info({ statusCode: reply.statusCode, url: req.url }, 'request:end')
  })
}

