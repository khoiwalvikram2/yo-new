import { useTranslation } from 'react-i18next'
import StakePageHeader from '../StakePageHeader'

type WithdrawalPageHeaderProps = {
  onHelpClick?: () => void
}

export default function WithdrawalPageHeader({ onHelpClick }: WithdrawalPageHeaderProps) {
  const { t } = useTranslation()
  return <StakePageHeader title={t('nav.withdrawal')} onHelpClick={onHelpClick} />
}
