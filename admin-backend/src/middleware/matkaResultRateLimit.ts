/**
 * Simple in-memory rate limiter for Matka Results mutations
 * Uses token bucket algorithm per actor
 */

interface RateLimitBucket {
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, RateLimitBucket>()

// Configuration
const MAX_TOKENS = 10 // Max requests
const REFILL_RATE_MS = 60000 // Refill interval (1 minute)
const TOKENS_PER_REFILL = 10 // Tokens added per refill

/**
 * Check if request is allowed (rate limit not exceeded)
 * @param actorId - Unique identifier for the actor (user ID)
 * @returns true if allowed, false if rate limited
 */
export function checkRateLimit(actorId: string): boolean {
  const key = `matka_results:${actorId}`
  const now = Date.now()
  
  let bucket = buckets.get(key)
  
  if (!bucket) {
    // Initialize bucket
    bucket = {
      tokens: MAX_TOKENS,
      lastRefill: now,
    }
    buckets.set(key, bucket)
    return true
  }
  
  // Refill tokens based on time elapsed
  const timeElapsed = now - bucket.lastRefill
  if (timeElapsed >= REFILL_RATE_MS) {
    const refills = Math.floor(timeElapsed / REFILL_RATE_MS)
    bucket.tokens = Math.min(MAX_TOKENS, bucket.tokens + (refills * TOKENS_PER_REFILL))
    bucket.lastRefill = now
  }
  
  // Check if we have tokens
  if (bucket.tokens > 0) {
    bucket.tokens--
    return true
  }
  
  return false
}

/**
 * Get remaining tokens for an actor
 */
export function getRemainingTokens(actorId: string): number {
  const key = `matka_results:${actorId}`
  const bucket = buckets.get(key)
  if (!bucket) return MAX_TOKENS
  
  const now = Date.now()
  const timeElapsed = now - bucket.lastRefill
  if (timeElapsed >= REFILL_RATE_MS) {
    const refills = Math.floor(timeElapsed / REFILL_RATE_MS)
    return Math.min(MAX_TOKENS, bucket.tokens + (refills * TOKENS_PER_REFILL))
  }
  
  return bucket.tokens
}

/**
 * Clear rate limit buckets (useful for testing)
 */
export function clearRateLimitBuckets() {
  buckets.clear()
}

