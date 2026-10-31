import type { FastifyInstance } from 'fastify'
import { readSiteAsset, validAssetTenant, type SiteAssetSource } from '../services/siteAssets.js'

export async function registerSiteAssetRoutes(app: FastifyInstance) {
  app.get<{ Params: { tenant: string; source: string; hash: string } }>('/api/site-assets/:tenant/:source/:hash', async (request, reply) => {
    const { tenant, source, hash } = request.params
    if (!validAssetTenant(tenant) || !['settings', 'advertisements', 'payments'].includes(source) || !/^[a-f0-9]{64}$/.test(hash)) return reply.code(404).send()
    const asset = await readSiteAsset(tenant, source as SiteAssetSource, hash)
    if (!asset) return reply.code(404).send()
    const etag = `"${asset.hash}"`
    reply.header('ETag', etag)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .type(asset.contentType)
    if (String(request.headers['if-none-match'] || '').split(',').map(value => value.trim()).includes(etag)) return reply.code(304).send()
    return reply.send(asset.bytes)
  })
}
