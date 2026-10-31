import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { IconAlertTriangle } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { strokeFor } from '@/ui/components/icons'
import styles from './ErrorBoundary.module.css'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
  componentStack?: string
}

/** Persisted store keys cleared on "Clear data and reload" to recover from corrupted state. */
const PERSIST_STORAGE_KEYS = [
  'auth-storage',
  'rbac-store',
  'ui-storage',
  'sidebar-storage',
  'dashboard-store-v2',
  'sports-events-storage',
  'notification-storage',
  'reporting-store',
  'audit-store',
  'matka-live-store',
  'worli-filters',
] as const

function clearPersistedStateAndReload() {
  try {
    PERSIST_STORAGE_KEYS.forEach((key) => {
      try {
        window.localStorage.removeItem(key)
      } catch {
        // ignore per-key failures
      }
    })
  } finally {
    window.location.reload()
  }
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo.componentStack)
    this.setState({ componentStack: errorInfo.componentStack ?? undefined })
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className={styles.screen}>
          <div className={styles.panel} role="alert">
            <span className={styles.tile} aria-hidden="true">
              <IconAlertTriangle size={24} stroke={strokeFor(24)} />
            </span>
            <h2 className={styles.title}>Something went wrong</h2>
            <p className={styles.text}>
              We&apos;re sorry, but something unexpected happened. If this keeps happening after refresh, clear
              saved data and reload (you will need to log in again).
            </p>
            <div className={styles.actions}>
              <Button variant="primary" block onClick={() => window.location.reload()}>
                Refresh Page
              </Button>
              {/* a real link, so it can be opened in a new tab; it used to be an antd Button with href */}
              <a className={buttonClassName({ block: true })} href="/overview">
                Go to Overview
              </a>
              <Button block onClick={() => this.setState({ hasError: false, error: undefined, componentStack: undefined })}>
                Try Again
              </Button>
              <Button variant="danger" block onClick={clearPersistedStateAndReload}>
                Clear data and reload
              </Button>
            </div>
            {/* Development builds show what threw, so a crash can be reported without opening the console. */}
            {import.meta.env.DEV && this.state.error ? (
              <details className={styles.details} open>
                <summary>Error details (development only)</summary>
                <pre>
                  {String(this.state.error.message || this.state.error)}
                  {this.state.error.stack ? '\n\n' + this.state.error.stack.split('\n').slice(0, 6).join('\n') : ''}
                  {this.state.componentStack ? '\n\nIn:' + this.state.componentStack.split('\n').slice(0, 8).join('\n') : ''}
                </pre>
              </details>
            ) : null}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
