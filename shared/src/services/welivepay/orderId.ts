import { randomBytes } from 'crypto'

/** Build a deterministic-shaped order id. ts/rand injectable for testability. */
export function generateOrderId(userId: number, ts?: number, rand?: string): string {
  const t = ts ?? Date.now()
  const r = rand ?? randomBytes(6).toString('hex')
  return `ORDER_${userId}_${t}_${r}`
}

/** WeLivePay requires orderid of at least 10 characters. */
export function isValidOrderId(orderid: string): boolean {
  return typeof orderid === 'string' && orderid.length >= 10
}
