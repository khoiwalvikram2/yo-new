import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { FastifyInstance, FastifyRequest } from 'fastify'

const PAGE_SIZE = 100
/** Delay between page requests to avoid upstream 503 rate limiting (nginx/GMag API). */
const PAGE_DELAY_MS = 300
const RETRY_ATTEMPTS = 3
const RETRY_BACKOFF_MS = [2000, 5000, 10000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildGmagHashPlainString(params: Record<string, unknown>, secretKey: string): string {
  const keys = Object.keys(params).sort()
  const parts: string[] = []
  for (const key of keys) {
    if (key === 'hash') continue
    const val = params[key]
    const str =
      Array.isArray(val) ? JSON.stringify(val) : val === null || val === undefined ? '' : String(val)
    parts.push(`${key}=${str}`)
  }
  return parts.join('&') + secretKey
}

function computeGmagHash(params: Record<string, unknown>, secretKey: string): string {
  const plain = buildGmagHashPlainString(params, secretKey)
  return createHash('md5').update(plain, 'utf8').digest('hex')
}

/**
 * GET /dev/gmag-game-data
 * Fetches GMAG casino game list from GMAG_GAME_DATA_URL and returns raw JSON.
 * - No query or ?all=1 or ?all=true: fetches ALL pages and returns combined records (total ~12446).
 * - ?page=N: returns single page N only (e.g. ?page=2 for second page). Ignored if ?all=1 is set.
 * Requires GMAG_GAME_DATA_URL, GMAG_SECRET_KEY, GMAG_BRAND_ID in env.
 *
 * When using ?all=1, the request can take 1–2 minutes. Nginx (or any reverse proxy) must use
 * longer timeouts for this path to avoid 502 Bad Gateway. See admin-backend/docs/nginx-gmag-timeout.conf.
 */
export async function registerGmagGameDataRoutes(app: FastifyInstance) {
  app.get(
    '/dev/gmag-game-data',
    async (
      request: FastifyRequest<{ Querystring: { page?: string; all?: string } }>,
      reply
    ) => {
      const gameDataUrl = process.env.GMAG_GAME_DATA_URL
      const secretKey = process.env.GMAG_SECRET_KEY
      const brandIdRaw = process.env.GMAG_BRAND_ID

      if (!gameDataUrl?.trim() || !secretKey?.trim()) {
        return reply.status(503).send({
          error: 'GMAG_GAME_DATA_URL and GMAG_SECRET_KEY must be set in env.',
        })
      }
      const brandId = brandIdRaw ? Number(brandIdRaw) : 0
      if (!Number.isFinite(brandId)) {
        return reply.status(503).send({
          error: 'GMAG_BRAND_ID must be a number in env.',
        })
      }

      const url = new URL(gameDataUrl)
      if (!url.pathname.endsWith('/')) url.pathname = url.pathname.replace(/\/?$/, '') + '/'
      const path = `${url.pathname.replace(/\/$/, '')}/game/list`
      const fullUrl = `${url.origin}${path}`

      const q = request.query ?? {}
      const wantAll = q.all === '1' || q.all === 'true'
      const pageVal = q.page !== undefined && q.page !== '' ? parseInt(String(q.page), 10) : NaN
      const singlePage = !wantAll && Number.isFinite(pageVal) && pageVal >= 1 ? Math.min(pageVal, 99999) : null

      const fetchOnePageRaw = async (page: number): Promise<{ total: number; pages: number; records: unknown[] }> => {
        const body: Record<string, unknown> = {
          brandId,
          page,
          requestId: randomUUID(),
          size: PAGE_SIZE,
        }
        const hash = computeGmagHash(body, secretKey)
        const fetchUrl = `${fullUrl}?hash=${encodeURIComponent(hash)}`
        const res = await fetch(fetchUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const text = await res.text()
        const json = text ? (() => { try { return JSON.parse(text) as Record<string, unknown> } catch { return { raw: text } } })() : {}
        if (!res.ok) {
          const msg = String(((json as { message?: string }).message ?? text) || res.statusText)
          const err = new Error(msg) as Error & { status?: number }
          err.status = res.status
          throw err
        }
        const data = json as { total?: number; pages?: number; records?: unknown[]; list?: unknown[] }
        const list = data.records ?? data.list ?? []
        return {
          total: data.total ?? 0,
          pages: data.pages ?? 1,
          records: Array.isArray(list) ? list : [],
        }
      }

      const fetchOnePage = async (page: number): Promise<{ total: number; pages: number; records: unknown[] }> => {
        let lastErr: Error | null = null
        for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
          if (attempt > 0) {
            const backoff = RETRY_BACKOFF_MS[attempt - 1] ?? 10000
            await sleep(backoff)
          }
          try {
            return await fetchOnePageRaw(page)
          } catch (err) {
            lastErr = err instanceof Error ? err : new Error(String(err))
            const status = (lastErr as Error & { status?: number }).status
            const isRetryable = status === 503 || status === 502 || status === 429 || status === 408
            if (!isRetryable || attempt === RETRY_ATTEMPTS) throw lastErr
          }
        }
        throw lastErr ?? new Error('Fetch failed')
      }

      try {
        if (singlePage != null) {
          const result = await fetchOnePage(singlePage)
          return reply.type('application/json').send({
            requestId: randomUUID(),
            error: '0',
            message: 'SUCCESS',
            total: result.total,
            current: singlePage,
            size: PAGE_SIZE,
            pages: result.pages,
            records: result.records,
          })
        }

        const first = await fetchOnePage(1)
        const allRecords: unknown[] = [...first.records]
        const pages = first.pages || 1

        for (let p = 2; p <= pages; p++) {
          if (PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS)
          const next = await fetchOnePage(p)
          allRecords.push(...next.records)
        }

        return reply.type('application/json').send({
          requestId: randomUUID(),
          error: '0',
          message: 'SUCCESS',
          total: allRecords.length,
          current: 1,
          size: allRecords.length,
          pages: 1,
          records: allRecords,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(502).send({ error: 'Fetch failed', detail: msg })
      }
    }
  )
}
