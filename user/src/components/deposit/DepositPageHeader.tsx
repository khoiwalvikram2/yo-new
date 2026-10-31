import { useTranslation } from 'react-i18next'
import StakePageHeader from '../StakePageHeader'

type DepositPageHeaderProps = {
  onHelpClick?: () => void
}

export default function DepositPageHeader({ onHelpClick }: DepositPageHeaderProps) {
  const { t } = useTranslation()
  return <StakePageHeader title={t('nav.deposit')} onHelpClick={onHelpClick} />
}
