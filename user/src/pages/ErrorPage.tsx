import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function ErrorPage() {
  const error = useRouteError()
  const isResponse = isRouteErrorResponse(error)
  const status = isResponse ? error.status : 500
  const { t } = useTranslation()
  const statusText = isResponse ? error.statusText : t('error.unexpected')
  const message = isResponse ? (error.data as any)?.message || statusText : (error as any)?.message || statusText

  return (
    <div className="nova-acct nova-acct-error">
      <div className="nova-acct-error-card">
        <span className="nova-acct-error-code is-alert" aria-hidden="true">!</span>
        <h1>{status} {statusText}</h1>
        <p>{message}</p>
        <div className="nova-acct-error-actions">
          <Link to="/">{t('error.goHome')}</Link>
          <button type="button" onClick={() => window.location.reload()} className="is-primary">{t('error.reload')}</button>
        </div>
      </div>
    </div>
  )
}


