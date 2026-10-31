import { Redis } from 'ioredis'

// Lazy initialization to handle Redis connection errors gracefully
let redisInstance: Redis | null = null

function getRedis(): Redis | null {
  if (redisInstance) return redisInstance
  
  try {
    redisInstance = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      retryStrategy: (times) => {
        if (times > 3) {
          return null // Stop retrying
        }
        return Math.min(times * 50, 2000)
      },
      maxRetriesPerRequest: 1,
    })
    
    redisInstance.on('error', (err) => {
      // Don't throw, just log - cache is optional
    })
    
    return redisInstance
  } catch (error) {
    return null
  }
}

export class QueryCache {
  /**
   * Live data cache (5 seconds TTL)
   * Used by: Live analysis pages (Sports, Casino, Matka)
   */
  static async getLive<T>(key: string): Promise<T | null> {
    const redis = getRedis()
    if (!redis) return null
    
    try {
      const data = await redis.get(key)
      return data ? JSON.parse(data) : null
    } catch (error) {
      return null
    }
  }
  
  static async setLive(key: string, data: any): Promise<void> {
    const redis = getRedis()
    if (!redis) return
    
    try {
      await redis.setex(key, 5, JSON.stringify(data))
    } catch (error) {
    }
  }
  
  /**
   * Report data cache (60 seconds TTL)
   * Used by: Reporting pages (no real-time updates needed)
   */
  static async getReport<T>(key: string): Promise<T | null> {
    const redis = getRedis()
    if (!redis) return null
    
    try {
      const data = await redis.get(key)
      return data ? JSON.parse(data) : null
    } catch (error) {
      return null
    }
  }
  
  static async setReport(key: string, data: any): Promise<void> {
    const redis = getRedis()
    if (!redis) return
    
    try {
      await redis.setex(key, 60, JSON.stringify(data))
    } catch (error) {
    }
  }
  
  /**
   * Invalidate cache by pattern (for live data only)
   * Used when bets are placed to invalidate live dashboards
   */
  static async invalidatePattern(pattern: string): Promise<void> {
    const redis = getRedis()
    if (!redis) return
    
    try {
      const keys = await redis.keys(pattern)
      if (keys.length > 0) {
        await redis.del(...keys)
      }
    } catch (error) {
    }
  }
  
  /**
   * Invalidate specific key
   */
  static async invalidate(key: string): Promise<void> {
    const redis = getRedis()
    if (!redis) return
    
    try {
      await redis.del(key)
    } catch (error) {
    }
  }
}

