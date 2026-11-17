import type { ChipAccount, ChipStatementRow } from '@/lib/graphql/chips'

/* The arithmetic and wording of the CREDIT scheme on chips (spec 2026-11-02 §2, §4 and §8), kept out of the
   components so each rule is written once and tested on its own. The server is the authority on every
   figure and refuses what it must; these rules only decide what the screens offer and say. */

export type ChipDirection = 'deposit' | 'withdraw'
export type ChipFormat = (value: number) => string

/** Chips are kept to 2 decimals (spec §2). The exponent form rounds 1.005 to 1.01, where value * 100 would not. */
export function roundChips(value: number): number {
  if (!Number.isFinite(value)) return value
  const magnitude = Math.abs(value)
  const text = String(magnitude)
  const rounded = text.includes('e') ? Math.round(magnitude * 100) / 100 : Number(`${Math.round(Number(`${text}e2`))}e-2`)
  return value < 0 && rounded !== 0 ? -rounded : rounded
}

/** In green, out rose (the owner's colour pass): the tone of a signed figure, none at zero. */
export type ChipTone = 'gain' | 'loss'

export function chipTone(value: number): ChipTone | undefined {
  const rounded = roundChips(value)
  return rounded > 0 ? 'gain' : rounded < 0 ? 'loss' : undefined
}

/** "+₹500.00", "−₹500.00" or "₹0.00": the sign spelled out, the magnitude in the currency's format. */
export function signedChips(value: number, format: ChipFormat): string {
  const rounded = roundChips(value)
  if (rounded > 0) return `+${format(rounded)}`
  if (rounded < 0) return `−${format(-rounded)}`
  return format(0)
}

/**
 * Ref P/L in words. Positive: the upline owes this account; negative: it owes the upline. `self` words it for
 * the signed-in agent looking at its own figures (its dashboard, its Chips page, its topbar wallet).
 */
export function refPnlNote(refPnl: number, self = false): string {
  const rounded = roundChips(refPnl)
  if (rounded > 0) return self ? 'Upline owes you' : 'Upline owes'
  if (rounded < 0) return self ? 'You owe upline' : 'Owes upline'
  return 'Nothing owed'
}

export type ChipFigureKey = 'creditReference' | 'balance' | 'exposure' | 'available' | 'refPnl'

export interface ChipFigure {
  key: ChipFigureKey
  label: string
  value: string
  note: string
  /** Ref P/L only. */
  tone?: ChipTone
}

/**
 * The five figures of one account, in the order every chips screen shows them. An agent's balance note
 * carries its downline balance: an agent's Ref P/L is its own balance plus the downline's, less its credit
 * reference, so the strip would not add up without it. `self`: the signed-in agent's own account (see refPnlNote).
 */
export function chipFigures(account: ChipAccount, format: ChipFormat, self = false): ChipFigure[] {
  const agent = account.accountType === 'AGENT'
  return [
    { key: 'creditReference', label: 'Credit Reference', value: format(account.creditReference), note: 'Reference only' },
    {
      key: 'balance',
      label: 'Balance',
      value: format(account.balance),
      note: agent ? `Downline holds ${format(account.downlineBalance)}` : 'Chips in the wallet',
    },
    { key: 'exposure', label: 'Exposure', value: format(account.exposure), note: agent ? 'Open bets in the downline' : 'Held for open bets' },
    { key: 'available', label: 'Available', value: format(account.available), note: agent ? 'Free to deposit' : 'Balance − exposure' },
    { key: 'refPnl', label: 'Ref P/L', value: signedChips(account.refPnl, format), note: refPnlNote(account.refPnl, self), tone: chipTone(account.refPnl) },
  ]
}

/** The notes the figures show before the first answer, so the placeholders hold the same lines. */
export const CHIP_FIGURE_LOADING_NOTES: Record<ChipFigureKey, string> = {
  creditReference: 'Reference only',
  balance: 'Chips in the wallet',
  exposure: 'Held for open bets',
  available: 'Balance − exposure',
  refPnl: 'Nothing owed',
}

export const CHIP_FIGURE_LABELS: Record<ChipFigureKey, string> = {
  creditReference: 'Credit Reference',
  balance: 'Balance',
  exposure: 'Exposure',
  available: 'Available',
  refPnl: 'Ref P/L',
}

/**
 * Only the direct parent moves chips or sets a credit reference (spec decision 3). An agent acts on the
 * accounts whose parent it is; an admin, acting as the whitelabel (no agent id), on the root accounts:
 * the root CREDIT agents and the WHITELABEL_CREDIT players, whose parentAgentId is null.
 */
export function isDirectParent(account: Pick<ChipAccount, 'parentAgentId'>, actorAgentId: string | null): boolean {
  return actorAgentId === null ? !account.parentAgentId : account.parentAgentId === actorAgentId
}

/**
 * The create forms' note where Opening chips would be. The same rule holds at creation: only the new account's
 * direct parent may deposit its opening chips (the server refuses anyone else), so an admin creating an account
 * under an agent, or an agent creating one for its sub-agent, leaves them to that agent.
 */
export const OPENING_CHIPS_UPLINE_HINT = 'The upline agent deposits chips after the account is created.'

/** An account takes deposits only while ACTIVE (spec §4.1); withdrawals always work, so chips can be recovered. */
export function isActiveStatus(status: string | null | undefined): boolean {
  return !status || status.toUpperCase() === 'ACTIVE'
}

export function statusWord(status: string | null | undefined): string {
  return (status ?? '').toLowerCase().replace(/_/g, ' ') || 'inactive'
}

/** Why a deposit to this account is refused, or null when it is not. */
export function depositPausedReason(account: Pick<ChipAccount, 'username' | 'status'>): string | null {
  return isActiveStatus(account.status) ? null : `Deposits are paused while ${account.username} is ${statusWord(account.status)}`
}

/**
 * "Settle to credit reference" (spec decision 8): move |Ref P/L| so the balance meets the credit reference
 * again. Ref P/L above zero (the downline won and is paid in cash) is withdrawn; below zero (it lost and
 * pays in cash) is deposited. Null when there is nothing to settle.
 */
export function settlePlan(refPnl: number): { direction: ChipDirection; amount: number } | null {
  const amount = roundChips(Math.abs(refPnl))
  if (!Number.isFinite(amount) || amount === 0) return null
  return { direction: refPnl > 0 ? 'withdraw' : 'deposit', amount }
}

export interface TransferCheck {
  direction: ChipDirection
  amount: number | null
  /** The giver's free chips on a deposit: the parent agent's balance, or the whitelabel pool's available.
   *  Null when unknown (still loading, or not readable): the server checks it then. */
  parentFree: number | null
  parentName: string
  /** The account's free chips: a player's balance − exposure, an agent's balance. */
  childFree: number
  childName: string
}

function freeText(name: string, free: number, format: ChipFormat): string {
  return roundChips(free) > 0 ? `${name} has ${format(roundChips(free))} free` : `${name} has no free chips`
}

/**
 * What is wrong with an amount, or null when it may be sent. A deposit cannot take more than the parent's
 * free chips; a withdrawal cannot take more than the account's free chips (spec decision 4). No amount yet
 * is not an error; the submit button just waits for one.
 */
export function transferProblem(check: TransferCheck, format: ChipFormat): string | null {
  const { direction, amount } = check
  if (amount === null) return null
  const value = roundChips(amount)
  if (!Number.isFinite(value) || value <= 0) return 'Enter an amount above 0'
  if (direction === 'deposit' && check.parentFree !== null && value > roundChips(check.parentFree)) {
    return `Not enough chips: ${freeText(check.parentName, check.parentFree, format)}`
  }
  if (direction === 'withdraw' && value > roundChips(check.childFree)) {
    return `Not enough free chips: ${freeText(check.childName, check.childFree, format)}`
  }
  return null
}

/** A credit reference is any amount from 0 up (spec §4.3); null while the field is empty. */
export function creditReferenceProblem(value: number | null): string | null {
  if (value === null) return null
  const rounded = roundChips(value)
  if (!Number.isFinite(rounded)) return 'Enter a valid amount'
  if (rounded < 0) return 'The credit reference cannot be below 0'
  return null
}

/** Ref P/L once the credit reference changes: it moves by the same difference, the other way (spec §2). */
export function refPnlAfterReference(account: Pick<ChipAccount, 'refPnl' | 'creditReference'>, nextReference: number): number {
  return roundChips(account.refPnl + account.creditReference - nextReference)
}

/**
 * The words to show for a failed request: the server's own first message (the chips API words its
 * refusals for the screen, e.g. "Not enough chips: available 1,200.00"), else the error's message, else
 * the fallback.
 */
export function chipErrorMessage(error: unknown, fallback = 'The request failed. Try again.'): string {
  if (!error || typeof error !== 'object') return fallback
  const graphQLErrors = (error as { graphQLErrors?: ReadonlyArray<{ message?: string } | null> }).graphQLErrors
  const first = graphQLErrors?.find((item) => item?.message)?.message
  if (first) return first
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && message.trim() ? message : fallback
}

export function accountTypeLabel(account: Pick<ChipAccount, 'accountType'>): string {
  return account.accountType === 'AGENT' ? 'Agent' : 'Player'
}

/** The profile an account's View action opens (router: /agents/:id and ROUTES.PLAYERS_PROFILE). */
export function chipProfilePath(account: Pick<ChipAccount, 'accountType' | 'id'>): string {
  return account.accountType === 'AGENT' ? `/agents/${account.id}` : `/players/profile/${account.id}`
}

export const CHIP_KIND_LABELS: Record<string, string> = {
  OPENING: 'Opening',
  DEPOSIT: 'Deposit',
  WITHDRAW: 'Withdraw',
  CREDIT_REFERENCE: 'Credit reference',
}

export function chipKindLabel(kind: string): string {
  return CHIP_KIND_LABELS[kind] ?? kind.toLowerCase().replace(/_/g, ' ')
}

const COUNTERPARTY_TYPES: Record<string, string> = { agent: 'Agent', player: 'Player', whitelabel: 'Whitelabel' }

/** The other side of a movement: its name and kind of account, or nulls when there is none (an opening row). */
export function chipCounterparty(row: Pick<ChipStatementRow, 'counterpartyType' | 'counterpartyId' | 'counterpartyName'>): { name: string | null; type: string | null } {
  const kind = row.counterpartyType ? row.counterpartyType.toLowerCase() : null
  const type = kind ? COUNTERPARTY_TYPES[kind] ?? row.counterpartyType ?? null : null
  const name = row.counterpartyName || (kind === 'whitelabel' ? 'Whitelabel pool' : row.counterpartyId || null)
  return { name, type: name ? type : null }
}
