import { createRoot } from 'react-dom/client'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import './index.css'
import './lib/i18n'
import { AppProviders } from './app/providers'
import { AppRouter } from './app/router'
import { ErrorBoundary } from './shared/core/ErrorBoundary'
import { showBlankScreenRecovery } from './lib/blankScreenRecovery'
import recoveryStyles from './lib/blankScreenRecovery.module.css'

// Default timezone for dayjs (admin uses IST for date boundaries and display)
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault('Asia/Kolkata')

/** Hide browser-extension overlays (e.g. Veepn) so the app stays usable. Runs after React mount to avoid blocking initial render. */
function disableExtensionOverlay() {
  try {
    if (typeof document === 'undefined' || !document.body) return
    const SELECTOR = 'veepn-lock-screen, [id*="veepn"][id*="lock"], [class*="veepn-lock"]'
    const hide = (el: Element) => {
      try {
        const html = el as HTMLElement
        if (html && html.style) {
          html.style.setProperty('display', 'none', 'important')
          html.style.setProperty('pointer-events', 'none', 'important')
          html.style.setProperty('visibility', 'hidden', 'important')
        }
      } catch {
        // ignore per-element
      }
    }
    const hideAll = () => {
      try {
        document.querySelectorAll(SELECTOR).forEach(hide)
      } catch {
        // ignore
      }
    }
    // Defer so React can mount first; don't block initial render
    const run = () => {
      hideAll()
      try {
        const observer = new MutationObserver(() => {
          setTimeout(hideAll, 0)
        })
        observer.observe(document.body, { childList: true, subtree: true })
      } catch {
        // ignore
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run)
    } else {
      setTimeout(run, 0)
    }
  } catch {
    // Never block app load
  }
}

const BLANK_SCREEN_CHECK_MS = 4_000

function isRootEffectivelyEmpty(el: HTMLElement | null): boolean {
  if (!el || !el.firstChild) return true
  const first = el.firstChild as HTMLElement
  if (first.nodeType !== 1) return true
  const style = window.getComputedStyle(first)
  if (style.display === 'none' || style.visibility === 'hidden') return true
  return first.offsetHeight === 0
}

const rootEl = document.getElementById('root')
if (!rootEl) {
  console.error('[Admin] #root element not found')
  showBlankScreenRecovery()
} else {
  createRoot(rootEl).render(
    <ErrorBoundary>
      <div className={recoveryStyles.host}>
        <AppProviders>
          <AppRouter />
        </AppProviders>
      </div>
    </ErrorBoundary>
  )
  disableExtensionOverlay()
  setTimeout(() => {
    if (isRootEffectivelyEmpty(rootEl)) showBlankScreenRecovery()
  }, BLANK_SCREEN_CHECK_MS)
}
