import { forwardRef, useRef } from 'react'
import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode } from 'react'
import clsx from 'clsx'
import { IconAlertTriangle, IconArrowRight, IconChevronDown, IconWallet } from '@tabler/icons-react'
import { Spinner } from '@/ui/components/Spinner'
// The pure chips rules only: the module's index would pull its dialogs and tables into the shell.
import { chipTone, refPnlNote, roundChips, signedChips } from '@/modules/chips/chipModel'
import { creditAlertText } from './walletData'
import type { ChipWalletFigures, CreditFigures, CreditStatus, DomainKey, SharingSummary } from './walletData'
import type { FormatAmount } from './formatAmount'
import p from './TopbarPopover.module.css'
import s from './WalletIndicator.module.css'

export type WalletTab = 'credit' | 'chips' | 'sharing'

/** Props every wallet widget container takes (Tasks 42-45). compact = icon only, below 1024px (decision 2). */
export interface WalletWidgetProps {
  compact: boolean
}

const TAB_LABEL: Readonly<Record<WalletTab, string>> = {
  credit: 'Credit',
  chips: 'Chips',
  sharing: 'Sharing',
}

const DOMAIN_LABEL: Readonly<Record<DomainKey, string>> = {
  sports: 'Sports',
  casino: 'Casino',
  matka: 'Matka',
}

function toneClass(tone: CreditStatus | null): string | undefined {
  if (tone === 'healthy') return s.toneHealthy
  if (tone === 'warning') return s.toneWarning
  if (tone === 'critical') return s.toneCritical
  return undefined
}

export interface WalletTriggerProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** aria-label; includes the amount, because the compact trigger shows none */
  label: string
  amountText: string
  /** icon only (decision 2) */
  compact: boolean
  /** null = neutral (sharing / commission) */
  tone: CreditStatus | null
  showDot: boolean
}

/** forwardRef and ...rest are required: the trigger is cloned by the kit Popover. */
export const WalletTrigger = forwardRef<HTMLButtonElement, WalletTriggerProps>(function WalletTrigger(
  { label, amountText, compact, tone, showDot, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-label={label}
      className={clsx(s.trigger, compact && s.compact, toneClass(tone), className)}
    >
      <span className={s.triggerIcon} aria-hidden="true">
        <IconWallet size={18} stroke={1.75} />
        {showDot && <span className={s.triggerDot} />}
      </span>
      {!compact && <span className={s.triggerAmount}>{amountText}</span>}
      {!compact && (
        <span className={s.triggerChevron} aria-hidden="true">
          <IconChevronDown size={14} stroke={1.75} />
        </span>
      )}
    </button>
  )
})

/** Placeholder shown in the trigger's place while the first query loads. */
export function WalletTriggerLoading() {
  return (
    <span className={s.triggerLoading}>
      <Spinner size="sm" />
    </span>
  )
}

export interface WalletTabsProps {
  tabs: readonly WalletTab[]
  value: WalletTab
  onChange: (tab: WalletTab) => void
  /** tab id `${idPrefix}-tab-${tab}`, panel id `${idPrefix}-panel` */
  idPrefix: string
}

/** Segmented tab bar local to the wallet views (decision 4): roving tabIndex, Left/Right select and focus. */
export function WalletTabs({ tabs, value, onChange, idPrefix }: WalletTabsProps) {
  const tabRefs = useRef<Partial<Record<WalletTab, HTMLButtonElement | null>>>({})

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: WalletTab) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const step = event.key === 'ArrowRight' ? 1 : -1
    const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]
    tabRefs.current[next]?.focus()
    onChange(next)
  }

  return (
    <div role="tablist" className={s.tabList}>
      {tabs.map((tab) => {
        const selected = tab === value
        return (
          <button
            key={tab}
            ref={(node) => {
              tabRefs.current[tab] = node
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            className={s.tab}
            onClick={() => onChange(tab)}
            onKeyDown={(event) => handleKeyDown(event, tab)}
          >
            {TAB_LABEL[tab]}
          </button>
        )
      })}
    </div>
  )
}

export interface WalletPanelProps {
  titleId: string
  title: string
  subtitle: string
  tone: CreditStatus | null
  /** shown only when non-null */
  statusLabel: string | null
  tabs?: ReactNode
  /** id of the element with role="tabpanel" when tabs are present */
  tabPanelId?: string
  tabLabelledBy?: string
  children: ReactNode
  footer: { label: string; onClick: () => void } | null
}

/** Wallet popover content frame: head, optional tabs, body (the tabpanel when tabbed), optional footer. */
export function WalletPanel({
  titleId,
  title,
  subtitle,
  tone,
  statusLabel,
  tabs,
  tabPanelId,
  tabLabelledBy,
  children,
  footer,
}: WalletPanelProps) {
  const hasTabs = tabs !== undefined && tabs !== null && tabs !== false

  return (
    <div className={clsx(p.panel, s.wallet, toneClass(tone))}>
      <div className={p.head} data-ui-radius="panel-head">
        <span className={s.tile} aria-hidden="true">
          <IconWallet size={16} stroke={1.75} />
        </span>
        <div className={p.headText}>
          <span id={titleId} className={p.title}>
            {title}
          </span>
          <span className={p.subtitle}>{subtitle}</span>
        </div>
        {statusLabel !== null && <span className={s.statusPill}>{statusLabel}</span>}
      </div>
      {hasTabs && <div className={s.tabs}>{tabs}</div>}
      <div
        className={p.body}
        role={hasTabs ? 'tabpanel' : undefined}
        id={hasTabs ? tabPanelId : undefined}
        aria-labelledby={hasTabs ? tabLabelledBy : undefined}
        tabIndex={hasTabs ? 0 : undefined}
      >
        {children}
      </div>
      {footer !== null && (
        <div className={p.foot}>
          <button type="button" className={p.footAction} onClick={footer.onClick}>
            {footer.label}
            <span className={p.footIcon} aria-hidden="true">
              <IconArrowRight size={14} stroke={1.75} />
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

export interface CreditBodyProps {
  credit: CreditFigures
  formatAmount: FormatAmount
}

/** Credit tab content. formatAmount takes no currency argument here, as today. */
export function CreditBody({ credit, formatAmount }: CreditBodyProps) {
  const usage = credit.usagePercentage
  const meter = Math.min(Math.max(usage, 0), 100)
  const alertText = creditAlertText(credit)

  return (
    <>
      <div className={s.section}>
        <span className={s.heroLabel}>Available Credit</span>
        <span className={clsx(s.heroValue, s.toned)}>{formatAmount(credit.creditAvailable)}</span>
      </div>
      <div className={s.section}>
        <div className={s.meterTop}>
          <span>Usage</span>
          <span className={s.meterValue}>{usage.toFixed(1)}%</span>
        </div>
        <div
          className={s.bar}
          role="progressbar"
          aria-label="Credit usage"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={meter}
        >
          <span className={s.barFill} style={{ width: `${meter}%` }} />
        </div>
        <dl className={s.stats}>
          <dt className={s.statLabel}>Limit</dt>
          <dd className={s.statValue}>{formatAmount(credit.creditLimit)}</dd>
          <dt className={s.statLabel}>Used</dt>
          <dd className={s.statValue}>{formatAmount(credit.creditUsed)}</dd>
        </dl>
      </div>
      {alertText !== null && (
        <div className={s.alert}>
          <span className={s.alertIcon} aria-hidden="true">
            <IconAlertTriangle size={16} stroke={1.75} />
          </span>
          <p className={s.alertText}>{alertText}</p>
        </div>
      )}
    </>
  )
}

export interface SharingBodyProps {
  sharing: SharingSummary | null
  loading: boolean
  formatAmount: FormatAmount
  periodLabel: 'Period' | 'Current Period'
  /** keep today's 256px scroll cap on the domain list */
  capped: boolean
}

/** Sharing / commission content. formatAmount takes the payload currency, as today. */
export function SharingBody({ sharing, loading, formatAmount, periodLabel, capped }: SharingBodyProps) {
  if (sharing === null) {
    return loading ? (
      <div className={p.loading}>
        <Spinner size="md" />
      </div>
    ) : (
      <p className={p.note}>No sharing data available</p>
    )
  }

  return (
    <>
      <div className={s.section}>
        <span className={s.heroLabel}>Current Period Total</span>
        <span className={s.heroValue}>{formatAmount(sharing.currentPeriodTotal, sharing.currency)}</span>
      </div>
      {sharing.rows.length > 0 && (
        <div className={clsx(s.domains, capped && s.domainsCapped)}>
          {sharing.rows.map((row) => (
            <div key={row.domain} className={s.domainRow}>
              <div className={s.domainHead}>
                <span className={s.domainLabel}>{DOMAIN_LABEL[row.domain]}</span>
                {row.rate > 0 && <span className={s.rate}>{row.rate.toFixed(2)}%</span>}
              </div>
              <div className={s.figures}>
                <div className={s.figure}>
                  <span className={s.figureLabel}>All-Time</span>
                  <span className={s.figureValue}>{formatAmount(row.allTime, sharing.currency)}</span>
                </div>
                <div className={s.figure}>
                  <span className={s.figureLabel}>{periodLabel}</span>
                  <span className={s.figureValue}>{formatAmount(row.currentPeriod, sharing.currency)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export interface ChipBodyProps {
  chips: ChipWalletFigures
  formatAmount: FormatAmount
}

/**
 * The CREDIT agent's wallet content (spec 2026-11-02 §8): its balance, what its downline holds, its
 * credit reference and Ref P/L, in the account's currency. Ref P/L is green when the upline owes the
 * agent and rose when the agent owes the upline, with the words beside it, spoken to the agent: the
 * topbar wallet is always the signed-in agent's own.
 */
export function ChipBody({ chips, formatAmount }: ChipBodyProps) {
  const format = (value: number) => formatAmount(roundChips(value), chips.currency)
  const tone = chipTone(chips.refPnl)

  return (
    <div className={s.section}>
      <span className={s.heroLabel}>Balance</span>
      <span className={s.heroValue}>{format(chips.balance)}</span>
      <dl className={s.stats}>
        <dt className={s.statLabel}>Downline balance</dt>
        <dd className={s.statValue}>{format(chips.downlineBalance)}</dd>
        <dt className={s.statLabel}>Credit reference</dt>
        <dd className={s.statValue}>{format(chips.creditReference)}</dd>
        <dt className={s.statLabel}>
          Ref P/L
          <span className={s.statNote}>{refPnlNote(chips.refPnl, true)}</span>
        </dt>
        <dd className={clsx(s.statValue, tone === 'gain' && s.gain, tone === 'loss' && s.loss)}>{signedChips(chips.refPnl, format)}</dd>
      </dl>
    </div>
  )
}
