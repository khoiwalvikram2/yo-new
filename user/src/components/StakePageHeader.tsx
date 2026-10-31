import { ArrowLeft, HelpCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

type StakePageHeaderProps = {
  title: string
  onHelpClick?: () => void
}

/**
 * Shared account-page heading with a back action and optional contextual help.
 */
export default function StakePageHeader({ title, onHelpClick }: StakePageHeaderProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()

  return (
    <header className="user-account-header" data-page-header="title-only">
      <div className="user-account-header-row">
        <button
          type="button"
          aria-label={t('common.goBack')}
          onClick={() => navigate(-1)}
          className="user-account-back"
        >
          <ArrowLeft className="h-5 w-5 sm:h-5 sm:w-5" />
        </button>

        <h1 className="user-account-title">
          {title}
        </h1>

        {onHelpClick ? (
          <button
            type="button"
            aria-label={t('footer.help')}
            onClick={onHelpClick}
            className="user-account-help"
          >
            <HelpCircle className="h-5 w-5 sm:h-5 sm:w-5" />
          </button>
        ) : null}
      </div>
    </header>
  )
}
