import { useState, type RefObject } from 'react'
import { IconArrowsMaximize, IconArrowsMinimize, IconRefresh } from '@tabler/icons-react'
import { PageHeader } from '@/ui/components/PageHeader'
import { IconButton } from '@/ui/components/IconButton'
import { Switch } from '@/ui/components/Switch'
import { Select } from '@/ui/components/Select'
import { StatusPill } from '@/ui/components/StatusPill'
import { Notice } from '@/ui/components/Notice'
import styles from './LiveWorkspace.module.css'

export type LiveFeature = 'sports' | 'casino' | 'matka'

export interface LiveHeaderProps {
  autoRefresh: boolean
  setAutoRefresh: (value: boolean) => void
  handleRefresh: () => void
  compactMode: boolean
  setCompactMode: (value: boolean) => void
  pageContainerRef: RefObject<HTMLDivElement>
}

interface VendorElement extends HTMLElement {
  webkitRequestFullscreen?: () => void | Promise<void>
  mozRequestFullScreen?: () => void | Promise<void>
  msRequestFullscreen?: () => void | Promise<void>
}

interface VendorDocument extends Document {
  webkitExitFullscreen?: () => void | Promise<void>
  mozCancelFullScreen?: () => void | Promise<void>
  msExitFullscreen?: () => void | Promise<void>
}

const COPY = {
  sports: { title: 'Live Sports Intelligence', description: 'Running Markets' },
  casino: { title: 'Live Casino Intelligence', description: 'Live casino activity' },
  matka: { title: 'Live Matka Intelligence', description: 'Open bets only' },
} as const

export const CASINO_WINDOWS = [
  { label: '10m', value: '10' },
  { label: '15m', value: '15' },
  { label: '30m', value: '30' },
  { label: '1h', value: '60' },
  { label: '2h', value: '120' },
  { label: '3h', value: '180' },
  { label: '6h', value: '360' },
] as const

export function LiveWorkspaceHeader({
  feature, autoRefresh, setAutoRefresh, handleRefresh, compactMode,
  setCompactMode, pageContainerRef, windowMins, setWindowMins,
}: LiveHeaderProps & {
  feature: LiveFeature
  windowMins?: number
  setWindowMins?: (value: number) => void
}) {
  const [fullscreenError, setFullscreenError] = useState<string | null>(null)
  const [fullscreenPending, setFullscreenPending] = useState(false)

  async function toggleFullscreen() {
    if (fullscreenPending) return
    setFullscreenError(null)
    setFullscreenPending(true)
    try {
      if (!compactMode) {
        const element = pageContainerRef.current as VendorElement | null
        const enter = element && (element.requestFullscreen || element.webkitRequestFullscreen ||
          element.mozRequestFullScreen || element.msRequestFullscreen)
        if (!element || !enter) throw new Error('Fullscreen is not available in this browser.')
        await enter.call(element)
        setCompactMode(true)
      } else {
        const browserDocument = document as VendorDocument
        const exit = browserDocument.exitFullscreen || browserDocument.webkitExitFullscreen ||
          browserDocument.mozCancelFullScreen || browserDocument.msExitFullscreen
        if (!exit) throw new Error('Fullscreen is not available in this browser.')
        await exit.call(browserDocument)
        setCompactMode(false)
      }
    } catch (error: unknown) {
      setFullscreenError(error instanceof Error ? error.message : 'Unable to change fullscreen mode.')
    } finally {
      setFullscreenPending(false)
    }
  }

  return (
    <div className={styles.headerControls}>
      <PageHeader
        title={COPY[feature].title}
        eyebrow="Live intelligence"
        meta={
          <span className={styles.subtitle}>
            {feature === 'casino' ? <span>{`${windowMins ?? 10}m`}</span> : null}
            <StatusPill tone="ok">Live</StatusPill>
          </span>
        }
        actions={
          <div className={styles.controls}>
            <Switch label="Auto-refresh" size="sm" checked={autoRefresh} onChange={setAutoRefresh} />
            {feature === 'casino' && setWindowMins ? (
              <Select label="Time window" hideLabel size="sm" className={styles.windowSelect}
                value={String(windowMins ?? 10)} options={CASINO_WINDOWS}
                onChange={(value) => setWindowMins(Number(value))} />
            ) : null}
            <IconButton label="Refresh now" variant="bordered" icon={<IconRefresh size={17} />}
              onClick={handleRefresh} />
            <IconButton label={compactMode ? 'Exit fullscreen' : 'Enter fullscreen'} variant="bordered"
              icon={compactMode ? <IconArrowsMinimize size={17} /> : <IconArrowsMaximize size={17} />}
              aria-disabled={fullscreenPending} onClick={() => void toggleFullscreen()} />
          </div>
        }
      />
      {fullscreenError ? <Notice tone="error" live="polite">{fullscreenError}</Notice> : null}
    </div>
  )
}
