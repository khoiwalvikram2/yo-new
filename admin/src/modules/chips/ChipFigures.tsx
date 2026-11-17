import type { ReactNode } from 'react'
import { useQuery } from '@apollo/client'
import { IconArrowsExchange, IconBuildingBank, IconCoins, IconGauge, IconLock, IconLockOpen, IconScale, IconTarget } from '@tabler/icons-react'
import clsx from 'clsx'
import { Stat, type StatHue } from '@/ui/components/Stat'
import { strokeFor } from '@/ui/components/icons'
import {
  CHIP_DOWNLINE_QUERY,
  type ChipAccount,
  type ChipDownlineData,
  type ChipDownlineVariables,
  type ChipPool,
} from '@/lib/graphql/chips'
import { CHIP_FIGURE_LABELS, CHIP_FIGURE_LOADING_NOTES, chipFigures, type ChipFigureKey } from './chipModel'
import { CHIP_READ_OPTIONS, useChipFormat } from './chipHooks'
import styles from './Chips.module.css'

const ICON = 18
const FIGURE_KEYS: readonly ChipFigureKey[] = ['creditReference', 'balance', 'exposure', 'available', 'refPnl']
// Decorative glyphs and ramp steps, as on every other stats row; neither carries the money's direction.
const FIGURE_LOOK: Record<ChipFigureKey, { icon: ReactNode; hue: StatHue }> = {
  creditReference: { icon: <IconTarget size={ICON} stroke={strokeFor(ICON)} />, hue: 'blu' },
  balance: { icon: <IconCoins size={ICON} stroke={strokeFor(ICON)} />, hue: 'ind' },
  exposure: { icon: <IconLock size={ICON} stroke={strokeFor(ICON)} />, hue: 'amb' },
  available: { icon: <IconLockOpen size={ICON} stroke={strokeFor(ICON)} />, hue: 'grn' },
  refPnl: { icon: <IconScale size={ICON} stroke={strokeFor(ICON)} />, hue: 'vio' },
}

export interface ChipFiguresProps {
  account?: ChipAccount | null
  /** Waiting for the first answer: the cards keep their height with placeholders (refetches keep the figures). */
  loading?: boolean
  /** Names the group for assistive tech. @default 'Chip figures' */
  label?: string
  /** The signed-in agent's own account: Ref P/L reads "Upline owes you" / "You owe upline". */
  self?: boolean
  className?: string
}

/**
 * The five figures of a chips account (spec §2): Credit Reference, Balance, Exposure, Available and Ref P/L.
 * Ref P/L is green when the upline owes the account and rose when the account owes the upline, with the
 * words under it.
 */
export function ChipFigures({ account, loading = false, label = 'Chip figures', self = false, className }: ChipFiguresProps) {
  const format = useChipFormat(account?.currency)
  const pending = loading && !account
  const figures = account ? chipFigures(account, format, self) : []

  return (
    <div className={clsx(styles.figuresWrap, className)}>
      <div className={styles.figures} role="group" aria-label={label} aria-busy={pending || undefined}>
        {FIGURE_KEYS.map((key) => {
          const figure = figures.find((item) => item.key === key)
          return (
            <Stat
              key={key}
              data-figure={key}
              label={CHIP_FIGURE_LABELS[key]}
              icon={FIGURE_LOOK[key].icon}
              hue={FIGURE_LOOK[key].hue}
              loading={pending}
              value={figure ? <span className={clsx(styles.num, figure.tone && styles[figure.tone])}>{figure.value}</span> : '—'}
              note={figure?.note ?? CHIP_FIGURE_LOADING_NOTES[key]}
            />
          )
        })}
      </div>
    </div>
  )
}

export interface ChipPoolFiguresProps {
  pool?: ChipPool | null
  loading?: boolean
  /** @default 'Whitelabel pool' */
  label?: string
  className?: string
}

/**
 * The admin's own downline, asked exactly as the Root accounts table asks for its first page, so one request
 * answers both. Its totals cover every root account, not just that page.
 */
const ROOT_DOWNLINE_VARIABLES: ChipDownlineVariables = { parentAgentId: null, query: null, accountType: null, offset: 0, limit: 20 }

/**
 * The whitelabel credit pool that the admin deposits root accounts from (spec decision 5). Owner decision
 * 2026-11-04 (T103): Pool limit, Pool used and Available add up (limit − pool used = available), and "Given out"
 * stays the chips the root accounts and their downline hold. Pool used is the pool's whole use (credit_used),
 * which player deposits and withdrawals and bonus cash move far more than chips do, so it is its own figure.
 */
export function ChipPoolFigures({ pool, loading = false, label = 'Whitelabel pool', className }: ChipPoolFiguresProps) {
  const format = useChipFormat(pool?.currency)
  const pending = loading && !pool
  const roots = useQuery<ChipDownlineData, ChipDownlineVariables>(CHIP_DOWNLINE_QUERY, {
    ...CHIP_READ_OPTIONS,
    variables: ROOT_DOWNLINE_VARIABLES,
  })
  const totals = roots.data?.agents?.chipDownline?.totals
  const givenOut = totals ? totals.balance + totals.downlineBalance : undefined
  const figures = [
    { key: 'limit', label: 'Pool limit', value: pool?.creditLimit, note: 'The whitelabel credit pool', icon: <IconBuildingBank size={ICON} stroke={strokeFor(ICON)} />, hue: 'blu', pending },
    { key: 'used', label: 'Pool used', value: pool?.used, note: 'Player deposits and withdrawals, bonus cash and chips out', icon: <IconGauge size={ICON} stroke={strokeFor(ICON)} />, hue: 'vio', pending },
    { key: 'available', label: 'Available', value: pool?.available, note: 'Free to deposit: pool limit − pool used', icon: <IconLockOpen size={ICON} stroke={strokeFor(ICON)} />, hue: 'grn', pending },
    { key: 'givenOut', label: 'Given out', value: givenOut, note: 'Chips held by root accounts and their downline', icon: <IconArrowsExchange size={ICON} stroke={strokeFor(ICON)} />, hue: 'amb', pending: roots.loading && !totals },
  ] as const

  return (
    <div className={clsx(styles.figuresWrap, className)}>
      <div className={styles.figures} data-count="4" role="group" aria-label={label} aria-busy={pending || undefined}>
        {figures.map((figure) => (
          <Stat
            key={figure.key}
            data-figure={figure.key}
            label={figure.label}
            icon={figure.icon}
            hue={figure.hue}
            loading={figure.pending}
            value={figure.value === undefined ? '—' : <span className={styles.num}>{format(figure.value)}</span>}
            note={figure.note}
          />
        ))}
      </div>
    </div>
  )
}
