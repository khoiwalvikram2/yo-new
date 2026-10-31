/**
 * wallet_ledger is the audit trail for every money movement, so a row must be
 * self-consistent: balanceAfter is balanceBefore moved by amount in the stated
 * direction.
 *
 * 601 historical rows break that invariant (593 of them from sports settlement)
 * and 78 wallets have a discontinuity in their balance chain. The writing bug
 * stopped in April 2026 — no violation has been recorded since, across 129k
 * later rows — but nothing detected the drift while it was happening, because
 * the writer validated nothing and swallowed every error into an empty catch.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { checkLedgerArithmetic } from '../walletLedgerService.js'

describe('checkLedgerArithmetic', () => {
  it('accepts a credit that raises the balance by the amount', () => {
    assert.equal(
      checkLedgerArithmetic({ direction: 'credit', amount: 250, balanceBefore: 1000, balanceAfter: 1250 }),
      true
    )
  })

  it('accepts a debit that lowers the balance by the amount', () => {
    assert.equal(
      checkLedgerArithmetic({ direction: 'debit', amount: 250, balanceBefore: 1000, balanceAfter: 750 }),
      true
    )
  })

  it('accepts a zero-amount row that leaves the balance untouched', () => {
    assert.equal(
      checkLedgerArithmetic({ direction: 'credit', amount: 0, balanceBefore: 500, balanceAfter: 500 }),
      true
    )
  })

  it('rejects a credit whose balance moved by more than the amount', () => {
    // Real shape from the historical data: amount 500, balance moved 750.
    assert.equal(
      checkLedgerArithmetic({ direction: 'credit', amount: 500, balanceBefore: 9145, balanceAfter: 9895 }),
      false
    )
  })

  it('rejects a zero-amount row whose balance moved anyway', () => {
    // Real shape: amount 0, balance moved 9500.
    assert.equal(
      checkLedgerArithmetic({ direction: 'credit', amount: 0, balanceBefore: 138557.5, balanceAfter: 148057.5 }),
      false
    )
  })

  it('rejects a debit recorded with the sign of a credit', () => {
    assert.equal(
      checkLedgerArithmetic({ direction: 'debit', amount: 100, balanceBefore: 1000, balanceAfter: 1100 }),
      false
    )
  })

  it('tolerates rounding at the 2-decimal precision of the column', () => {
    assert.equal(
      checkLedgerArithmetic({ direction: 'credit', amount: 0.1, balanceBefore: 0.2, balanceAfter: 0.3 }),
      true
    )
  })

  it('rejects a discrepancy just beyond rounding tolerance', () => {
    assert.equal(
      checkLedgerArithmetic({ direction: 'credit', amount: 10, balanceBefore: 100, balanceAfter: 110.02 }),
      false
    )
  })

  it('skips the check when balances are not recorded', () => {
    assert.equal(
      checkLedgerArithmetic({ direction: 'credit', amount: 10, balanceBefore: null, balanceAfter: null }),
      true
    )
  })
})
