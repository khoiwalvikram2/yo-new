/**
 * The tier form's receiving-accounts picker against a mocked payment-methods query: every bank account,
 * UPI ID and crypto wallet is listed by name, and a tier's starting selection follows each account's
 * VIP tier access.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { WHITELABEL_PAYMENT_METHODS } from '@/lib/graphql/deposits'
import { VipTierAccountsPicker, type ReceivingAccountOption } from './VipTierAccountsPicker'

const TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const EVM = '0xdAC17F958D2ee523a2206206994597C13D831ec7'

function wallet(id: string, network: string, walletAddress: string, enabled: boolean, vipTierIds: string[] | null) {
  return {
    __typename: 'CryptoDetails', id, network, walletAddress, displayName: null, qrKey: null, qrUrl: null,
    minAmount: null, maxAmount: null, weight: 0, enabled, vipTierIds,
  }
}

function methodsMock(): MockedResponse {
  return {
    request: { query: WHITELABEL_PAYMENT_METHODS },
    result: {
      data: {
        whitelabelPaymentMethods: {
          __typename: 'WhitelabelPaymentMethods',
          id: 'wpm-1',
          tenant: 'floxi',
          enabledMethods: ['BANK_TRANSFER', 'UPI'],
          banks: [{
            __typename: 'BankDetails', id: 'b1', accountName: 'Vijay Kumar', accountNumber: '50100234567812',
            ifsc: 'HDFC0001204', bankName: 'HDFC Bank', branch: 'Andheri East', notes: null, minAmount: null,
            maxAmount: null, weight: 0, enabled: true, vipTierIds: null,
          }],
          upis: [{
            __typename: 'UpiDetails', id: 'u1', upiId: 'desk@ybl', displayName: null, qrKey: null, qrUrl: null,
            minAmount: null, maxAmount: null, weight: 0, enabled: true, vipTierIds: ['silver'],
          }],
          cryptos: [wallet('c1', 'TRC20', TRON, true, null), wallet('c2', 'BEP20', EVM, false, ['gold'])],
          cryptoRate: 92.5,
          cryptoBonusPercent: null,
          limits: { __typename: 'DepositLimits', min: 100, max: 500000 },
          createdAt: '2026-09-01T10:00:00.000Z',
          updatedAt: '2026-10-01T10:00:00.000Z',
        },
      },
    },
  }
}

afterEach(cleanup)

describe('VipTierAccountsPicker', () => {
  test('lists crypto wallets after banks and UPIs, by coin, network and the end of the address', async () => {
    const onChange = vi.fn()
    const onAccounts = vi.fn()
    render(
      <MockedProvider mocks={[methodsMock()]}>
        <VipTierAccountsPicker tierId="gold" value={null} onChange={onChange} onAccounts={onAccounts} />
      </MockedProvider>,
    )

    await waitFor(() => assert.equal(onAccounts.mock.calls.length, 1))
    const accounts = onAccounts.mock.calls[0]?.[0] as ReceivingAccountOption[]
    assert.deepStrictEqual(accounts.map((account) => [account.id, account.label, account.enabled, account.vipTierIds]), [
      ['b1', 'Bank · HDFC Bank ••7812', true, null],
      ['u1', 'UPI · desk@ybl', true, ['silver']],
      ['c1', 'Crypto · USDT (TRC20) ••Lj6t', true, null],
      ['c2', 'Crypto · USDT (BEP20) ••1ec7', false, ['gold']],
    ])
    // An existing tier starts from the accounts that allow it: those open to every tier and those naming it.
    assert.deepStrictEqual(onChange.mock.calls[0]?.[0], ['b1', 'c1', 'c2'])
  })

  test('offers each wallet as a checkbox, an inactive one marked', async () => {
    render(
      <MockedProvider mocks={[methodsMock()]}>
        <VipTierAccountsPicker tierId="gold" value={['c1']} onChange={() => {}} />
      </MockedProvider>,
    )

    const tron = await screen.findByRole('checkbox', { name: 'Crypto · USDT (TRC20) ••Lj6t' }) as HTMLInputElement
    assert.equal(tron.checked, true)
    const bsc = screen.getByRole('checkbox', { name: 'Crypto · USDT (BEP20) ••1ec7 — inactive' }) as HTMLInputElement
    assert.equal(bsc.checked, false)
  })
})
