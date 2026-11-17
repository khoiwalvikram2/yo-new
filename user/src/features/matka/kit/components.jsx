/* eslint-disable react/prop-types */
import { useId } from 'react';
import ModalSurface from '@/components/modals/ModalSurface';
import { getThemeMode } from '@/lib/theme';
import { LayoutGrid as FiGrid, BarChart3 as FiBarChart2, Activity as FiActivity, CreditCard as FiCreditCard,
 ArrowUpRight as FiArrowUpRight, ArrowDownLeft as FiArrowDownLeft, ArrowRight as FiArrowRight, ArrowLeft as FiArrowLeft,
 ChevronRight as FiChevronRight, Search as FiSearch, Bell as FiBell, CircleHelp as FiHelpCircle,
 Settings as FiSettings, Sun as FiSun, Moon as FiMoon, Plus as FiPlus, Minus as FiMinus, Star as FiStar,
 Clock as FiClock, X as FiX, Check as FiCheck, CheckCircle as FiCheckCircle, Download as FiDownload,
 Filter as FiFilter, Menu as FiMenu, Copy as FiCopy, Shield as FiShield, Lock as FiLock, User as FiUser,
 Layers as FiLayers, Heart as FiHeart, ExternalLink as FiExternalLink, Eye as FiEye, Mail as FiMail, AlertCircle as FiAlertCircle } from 'lucide-react';

const icons = { grid: FiGrid, markets: FiLayers, chart: FiBarChart2, activity: FiActivity,
  wallet: FiCreditCard, up: FiArrowUpRight, down: FiArrowDownLeft, arrow: FiArrowRight, back: FiArrowLeft,
  chevron: FiChevronRight, search: FiSearch, bell: FiBell, help: FiHelpCircle,
  settings: FiSettings, sun: FiSun, moon: FiMoon, plus: FiPlus, minus: FiMinus,
  star: FiStar, clock: FiClock, close: FiX, check: FiCheck, success: FiCheckCircle,
  download: FiDownload, filter: FiFilter, menu: FiMenu, copy: FiCopy, shield: FiShield,
  lock: FiLock, user: FiUser, layers: FiLayers, heart: FiHeart, external: FiExternalLink,
  eye: FiEye, mail: FiMail, alert: FiAlertCircle };

export function Icon({ name, size = 18, ...props }) {
  const Component = icons[name] || FiGrid;
  return <Component size={size} aria-hidden="true" strokeWidth={1.7} {...props} />;
}

export function Button({ children, variant = 'primary', icon = undefined, endIcon = undefined, className = '', ...props }) {
  return <button type="button" className={`m99-button m99-button-${variant} ${className}`} {...props}>
    {icon && <Icon name={icon} size={17} />}{children}{endIcon && <Icon name={endIcon} size={17} />}
  </button>;
}

export function IconButton({ icon, label, className = '', ...props }) {
  return <button type="button" className={`m99-icon-button ${className}`} aria-label={label} title={label} {...props}><Icon name={icon} /></button>;
}

export function Badge({ children, tone = 'neutral', dot = false }) {
  return <span className={`m99-badge m99-badge-${tone}`}>{dot && <i />}{children}</span>;
}

export function StatusBadge({ status }) {
  const tone = { Open: 'green', Completed: 'green', Upcoming: 'orange', Pending: 'orange', Failed: 'red', Closed: 'neutral' }[status];
  return <Badge tone={tone} dot>{status}</Badge>;
}

export function SectionHeading({ eyebrow, title, subtitle, action }) {
  return <div className="m99-section-heading"><div>{eyebrow && <div className="m99-eyebrow">{eyebrow}</div>}
    <h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

export function Field({ label, hint = undefined, error = undefined, id = undefined, className = '', ...props }) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  return <div className={`m99-field ${className}`}><label htmlFor={fieldId}>{label}</label>
    <input id={fieldId} aria-invalid={error ? true : undefined} aria-describedby={error || hint ? `${fieldId}-hint` : undefined} {...props} />
    {(error || hint) && <span id={`${fieldId}-hint`} className={error ? 'm99-field-error' : 'm99-field-hint'}>{error || hint}</span>}
  </div>;
}

export function Segmented({ options, value, onChange, label }) {
  return <div className="m99-segmented" role="group" aria-label={label}>
    {options.map(option => <button key={option} type="button" aria-pressed={value === option} className={value === option ? 'is-active' : ''} onClick={() => onChange(option)}>{option}</button>)}
  </div>;
}

/** @param {{ title?: string, description?: string, action?: import('react').ReactNode }} props */
export function EmptyState({ title = 'Nothing here just yet', description = 'Try another search or filter.', action = undefined }) {
  return <div className="m99-empty"><span className="m99-empty-icon"><Icon name="search" size={26} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Modal({ title, subtitle, children, onClose, className = '' }) {
  const titleId = useId();
  return <ModalSurface open onClose={onClose} title={title} titleId={titleId} hideHeader className="gw-matka-native-dialog">
    <div className={`m99-kit gw-matka-modal ${className}`} data-theme={getThemeMode()}><div className="m99-modal-heading"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton icon="close" label="Close dialog" onClick={onClose} /></div>{children}</div>
  </ModalSurface>;
}

export function MarketCard({ market, favorite, onFavorite, onView, onChart }) {
  const result = market.result.split(' – ');
  return <article data-market-item className={`m99-market-card m99-market-tile ${market.status === 'Closed' ? 'm99-market-muted' : ''}`} data-status={market.status}>
    <div className="m99-tile-meta"><span>{market.category} session</span><StatusBadge status={market.status} /></div>
    <div className="m99-tile-heading"><span className={`m99-market-avatar m99-tone-${market.tone}`}>{market.initials}</span><button type="button" className="m99-tile-name" onClick={() => onView(market)}><h3>{market.name}</h3><small>{market.tag ? `${market.tag} market` : 'Daily market'}</small></button>
      <IconButton icon="star" label={`${favorite ? 'Remove' : 'Add'} ${market.name} ${favorite ? 'from' : 'to'} favorites`} aria-pressed={favorite} className={favorite ? 'm99-favorite is-active' : 'm99-favorite'} onClick={() => onFavorite(market.id)} /></div>
    <div className="m99-tile-result"><span>{market.result.includes('*') ? 'Awaiting result' : 'Latest result'}</span><strong aria-label={market.result}>{result.map((part, index) => <span key={index} className={index === 1 ? 'is-jodi' : ''}>{index > 0 && <i aria-hidden="true">–</i>}<b className="m99-tile-digit">{part}</b></span>)}</strong></div>
    <SessionSchedule market={market} />
    <MarketChartLinks market={market} onChart={onChart} className="m99-tile-chart-links" />
    <div className="m99-tile-actions"><button type="button" className="m99-tile-open" aria-label={`Open ${market.name} market`} onClick={() => onView(market)}><span className="m99-tile-cta-label">{market.status === 'Open' && <span className="m99-market-signal" aria-hidden="true"><i /><i /><i /></span>}{market.status === 'Open' ? 'Open market' : 'View market'}</span><Icon name="arrow" size={16} /></button></div>
  </article>;
}

export function SessionSchedule({ market }) {
  return <div className="m99-session-schedule"><table><caption className="m99-sr-only">{market.name} session times in {market.timezoneLabel}</caption><thead><tr><th scope="col">{market.timezoneLabel}</th><th scope="col">Open</th><th scope="col">Close</th></tr></thead><tbody><tr><th scope="row">Result Time</th><td>{market.open}</td><td>{market.close}</td></tr><tr><th scope="row">Bid Last Time</th><td>{market.openBidLast}</td><td>{market.closeBidLast}</td></tr></tbody></table></div>;
}

export function MarketChartLinks({ market, onChart, className = '' }) {
  if (!onChart) return null;
  return <div className={`m99-market-chart-links ${className}`} role="group" aria-label={`${market.name} charts`}>{!['JACKPOT', 'SATTA_MATKA'].includes(market.kind) && <button type="button" aria-label={`${market.name} Panel Chart`} onClick={() => onChart(market, 'panel')}>Panel Chart</button>}{market.kind !== 'STARLINE' && <button type="button" aria-label={`${market.name} Jodi Chart`} onClick={() => onChart(market, 'jodi')}>Jodi Chart</button>}</div>;
}

