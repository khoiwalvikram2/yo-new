import { FastifyInstance } from 'fastify'
import client from 'prom-client'

// Matka Results metrics
export const matkaResultMetrics = {
  declaresTotal: new client.Counter({
    name: 'matka_results_declares_total',
    help: 'Total matka result declarations',
    labelNames: ['tenant', 'type'],
  }),
  rollbacksTotal: new client.Counter({
    name: 'matka_results_rollbacks_total',
    help: 'Total matka result rollbacks',
    labelNames: ['tenant', 'reason_tag'],
  }),
  declareLatency: new client.Histogram({
    name: 'matka_results_declare_latency_seconds',
    help: 'Latency of result declaration in seconds',
    labelNames: ['tenant'],
    buckets: [0.1, 0.5, 1, 2, 5],
  }),
  rollbackLatency: new client.Histogram({
    name: 'matka_results_rollback_latency_seconds',
    help: 'Latency of result rollback in seconds',
    labelNames: ['tenant'],
    buckets: [0.1, 0.5, 1, 2, 5],
  }),
  rateLimitHits: new client.Counter({
    name: 'matka_results_rate_limit_hits_total',
    help: 'Total rate limit hits for matka results mutations',
    labelNames: ['tenant'],
  }),
}

export async function registerMetricsRoutes(app: FastifyInstance) {
  client.collectDefaultMetrics()
  const httpRequests = new client.Counter({ name: 'http_requests_total', help: 'Total HTTP requests', labelNames: ['method', 'route', 'status'] })
  app.addHook('onResponse', async (req, reply) => {
    // @ts-ignore routeConfig may be undefined in some cases
    const route = (reply.contextConfig?.url || req.routerPath || req.url || 'unknown') as string
    httpRequests.inc({ method: req.method, route, status: String(reply.statusCode) })
  })
  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', client.register.contentType)
    return client.register.metrics()
  })
}

