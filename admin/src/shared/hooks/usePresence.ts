import { useEffect } from 'react'
import { getSocket } from '@/shared/services/socket'
import { usePresenceStore } from '@/state/presenceStore'

export function usePresence() {
  const setSnapshot = usePresenceStore(s => s.setSnapshot)
  const setOnline = usePresenceStore(s => s.setOnline)
  const setOffline = usePresenceStore(s => s.setOffline)

  useEffect(() => {
    const socket = getSocket()

    const onSnapshot = (payload: { onlineIds: string[] }) => {
      setSnapshot(payload.onlineIds || [])
    }
    const onUpdate = (payload: { userId: string; online: boolean }) => {
      if (payload.online) setOnline(payload.userId)
      else setOffline(payload.userId)
    }

    socket.on('presence:snapshot', onSnapshot)
    socket.on('presence:update', onUpdate)

    const hb = setInterval(() => {
      socket.emit('presence:heartbeat')
    }, 20000)

    return () => {
      socket.off('presence:snapshot', onSnapshot)
      socket.off('presence:update', onUpdate)
      clearInterval(hb)
    }
  }, [setSnapshot, setOnline, setOffline])
}

