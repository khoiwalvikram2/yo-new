/**
 * Crypto deposits are paid in USDT. The whitelabel sets ONE rate (wallet currency per 1 USDT); each
 * wallet lives on its own network. Ported from the gw player app. The server does the real work in
 * shared/src/utils/cryptoDeposit.ts (same formulas): everything here is a preview, and the figures the
 * server returns with a request (cryptoAmount, cryptoBonusAmount) are the ones a receipt or the history shows.
 */
export const CRYPTO_COIN = 'USDT'

/** The networks a wallet can be on, with the names players know them by (same list as the server). */
export const CRYPTO_NETWORKS = [
  { value: 'TRC20', label: 'TRC20 (Tron)' },
  { value: 'BEP20', label: 'BEP20 (BNB Smart Chain)' },
  { value: 'ERC20', label: 'ERC20 (Ethereum)' },
  { value: 'POLYGON', label: 'Polygon' },
  { value: 'SOLANA', label: 'Solana' },
  { value: 'TON', label: 'TON' },
] as const

/** 'TRC20 (Tron)' for a known network code; anything else is shown as it came; '' when there is none. */
export function cryptoNetworkLabel(network: string | null | undefined): string {
  const code = typeof network === 'string' ? network.trim() : ''
  if (!code) return ''
  return CRYPTO_NETWORKS.find((item) => item.value === code.toUpperCase())?.label ?? code
}

/** 'Send only USDT on the TRC20 (Tron) network': a transfer on any other network is lost. */
export function cryptoNetworkWarning(network: string | null | undefined): string {
  const label = cryptoNetworkLabel(network)
  return `Send only ${CRYPTO_COIN}${label ? ` on the ${label} network` : ''}`
}

/**
 * USDT to send for a deposit of `amount` at `rate`, rounded UP to 2 decimals so the transfer never
 * falls short of the amount credited. Null when the amount or rate is unusable.
 */
export function usdtFor(amount: number, rate: number | null | undefined): number | null {
  if (rate == null || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(amount) || amount <= 0) return null
  // toFixed first: a division that is exact on paper can land a hair above a whole cent
  // (e.g. 110.00000000000001), and ceil would then ask for one cent too many.
  return Math.ceil(Number(((amount / rate) * 100).toFixed(6))) / 100
}

/** '10.82 USDT' */
export function formatUsdt(value: number): string {
  return `${value.toFixed(2)} ${CRYPTO_COIN}`
}

/** The highest crypto deposit bonus a whitelabel may set, in percent (the server enforces the same). */
export const CRYPTO_BONUS_MAX_PERCENT = 50

/** A bonus percent from the API as a usable number (above 0, at most 50), or null for no bonus. */
export function cryptoBonusPercent(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 && n <= CRYPTO_BONUS_MAX_PERCENT ? n : null
}

/**
 * The bonus a crypto deposit of `amount` earns at `percent`, rounded DOWN to the paisa: 5% of 9,000 is 450,
 * what 105 USDT would buy instead of 100. 0 when there is no bonus. The server fixes the bonus when the
 * request is made and pays it into the cash wallet when the deposit is approved.
 */
export function cryptoBonusFor(amount: number, percent: unknown): number {
  const p = cryptoBonusPercent(percent)
  if (p === null || !Number.isFinite(amount) || amount <= 0) return 0
  return Math.floor(Number(((amount * p) / 100 * 100).toFixed(6))) / 100
}

/** '5%', '2.5%' */
export function formatBonusPercent(percent: number): string {
  return `${Number(percent.toFixed(2))}%`
}

/** What the server recorded for a crypto deposit request: the USDT it quoted, at what rate, on which network, and the bonus. */
export type CryptoDepositInfo = {
  usdt: number | null
  rate: number | null
  network: string | null
  /** Paid into the cash wallet on approval, on top of the amount; 0 when there is none */
  bonus: number
}

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * The crypto part of a deposit request (history row or the createAdminDeposit result), or null when it
 * is not a crypto deposit. The server sends `method` as BANK_TRANSFER / UPI / CRYPTO.
 */
export function cryptoDepositInfo(row: unknown): CryptoDepositInfo | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  if (String(r.method ?? '').trim().toUpperCase() !== 'CRYPTO') return null
  const bonus = finiteOrNull(r.cryptoBonusAmount)
  return {
    usdt: finiteOrNull(r.cryptoAmount),
    rate: finiteOrNull(r.cryptoRate),
    network: typeof r.cryptoNetwork === 'string' && r.cryptoNetwork.trim() ? r.cryptoNetwork.trim() : null,
    bonus: bonus !== null && bonus > 0 ? bonus : 0,
  }
}
