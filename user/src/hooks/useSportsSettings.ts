import { useState, useEffect } from 'react'
import { getSportsSettings } from '@/lib/api/user'

interface SportsSettings {
  exchange: { minStake: number | null; maxStake: number | null; minOdds: number | null; maxOdds: number | null }
  bookmaker: { minStake: number | null; maxStake: number | null; minOdds: number | null; maxOdds: number | null }
  fancy: { minStake: number | null; maxStake: number | null; minOdds: null; maxOdds: null }
}

export function useSportsSettings(event?: { sportId?: string | number; leagueId?: string | number; eventId?: string }) {
  const [settings, setSettings] = useState<SportsSettings | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!event?.sportId || !event?.leagueId || !event?.eventId) {
      setSettings(null)
      return
    }

    setIsLoading(true)
    getSportsSettings({
      sportId: event.sportId,
      leagueId: event.leagueId,
      eventId: event.eventId,
    })
      .then((response) => {
        if (response?.meta?.code === 200 && response?.data) {
          setSettings(response.data)
        } else {
          setSettings(null)
        }
      })
      .catch(() => {
        setSettings(null)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [event?.sportId, event?.leagueId, event?.eventId])

  return { settings, isLoading }
}

