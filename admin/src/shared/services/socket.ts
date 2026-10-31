import { io, Socket } from 'socket.io-client'
import { useAuthStore } from '@/shared/core/authStore'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (socket) return socket
  const url = import.meta.env.VITE_SOCKET_URL || window.location.origin
  const user = useAuthStore.getState().user
  socket = io(url, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { userId: user?.id ? String(user.id) : '' },
  } as any)
  return socket
}

