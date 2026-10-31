import { buttonClassName } from '@/ui/components/buttonClassName'
import styles from './blankScreenRecovery.module.css'

const SAVED_STATE_KEYS = ['auth-storage', 'rbac-store', 'ui-storage', 'sidebar-storage', 'dashboard-store-v2', 'sports-events-storage', 'notification-storage', 'reporting-store', 'audit-store', 'matka-live-store', 'worli-filters'] as const

/** Last-resort UI when React could not mount. Same explicit recovery actions, using active theme tokens. */
export function showBlankScreenRecovery(reload = () => window.location.reload()) {
  try {
    if (document.getElementById('admin-blank-recovery')) return
    const frame = document.createElement('div')
    frame.id = 'admin-blank-recovery'; frame.className = styles.recovery; frame.setAttribute('role', 'alert')
    const panel = document.createElement('section'); panel.className = styles.panel
    const title = document.createElement('h1'); title.className = styles.title; title.textContent = 'App didn’t load'
    const description = document.createElement('p'); description.className = styles.text; description.textContent = 'Try refreshing or clearing site data. Clearing saved data signs you out.'
    const actions = document.createElement('div'); actions.className = styles.actions
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = buttonClassName({ variant: 'primary' }); refresh.textContent = 'Refresh'
    refresh.addEventListener('click', reload)
    const clear = document.createElement('button'); clear.type = 'button'; clear.id = 'admin-blank-clear'; clear.className = buttonClassName({ variant: 'danger' }); clear.textContent = 'Clear data & refresh'
    clear.addEventListener('click', () => {
      for (const key of SAVED_STATE_KEYS) { try { localStorage.removeItem(key) } catch { /* Keep the other recovery keys independent. */ } }
      reload()
    })
    actions.append(refresh, clear); panel.append(title, description, actions); frame.append(panel); document.body.append(frame)
  } catch { /* Recovery must never prevent normal app startup. */ }
}
