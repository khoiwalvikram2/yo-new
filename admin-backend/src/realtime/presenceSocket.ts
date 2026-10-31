import type { FastifyInstance } from 'fastify'
import { Server } from 'socket.io'
import { presenceGetOnlineIds, presenceRefresh, presenceSetOffline, presenceSetOnline } from '@src/config/redisClient.js'
import { getUserRoleNames } from '@src/repos/rbac/rbacRepo.js'
import { verifyJwt } from '@src/domains/common/auth.js'

const PRESENCE_TTL_SECONDS = 60
const HEARTBEAT_INTERVAL_MS = 20000

export async function registerPresenceSocket(app: FastifyInstance, originList: string[]) {
  const io = new Server(app.server, {
    cors: {
      origin: originList || [],
      credentials: true,
    },
    path: '/socket.io',
  })

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: string } | undefined)?.token
      if (!token) {
        return next(new Error('Authentication required'))
      }
      const payload = verifyJwt(token)
      if (!payload) {
        return next(new Error('Invalid token'))
      }
      ;(socket as any).data.user = payload
      return next()
    } catch (e) {
      return next(new Error('unauthorized'))
    }
  })

  io.on('connection', async (socket) => {
    try {
      const request: any = socket.request
      const tenant: string = request.tenant || 'default'

      // User identity from verified JWT (do not trust client-provided userId)
      const payload = (socket as any).data?.user
      const userId = payload?.sub ? String(payload.sub) : undefined
      if (!userId) {
        socket.disconnect(true)
        return
      }

      // Ensure user is an admin (has any admin role)
      let isAdmin = false
      try {
        const names = await getUserRoleNames(Number(userId), tenant)
        isAdmin = names.length > 0
      } catch {}
      if (!isAdmin) {
        socket.disconnect(true)
        return
      }

      // Join tenant room for broadcast
      const room = `tenant:${tenant}`
      socket.join(room)

      // Mark online and broadcast update if first time
      await presenceSetOnline(tenant, userId, PRESENCE_TTL_SECONDS)
      socket.to(room).emit('presence:update', { userId, online: true })

      // Send snapshot to this socket
      const onlineIds = await presenceGetOnlineIds(tenant)
      socket.emit('presence:snapshot', { onlineIds })

      // Heartbeat from client to refresh TTL
      socket.on('presence:heartbeat', async () => {
        await presenceRefresh(tenant, userId, PRESENCE_TTL_SECONDS)
      })

      socket.on('disconnect', async () => {
        await presenceSetOffline(tenant, userId)
        socket.to(room).emit('presence:update', { userId, online: false })
      })
    } catch (e) {
      try { socket.disconnect(true) } catch {}
    }
  })

  app.log.info('Presence Socket.IO registered')
}

