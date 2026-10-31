import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function NotFound() {
  const { t } = useTranslation()
  return (
    <div className="nova-acct nova-acct-error">
      <div className="nova-acct-error-card">
        <span className="nova-acct-error-code">404</span>
        <h1>{t('error.notFoundTitle')}</h1>
        <p>{t('error.notFoundDesc')}</p>
        <div className="nova-acct-error-actions">
          <Link to="/" className="is-primary">{t('error.goHome')}</Link>
        </div>
      </div>
    </div>
  )
}


