import type { Redis } from 'ioredis'

let redisClient: Redis | null = null
let inMemoryPresence = new Map<string, number>()

function getKey(tenant: string, userId: string | number): string {
  return `admin:presence:${tenant}:${userId}`
}

export async function getRedisClient(): Promise<Redis | null> {
  if (redisClient) return redisClient
  const url = process.env.REDIS_URL || 'redis://localhost:6379'
  try {
    const mod = await import('ioredis')
    const RedisCtor = mod.default
    redisClient = new RedisCtor(url)
    // Logged, not swallowed. An empty handler here made a Redis outage look
    // identical to Redis working: presence fell back to memory with no signal
    // anywhere. It must not throw either — ioredis reconnects on its own, and
    // an unhandled 'error' event would end the process.
    redisClient.on('error', (err) => {
      console.error('[redis] presence client error', { error: err?.message ?? String(err) })
    })
    return redisClient
  } catch (e) {
    console.error('[redis] could not create a presence client; using in-memory presence', {
      error: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

/** Releases the presence client. Used by graceful shutdown and by short-lived processes. */
export async function closeRedisClient(): Promise<void> {
  const current = redisClient
  if (!current) return
  redisClient = null
  try {
    await current.quit()
  } catch {
    current.disconnect()
  }
}

export async function presenceSetOnline(tenant: string, userId: string | number, ttlSeconds: number): Promise<void> {
  const client = await getRedisClient()
  const key = getKey(tenant, userId)
  if (client) {
    await client.set(key, String(Date.now()), 'EX', ttlSeconds)
    return
  }
  // in-memory fallback
  inMemoryPresence.set(key, Date.now() + ttlSeconds * 1000)
}

export async function presenceRefresh(tenant: string, userId: string | number, ttlSeconds: number): Promise<void> {
  const client = await getRedisClient()
  const key = getKey(tenant, userId)
  if (client) {
    await client.expire(key, ttlSeconds)
    return
  }
  inMemoryPresence.set(key, Date.now() + ttlSeconds * 1000)
}

export async function presenceSetOffline(tenant: string, userId: string | number): Promise<void> {
  const client = await getRedisClient()
  const key = getKey(tenant, userId)
  if (client) {
    await client.del(key)
    return
  }
  inMemoryPresence.delete(key)
}

export async function presenceGetOnlineIds(tenant: string): Promise<string[]> {
  const client = await getRedisClient()
  if (client) {
    const keys = await client.keys(`admin:presence:${tenant}:*`)
    return keys.map(k => k.split(':').pop() as string)
  }
  // sweep expired
  const now = Date.now()
  for (const [k, exp] of inMemoryPresence.entries()) {
    if (exp < now) inMemoryPresence.delete(k)
  }
  const prefix = `admin:presence:${tenant}:`
  return Array.from(inMemoryPresence.keys())
    .filter(k => k.startsWith(prefix))
    .map(k => k.substring(prefix.length))
}

