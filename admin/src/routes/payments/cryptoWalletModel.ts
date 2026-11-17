/**
 * USDT wallets, shared by the payment-method pages and the deposit review: the networks, the address check,
 * the USDT quote and bonus arithmetic, and the block-explorer links. The rules mirror
 * shared/src/utils/cryptoDeposit.ts, which the server applies on every save and request; these copies only
 * give the admin instant feedback and previews. The server's figures are the ones stored.
 */

/** Crypto deposits are quoted in this coin; one rate per whitelabel converts it to the deposit currency. */
export const CRYPTO_COIN = 'USDT'

export const CRYPTO_NETWORKS = [
  { value: 'TRC20', label: 'TRC20 (Tron)' },
  { value: 'BEP20', label: 'BEP20 (BNB Smart Chain)' },
  { value: 'ERC20', label: 'ERC20 (Ethereum)' },
  { value: 'POLYGON', label: 'Polygon' },
  { value: 'SOLANA', label: 'Solana' },
  { value: 'TON', label: 'TON' },
] as const

export type CryptoNetwork = (typeof CRYPTO_NETWORKS)[number]['value']

/** A new wallet starts on Tron, the most common USDT network. */
export const DEFAULT_CRYPTO_NETWORK: CryptoNetwork = 'TRC20'

/** The highest deposit bonus a whitelabel may set, in percent (the server enforces the same). */
export const CRYPTO_BONUS_MAX_PERCENT = 50

/** The highest USDT rate the server accepts. */
export const CRYPTO_RATE_MAX = 1_000_000

export function isCryptoNetwork(value: unknown): value is CryptoNetwork {
  return typeof value === 'string' && CRYPTO_NETWORKS.some((network) => network.value === value)
}

/** "TRC20 (Tron)" for TRC20; a value this list does not know is shown as stored, a missing one as a dash. */
export function cryptoNetworkLabel(network: string | null | undefined): string {
  if (!network) return '—'
  return CRYPTO_NETWORKS.find((option) => option.value === network)?.label ?? network
}

/** The name a wallet is listed by: its display name, else "USDT (TRC20)". */
export function cryptoWalletTitle(wallet: { displayName?: string | null; network?: string | null }): string {
  return wallet.displayName?.trim() || `${CRYPTO_COIN} (${wallet.network || '—'})`
}

const BASE58 = '1-9A-HJ-NP-Za-km-z'
const EVM_ADDRESS = { test: /^0x[0-9a-fA-F]{40}$/, hint: 'start with 0x followed by 40 hex characters' }

/** Networks whose address format is unambiguous. TON only gets the generic checks. */
const ADDRESS_FORMATS: Partial<Record<CryptoNetwork, { test: RegExp; hint: string }>> = {
  TRC20: { test: new RegExp(`^T[${BASE58}]{33}$`), hint: 'start with T and be 34 characters long' },
  BEP20: EVM_ADDRESS,
  ERC20: EVM_ADDRESS,
  POLYGON: EVM_ADDRESS,
  SOLANA: { test: new RegExp(`^[${BASE58}]{32,44}$`), hint: 'be 32 to 44 base58 characters' },
}

/**
 * Why `address` cannot be a wallet on `network`, or null when it looks right. Funds sent to an address on
 * another network are lost, so a pasted address is checked against the chosen network. Same rules and
 * messages as the server's cryptoWalletAddressError.
 */
export function walletAddressError(network: unknown, address: unknown): string | null {
  if (!isCryptoNetwork(network)) return 'Choose a supported network'
  const value = typeof address === 'string' ? address.trim() : ''
  if (!value) return 'Wallet address is required'
  if (/\s/.test(value)) return 'Wallet address cannot contain spaces'
  if (value.length > 128) return 'Wallet address is too long'
  const format = ADDRESS_FORMATS[network]
  if (format && !format.test.test(value)) return `A ${network} address must ${format.hint}`
  if (!format && value.length < 20) return 'Wallet address is too short'
  return null
}

/** A rate (stored or typed) as a usable number: finite and above 0, else null (not set). */
export function parseCryptoRate(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * USDT a player is asked to send for a deposit of `amount` at `rate`, rounded UP to 2 decimals so the
 * transfer never falls short of the amount credited. Null when the amount or rate is unusable.
 */
export function cryptoAmountFor(amount: number, rate: unknown): number | null {
  const r = parseCryptoRate(rate)
  if (r === null || !Number.isFinite(amount) || amount <= 0) return null
  // toFixed first: a division that is exact on paper can land a hair above a whole cent
  // (e.g. 110.00000000000001), and ceil would then ask for one cent too many.
  return Math.ceil(Number(((amount / r) * 100).toFixed(6))) / 100
}

/** A bonus percent (stored or typed) as a usable number: above 0 and at most 50, else null (no bonus). */
export function parseCryptoBonusPercent(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 && n <= CRYPTO_BONUS_MAX_PERCENT ? n : null
}

/**
 * The bonus paid on approving a crypto deposit of `amount` at `percent`, rounded DOWN to the paisa so it is
 * never more than promised. 0 when there is no bonus.
 */
export function cryptoBonusFor(amount: number, percent: unknown): number {
  const p = parseCryptoBonusPercent(percent)
  if (p === null || !Number.isFinite(amount) || amount <= 0) return 0
  return Math.floor(Number((((amount * p) / 100) * 100).toFixed(6))) / 100
}

/** "108.11 USDT". */
export function formatUsdt(amount: number): string {
  return `${amount.toFixed(2)} ${CRYPTO_COIN}`
}

/** Each network's transaction page; the hash is appended. */
const EXPLORER_TX_URLS: Record<CryptoNetwork, string> = {
  TRC20: 'https://tronscan.org/#/transaction/',
  BEP20: 'https://bscscan.com/tx/',
  ERC20: 'https://etherscan.io/tx/',
  POLYGON: 'https://polygonscan.com/tx/',
  SOLANA: 'https://solscan.io/tx/',
  TON: 'https://tonviewer.com/transaction/',
}

/**
 * The block explorer page of transaction `hash` on `network`, where an admin checks a crypto deposit before
 * approving it. Null for a network this list does not know or an empty hash.
 */
export function cryptoExplorerTxUrl(network: string | null | undefined, hash: string | null | undefined): string | null {
  const value = (hash ?? '').trim()
  if (!value || !isCryptoNetwork(network)) return null
  return `${EXPLORER_TX_URLS[network]}${encodeURIComponent(value)}`
}
