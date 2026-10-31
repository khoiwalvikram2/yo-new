import { Link } from 'react-router-dom'
import { CircleHelp, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../../lib/auth'
import { useAppIdentity, useParsedSettings } from '../../../hooks/useAppSettings'
import SectionHeader from './SectionHeader'

const QUESTIONS = ['1', '2', '3', '4', '5'] as const
/** The deposit/withdrawal answer, hidden from players who have no deposit or withdrawal (as in the header). */
const WALLET_QUESTION = '4'

/** "Good to know" accordion at the foot of the home page. */
export default function HomeFaq() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { hideDW } = useParsedSettings()
  const { supportEmail, supportPhone } = useAppIdentity()
  const isCreditPlayer = user?.playerType === 'AGENT_CREDIT' || user?.playerType === 'WHITELABEL_CREDIT'
  const questions = QUESTIONS.filter(id => id !== WALLET_QUESTION || (!hideDW && !isCreditPlayer))
  // Same destination as the sidebar's Help & support link.
  const supportHref = supportEmail
    ? `mailto:${supportEmail}`
    : supportPhone
      ? `tel:${supportPhone.replace(/[^+\d]/g, '')}`
      : '/terms'

  return <section className="nova-ex-faq" aria-labelledby="nova-ex-faq-title">
    <SectionHeader icon={<CircleHelp className="nova-ex-strip-icon" aria-hidden="true" />} title={t('homeFaq.title')} titleId="nova-ex-faq-title">
      {supportHref.startsWith('/')
        ? <Link to={supportHref} className="nova-ex-section-all">{t('homeFaq.help')}</Link>
        : <a href={supportHref} className="nova-ex-section-all">{t('homeFaq.help')}</a>}
    </SectionHeader>
    <div className="nova-ex-faq-list">
      {questions.map(id => <details key={id}>
        <summary>{t(`homeFaq.q${id}`)}<Plus aria-hidden="true" /></summary>
        <p>{t(`homeFaq.a${id}`)}</p>
      </details>)}
    </div>
  </section>
}
