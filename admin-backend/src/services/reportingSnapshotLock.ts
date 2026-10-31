import { Redis } from 'ioredis';
import { formatDateInTz } from '@src/shared/dateUtils.js';
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js';

// Lazy initialization to handle Redis connection errors gracefully
let redisInstance: Redis | null = null;

function getRedis(): Redis | null {
  if (redisInstance) return redisInstance;
  
  try {
    redisInstance = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      retryStrategy: (times) => {
        if (times > 3) {
          return null; // Stop retrying
        }
        return Math.min(times * 50, 2000);
      },
      maxRetriesPerRequest: 1,
    });
    
    redisInstance.on('error', (err) => {
      // Don't throw, just log - locking is optional, will fall back to direct generation
    });
    
    return redisInstance;
  } catch (error) {
    return null;
  }
}

/**
 * Generate lock key for snapshot generation (date string in tenant timezone for consistency)
 */
async function getLockKey(
  tenant: string,
  whitelabelId: string,
  date: Date,
  domain: string,
  currency: string,
): Promise<string> {
  const tz = await getWhitelabelTimezone(tenant);
  const dateStr = formatDateInTz(date, tz);
  return `snapshot:lock:${tenant}:${whitelabelId}:${dateStr}:${domain}:${currency}`;
}

/**
 * Acquire distributed lock for snapshot generation
 * Returns true if lock was acquired, false if already locked
 */
export async function acquireSnapshotLock(
  tenant: string,
  whitelabelId: string,
  date: Date,
  domain: string,
  currency: string,
  ttlSeconds: number = 300, // 5 minutes default
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    // Redis not available - allow generation (fallback to direct generation)
    return true;
  }
  
  const lockKey = await getLockKey(tenant, whitelabelId, date, domain, currency);
  
  try {
    // SET key value NX EX seconds
    // NX = only set if not exists
    // EX = set expiration in seconds
    const result = await redis.set(lockKey, '1', 'EX', ttlSeconds, 'NX');
    
    if (result === 'OK') {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    // On error, allow generation (fail open)
    return true;
  }
}

/**
 * Release distributed lock for snapshot generation
 * Optional - lock will expire automatically via TTL
 */
export async function releaseSnapshotLock(
  tenant: string,
  whitelabelId: string,
  date: Date,
  domain: string,
  currency: string,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  
  const lockKey = await getLockKey(tenant, whitelabelId, date, domain, currency);
  
  try {
    await redis.del(lockKey);
  } catch (error) {
    // Non-critical, lock will expire via TTL anyway
  }
}

/**
 * Check if lock exists for snapshot generation
 */
export async function isSnapshotLocked(
  tenant: string,
  whitelabelId: string,
  date: Date,
  domain: string,
  currency: string,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  
  const lockKey = await getLockKey(tenant, whitelabelId, date, domain, currency);
  
  try {
    const exists = await redis.exists(lockKey);
    return exists === 1;
  } catch (error) {
    return false; // Fail open
  }
}
