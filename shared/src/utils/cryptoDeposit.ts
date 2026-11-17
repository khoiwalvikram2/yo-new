/**
 * Crypto deposits are quoted in USDT. A whitelabel sets ONE rate (wallet currency per 1 USDT) and
 * any number of wallets, each on its own network. Ported from the gw project; the address and
 * transaction-hash checks run on the server here, not only in the admin form.
 */
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

export function isCryptoNetwork(value: unknown): value is CryptoNetwork {
  return typeof value === 'string' && CRYPTO_NETWORKS.some((network) => network.value === value)
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
 * Why `address` cannot be a wallet on `network`, or null when it looks right. Funds sent to an
 * address on the wrong network are lost, so a wallet is checked against its network before it is saved.
 */
export function cryptoWalletAddressError(network: unknown, address: unknown): string | null {
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

/** A pasted transaction hash without the whitespace around it. */
export function normalizeCryptoTxHash(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Every supported chain writes its transaction hash in hex (Tron, EVM chains, with or without 0x),
 * base58 (Solana) or base64/base64url (TON), 20 to 128 characters long. Anything else — spaces,
 * markup, a sentence — is not a hash, and is never stored where an admin will read it.
 */
const TX_HASH = /^[0-9A-Za-z+/=_-]{20,128}$/

/**
 * Why `value` cannot be a transaction hash, or null. A crypto transfer can only be checked on-chain
 * by its hash, so it is required.
 */
export function cryptoTxHashError(value: unknown): string | null {
  const hash = normalizeCryptoTxHash(value)
  if (!hash) return 'Transaction hash is required for crypto deposits'
  if (!TX_HASH.test(hash)) return 'Enter the full transaction hash (TxID)'
  return null
}

/** A stored rate (numeric column or user input) as a usable number, or null when it is not set. */
export function parseCryptoRate(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * USDT a player must send for a deposit of `amount` at `rate`, rounded UP to 2 decimals so the
 * transfer never falls short of the amount credited. Null when the amount or rate is unusable.
 */
export function cryptoAmountFor(amount: number, rate: unknown): number | null {
  const r = parseCryptoRate(rate)
  if (r === null || !Number.isFinite(amount) || amount <= 0) return null
  // toFixed first: a division that is exact on paper can land a hair above a whole cent
  // (e.g. 110.00000000000001), and ceil would then charge one cent too many.
  return Math.ceil(Number(((amount / r) * 100).toFixed(6))) / 100
}

/** The highest crypto deposit bonus a whitelabel may set, in percent. */
export const CRYPTO_BONUS_MAX_PERCENT = 50

/** A stored or entered bonus percent as a usable number (above 0, at most 50), or null for no bonus. */
export function parseCryptoBonusPercent(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 && n <= CRYPTO_BONUS_MAX_PERCENT ? n : null
}

/**
 * The bonus paid on approving a crypto deposit of `amount` at `percent`, rounded DOWN to the paisa so it
 * is never more than promised: 5% of 9,000 is 450, the same as 105 USDT instead of 100 at the same rate.
 * 0 when there is no bonus.
 */
export function cryptoBonusFor(amount: number, percent: unknown): number {
  const p = parseCryptoBonusPercent(percent)
  if (p === null || !Number.isFinite(amount) || amount <= 0) return 0
  return Math.floor(Number(((amount * p) / 100 * 100).toFixed(6))) / 100
}

/**
 * Whether `userId` may use crypto deposits under an allow-list of user IDs such as "761, 802".
 * No list (unset or blank) means no restriction. A list that is set but holds no valid ID allows
 * nobody: a typo must never open crypto to every player.
 */
export function isCryptoAllowedForUser(allowList: string | null | undefined, userId: number | null | undefined): boolean {
  if (!allowList || !allowList.trim()) return true
  if (userId == null) return false
  const allowed = allowList.split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).map(Number)
  return allowed.includes(Number(userId))
}
