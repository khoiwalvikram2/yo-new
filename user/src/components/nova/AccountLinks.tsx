import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowDownCircle, ArrowUpCircle, FileText, Gift, Lock, LogOut, Ticket, UserRound, Users } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { useFeatureFlags, useParsedSettings } from '../../hooks/useAppSettings'
import { formatAmount } from '../../lib/currency'

/**
 * The signed-in "Your account" list, shared by the rail drawer (NovaWorkspace, 801px and up) and the header's
 * phone sheet (Topbar ProfileDrawer), so both show the same rows. Funding stays behind
 * !settings.hideDW && !isCreditPlayer; bonus and referral behind their flags and credit play. A credit player's
 * wallet group shows their credit reference and Ref P/L instead, with a note that their agent manages their chips.
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
  // Credit players (D/W chips): the credit reference their upline set (creditLimit; a reference only, it gates
  // nothing) and Ref P/L = balance - credit reference, above zero when the upline owes them, below zero when they
  // owe it. Rounded to cents; `|| 0` stops a -0 from printing as "-₹0.00".
  const creditReference = Number(user?.creditLimit) || 0
  const refPnl = Math.round(((Number(user?.balance) || 0) - creditReference) * 100) / 100 || 0

  return <div className="nova-panel-links">
    <p>{t('nova.welcomeBack')} <strong>{user?.username}</strong>.</p>
    {(isCreditPlayer || funding || bonuses || referrals) && <>
      <h3 className="nova-panel-group">{t('statements.tabs.wallet')}</h3>
      {isCreditPlayer && <>
        <dl className="nova-panel-chips">
          <div><dt>{t('wallet.creditReference')}</dt><dd>{formatAmount(creditReference)}</dd></div>
          <div><dt>{t('wallet.refPnl')}</dt><dd className={refPnl > 0 ? 'is-up' : refPnl < 0 ? 'is-down' : undefined}>{refPnl > 0 ? '+' : refPnl < 0 ? '−' : ''}{formatAmount(Math.abs(refPnl))}</dd></div>
        </dl>
        <p className="nova-panel-note">{t('wallet.chipsManagedByAgent')}</p>
      </>}
      {/* data-tone colours each row's icon (nova-modals.css; owner 2026-11-02). */}
      {funding && <><Link to="/deposit" data-tone="green" onClick={onClose}>{t('nav.deposit')} <ArrowDownCircle size={17} /></Link>
        <Link to="/withdrawal" data-tone="orange" onClick={onClose}>{t('nav.withdrawal')} <ArrowUpCircle size={17} /></Link></>}
      {bonuses && <Link to="/bonus" data-tone="pink" onClick={onClose}>{t('nav.bonus')} <Gift size={17} /></Link>}
      {referrals && <Link to="/referral" data-tone="violet" onClick={onClose}>{t('referral.title')} <Users size={17} /></Link>}
      <hr className="nova-panel-divider" />
    </>}
    <Link to="/my-bets" data-tone="teal" onClick={onClose}>{t('nav.myBets')} <Ticket size={17} /></Link>
    <Link to="/statements" data-tone="blue" onClick={onClose}>{t('nav.statements')} <FileText size={17} /></Link>
    <Link to="/settings" data-tone="cyan" onClick={onClose}>{t('nova.accountSettings')} <UserRound size={17} /></Link>
    <button type="button" className="nova-panel-action" data-tone="amber" onClick={onChangePassword}>{t('settings.changePassword')} <Lock size={17} /></button>
    <button type="button" className="nova-panel-action is-logout" data-tone="red" onClick={onLogout}>{t('nav.logout')} <LogOut size={17} /></button>
  </div>
}
