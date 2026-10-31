export type CloudSyncStatus = 'idle' | 'syncing' | 'error' | 'success'

const SYNC_ENABLED_KEY = 'stakex_sync_enabled'
const SYNC_AUTO_KEY = 'stakex_sync_auto'

export function isSyncEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SYNC_ENABLED_KEY) === '1'
}

export function setSyncEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SYNC_ENABLED_KEY, enabled ? '1' : '0')
}

export function isAutoSyncEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SYNC_AUTO_KEY) === '1'
}

export function setAutoSyncEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SYNC_AUTO_KEY, enabled ? '1' : '0')
}

// Simulate a cloud sync call; replace with API integration later
export async function triggerManualSync(): Promise<CloudSyncStatus> {
  try {
    await new Promise((resolve) => setTimeout(resolve, 800))
    return 'success'
  } catch (_e) {
    return 'error'
  }
}


