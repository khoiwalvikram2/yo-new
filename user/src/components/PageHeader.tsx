import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type PageHeaderProps = {
  title: string
  subtitle?: string
  icon: ReactNode
  showBack?: boolean
  iconBgClassName?: string
  className?: string
  id?: string
}

export default function PageHeader({
  title,
  icon,
  showBack = true,
  iconBgClassName,
  className,
  id,
}: PageHeaderProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()

  return (
    <header id={id} className={`user-page-header${className ? ` ${className}` : ''}`} data-page-header="title-only">
      <div className="user-page-heading">
        {showBack && (
          <button
            type="button"
            aria-label={t('common.goBack')}
            onClick={() => navigate(-1)}
            title={t('common.goBack')}
            className="user-page-back"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        {!showBack && icon ? <div className={`user-page-icon${iconBgClassName ? ` ${iconBgClassName}` : ''}`}>
          {icon}
        </div> : null}
        <div className="min-w-0 flex-1">
          <h1 className="user-page-title">{title}</h1>
        </div>
      </div>
    </header>
  )
}


