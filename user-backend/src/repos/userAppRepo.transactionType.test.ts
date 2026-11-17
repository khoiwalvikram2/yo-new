/**
 * Wallet statement labels (getTransactionTypeFromMeta) for a credit player's upline chip moves.
 *
 * Under the CREDIT scheme on Deposit/Withdraw chips, admin-backend ChipRepo.insertPlayerStatement
 * records each upline move as a ledger_entries row with type CHIP_DEPOSIT / CHIP_WITHDRAW and
 * meta.type chip_deposit / chip_withdraw (meta.originalAmount signed). The player's statement must
 * name them 'Chip Deposit' / 'Chip Withdrawal', the labels statementPageRepo's SQL gives the Wallet
 * type filter, never the sign-based fallback ('Deposit' for any amount >= 0, 'Debit' for a negative
 * one), which would pass a chip move off as a cash deposit or an unnamed debit.
 *
 * No database: the mapper is pure. statementPage.integration.test.ts checks the SQL and this mapper
 * agree on real chip rows.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { getTransactionTypeFromMeta } from './userAppRepo.js'

test('upline chip moves are named Chip Deposit / Chip Withdrawal, as ChipRepo writes them', () => {
  assert.equal(getTransactionTypeFromMeta('chip_deposit', 'CHIP_DEPOSIT', 500), 'Chip Deposit')
  assert.equal(getTransactionTypeFromMeta('chip_withdraw', 'CHIP_WITHDRAW', -200), 'Chip Withdrawal')
})

test('the chip label comes from the type, not from the amount sign or the meta.type casing', () => {
  assert.equal(getTransactionTypeFromMeta(' CHIP_DEPOSIT ', 'CHIP_DEPOSIT', 0), 'Chip Deposit')
  assert.equal(getTransactionTypeFromMeta('Chip_Withdraw', 'CHIP_WITHDRAW', 200), 'Chip Withdrawal')
})

test('a chip row without meta.type is named from its ledger row type', () => {
  assert.equal(getTransactionTypeFromMeta(undefined, 'CHIP_DEPOSIT', 500), 'Chip Deposit')
  assert.equal(getTransactionTypeFromMeta('', 'CHIP_WITHDRAW', -200), 'Chip Withdrawal')
})

test('other wallet rows keep their labels', () => {
  assert.equal(getTransactionTypeFromMeta('admin_adjustment', 'credit', 100), 'Manual Deposit')
  assert.equal(getTransactionTypeFromMeta('admin_adjustment', 'debit', -100), 'Manual Withdrawal')
  assert.equal(getTransactionTypeFromMeta('deposit', 'credit', 100), 'Deposit')
  assert.equal(getTransactionTypeFromMeta('withdrawal', 'debit', -100), 'Withdrawal')
  assert.equal(getTransactionTypeFromMeta(undefined, 'withdrawal_pending', -100), 'Withdrawal')
  assert.equal(getTransactionTypeFromMeta(undefined, 'credit', 100), 'Credit')
  assert.equal(getTransactionTypeFromMeta(undefined, 'debit', -100), 'Withdrawal')
  assert.equal(getTransactionTypeFromMeta(undefined, 'ledger', -100), 'Debit')
})
