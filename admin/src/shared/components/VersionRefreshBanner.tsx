import { useState, useEffect, useCallback } from 'react'
import { IconRefresh } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { Notice } from '@/ui/components/Notice'
import { strokeFor } from '@/ui/components/icons'
import styles from './VersionRefreshBanner.module.css'

const VERSION_URL = '/version.json'
const CHECK_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const STORAGE_KEY = 'app_version_buildTime'

export function VersionRefreshBanner() {
  const [showBanner, setShowBanner] = useState(false)
  const [buildTime, setBuildTime] = useState<number | null>(null)

  const checkVersion = useCallback(async () => {
    try {
      const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      const current = data?.buildTime != null ? Number(data.buildTime) : null
      if (current == null) return
      const stored = sessionStorage.getItem(STORAGE_KEY)
      const storedNum = stored != null ? Number(stored) : null
      // First load: seed stored so we don't show banner until deploy changes buildTime
      if (storedNum === null) {
        sessionStorage.setItem(STORAGE_KEY, String(current))
        return
      }
      if (storedNum !== current) {
        setBuildTime(current)
        setShowBanner(true)
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    checkVersion()
    const id = setInterval(checkVersion, CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [checkVersion])

  const handleRefresh = () => {
    window.location.reload()
  }

  const handleDismiss = () => {
    if (buildTime != null) sessionStorage.setItem(STORAGE_KEY, String(buildTime))
    setShowBanner(false)
  }

  if (!showBanner) return null

  return (
    /* It appears while the page is open, in answer to a version check, so unlike the notices that
       are simply there when a page renders, this one announces itself politely. */
    <Notice
      tone="warn"
      layout="strip"
      live="polite"
      className={styles.sticky}
      action={
        <span className={styles.actions}>
          <Button
            variant="primary"
            size="sm"
            icon={<IconRefresh size={16} stroke={strokeFor(16)} />}
            onClick={handleRefresh}
          >
            Refresh
          </Button>
          <Button size="sm" onClick={handleDismiss}>
            Dismiss
          </Button>
        </span>
      }
    >
      A new version is available. Refresh to load the latest updates.
    </Notice>
  )
}
