import { useEffect, useState } from 'react'
import { nowIST } from '@/shared/utils/date'
import { formatIstClock, IST_CLOCK_REFRESH_MS, type IstClock } from './istClock'

/** Current IST date and time labels for the panel-footer clock (PanelFooter.tsx), refreshed every 30 seconds while mounted. */
export function useIstClock(): IstClock {
  // One nowIST() call for both fields, so date/time can never straddle a minute or day boundary
  // between two separate reads of "now".
  const [clock, setClock] = useState(() => formatIstClock(nowIST()))

  useEffect(() => {
    const tick = () => setClock(formatIstClock(nowIST()))
    const id = window.setInterval(tick, IST_CLOCK_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [])

  return clock
}
