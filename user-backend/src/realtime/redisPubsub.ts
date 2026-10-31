import mqemitter from 'mqemitter-redis'

let emitter: any | null = null

export function getRedisEmitter() {
  if (emitter) return emitter
  
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
  
  // Parse Redis URL if provided
  let redisConfig: any = {
    port: 6379,
    host: 'localhost',
  }
  
  if (redisUrl && redisUrl !== 'redis://localhost:6379') {
    try {
      const url = new URL(redisUrl)
      redisConfig.host = url.hostname
      redisConfig.port = parseInt(url.port || '6379', 10)
      if (url.password) {
        redisConfig.password = url.password
      }
    } catch (err) {
    }
  }
  
  emitter = mqemitter(redisConfig)
  
  emitter.on('error', (err: Error) => {
  })
  
  return emitter
}

