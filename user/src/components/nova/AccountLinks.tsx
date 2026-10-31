import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowDownCircle, ArrowUpCircle, FileText, Gift, Lock, LogOut, Ticket, UserRound, Users } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { useFeatureFlags, useParsedSettings } from '../../hooks/useAppSettings'

/**
 * The signed-in "Your account" list, shared by the rail drawer (NovaWorkspace, 801px and up) and the header's
 * phone sheet (Topbar ProfileDrawer), so both show the same rows. Funding stays behind
 * !settings.hideDW && !isCreditPlayer; bonus and referral behind their flags and credit play.
 */
export default function AccountLinks({ onClose, onChangePassword, onLogout }: { onClose: () => void; onChangePassword: () => void; onLogout: () => void }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const features = useFeatureFlags()
  const settings = useParsedSettings()
  const isCreditPlayer = user?.playerType === 'AGENT_CREDIT' || user?.playerType === 'WHITELABEL_CREDIT'
  const funding = !settings.hideDW && !isCreditPlayer
  const bonuses = (features.bonusesEnabled ?? true) && !isCreditPlayer
  const referrals = features.referralsEnabled && !isCreditPlayer

  return <div className="nova-panel-links">
    <p>{t('nova.welcomeBack')} <strong>{user?.username}</strong>.</p>
    {(funding || bonuses || referrals) && <>
      <h3 className="nova-panel-group">{t('statements.tabs.wallet')}</h3>
      {funding && <><Link to="/deposit" onClick={onClose}>{t('nav.deposit')} <ArrowDownCircle size={17} /></Link>
        <Link to="/withdrawal" onClick={onClose}>{t('nav.withdrawal')} <ArrowUpCircle size={17} /></Link></>}
      {bonuses && <Link to="/bonus" onClick={onClose}>{t('nav.bonus')} <Gift size={17} /></Link>}
      {referrals && <Link to="/referral" onClick={onClose}>{t('referral.title')} <Users size={17} /></Link>}
      <hr className="nova-panel-divider" />
    </>}
    <Link to="/my-bets" onClick={onClose}>{t('nav.myBets')} <Ticket size={17} /></Link>
    <Link to="/statements" onClick={onClose}>{t('nav.statements')} <FileText size={17} /></Link>
    <Link to="/settings" onClick={onClose}>{t('nova.accountSettings')} <UserRound size={17} /></Link>
    <button type="button" className="nova-panel-action" onClick={onChangePassword}>{t('settings.changePassword')} <Lock size={17} /></button>
    <button type="button" className="nova-panel-action is-logout" onClick={onLogout}>{t('nav.logout')} <LogOut size={17} /></button>
  </div>
}
