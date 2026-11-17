import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  CRYPTO_BONUS_MAX_PERCENT,
  CRYPTO_COIN,
  CRYPTO_NETWORKS,
  DEFAULT_CRYPTO_NETWORK,
  cryptoAmountFor,
  cryptoBonusFor,
  cryptoExplorerTxUrl,
  cryptoNetworkLabel,
  cryptoWalletTitle,
  formatUsdt,
  isCryptoNetwork,
  parseCryptoBonusPercent,
  parseCryptoRate,
  walletAddressError,
} from './cryptoWalletModel'

/** Real, well-formed addresses: the USDT contracts on each chain. */
const TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const EVM = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const SOLANA = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
const TON = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'

describe('networks', () => {
  test('lists the six USDT networks with their labels, Tron first and the default', () => {
    assert.equal(CRYPTO_COIN, 'USDT')
    assert.deepStrictEqual(CRYPTO_NETWORKS.map((network) => [network.value, network.label]), [
      ['TRC20', 'TRC20 (Tron)'],
      ['BEP20', 'BEP20 (BNB Smart Chain)'],
      ['ERC20', 'ERC20 (Ethereum)'],
      ['POLYGON', 'Polygon'],
      ['SOLANA', 'Solana'],
      ['TON', 'TON'],
    ])
    assert.equal(DEFAULT_CRYPTO_NETWORK, 'TRC20')
    assert.equal(isCryptoNetwork('SOLANA'), true)
    assert.equal(isCryptoNetwork('trc20'), false, 'the server matches the stored value exactly')
    assert.equal(isCryptoNetwork(undefined), false)
  })

  test('labels a known network, shows an unknown one as stored and a missing one as a dash', () => {
    assert.equal(cryptoNetworkLabel('TRC20'), 'TRC20 (Tron)')
    assert.equal(cryptoNetworkLabel('POLYGON'), 'Polygon')
    assert.equal(cryptoNetworkLabel('ARBITRUM'), 'ARBITRUM')
    assert.equal(cryptoNetworkLabel(null), '—')
    assert.equal(cryptoNetworkLabel(''), '—')
  })

  test('titles a wallet by its display name, else by coin and network', () => {
    assert.equal(cryptoWalletTitle({ displayName: 'Main Tron wallet', network: 'TRC20' }), 'Main Tron wallet')
    assert.equal(cryptoWalletTitle({ displayName: '   ', network: 'TRC20' }), 'USDT (TRC20)')
    assert.equal(cryptoWalletTitle({ displayName: null, network: 'BEP20' }), 'USDT (BEP20)')
    assert.equal(cryptoWalletTitle({}), 'USDT (—)')
  })
})

describe('walletAddressError', () => {
  test('accepts each network\'s own address format, trimmed', () => {
    assert.equal(walletAddressError('TRC20', TRON), null)
    assert.equal(walletAddressError('TRC20', `  ${TRON}  `), null)
    for (const network of ['BEP20', 'ERC20', 'POLYGON']) assert.equal(walletAddressError(network, EVM), null, network)
    assert.equal(walletAddressError('SOLANA', SOLANA), null)
    assert.equal(walletAddressError('TON', TON), null)
  })

  test('refuses an address of another network with the server\'s message', () => {
    assert.equal(walletAddressError('TRC20', EVM), 'A TRC20 address must start with T and be 34 characters long')
    assert.equal(walletAddressError('TRC20', TRON.slice(0, -1)), 'A TRC20 address must start with T and be 34 characters long')
    assert.equal(walletAddressError('TRC20', `T0${TRON.slice(2)}`), 'A TRC20 address must start with T and be 34 characters long', 'no 0 in base58')
    assert.equal(walletAddressError('BEP20', TRON), 'A BEP20 address must start with 0x followed by 40 hex characters')
    assert.equal(walletAddressError('ERC20', `${EVM}0`), 'A ERC20 address must start with 0x followed by 40 hex characters')
    assert.equal(walletAddressError('POLYGON', EVM.replace('d', 'g')), 'A POLYGON address must start with 0x followed by 40 hex characters')
    assert.equal(walletAddressError('SOLANA', EVM), 'A SOLANA address must be 32 to 44 base58 characters')
    assert.equal(walletAddressError('SOLANA', `${SOLANA}A`), 'A SOLANA address must be 32 to 44 base58 characters')
  })

  test('applies the generic rules: network, required, spaces, length', () => {
    assert.equal(walletAddressError('', TRON), 'Choose a supported network')
    assert.equal(walletAddressError('trc20', TRON), 'Choose a supported network')
    assert.equal(walletAddressError('TRC20', ''), 'Wallet address is required')
    assert.equal(walletAddressError('TRC20', '   '), 'Wallet address is required')
    assert.equal(walletAddressError('TRC20', undefined), 'Wallet address is required')
    assert.equal(walletAddressError('TON', 'EQCx E6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id'), 'Wallet address cannot contain spaces')
    assert.equal(walletAddressError('TON', 'x'.repeat(129)), 'Wallet address is too long')
    assert.equal(walletAddressError('TON', 'x'.repeat(128)), null)
    assert.equal(walletAddressError('TON', 'x'.repeat(19)), 'Wallet address is too short')
  })
})

describe('USDT quote and bonus', () => {
  test('asks for USDT rounded UP to the cent, never short of the amount credited', () => {
    assert.equal(cryptoAmountFor(10000, 92.5), 108.11)
    assert.equal(cryptoAmountFor(10000, 100), 100)
    assert.equal(cryptoAmountFor(1, 3), 0.34)
    // 110 / 100 * 100 is 110.00000000000001 in floating point; it must not be charged a cent more.
    assert.equal(cryptoAmountFor(110, 100), 1.1)
    assert.equal(cryptoAmountFor(1100, 62.5), 17.6)
    assert.equal(cryptoAmountFor(10000, '92.5'), 108.11)
  })

  test('has no quote without a usable rate or amount', () => {
    for (const rate of [0, -1, null, undefined, '', 'abc', Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(cryptoAmountFor(10000, rate), null, String(rate))
    }
    assert.equal(cryptoAmountFor(0, 92.5), null)
    assert.equal(cryptoAmountFor(-5, 92.5), null)
    assert.equal(parseCryptoRate('88.4'), 88.4)
    assert.equal(parseCryptoRate(0), null)
  })

  test('pays the bonus rounded DOWN to the paisa, and none outside 0-50%', () => {
    assert.equal(cryptoBonusFor(10000, 5), 500)
    assert.equal(cryptoBonusFor(9000, 5), 450)
    assert.equal(cryptoBonusFor(10000, 0.333), 33.3)
    assert.equal(cryptoBonusFor(999.99, 2.5), 24.99)
    assert.equal(cryptoBonusFor(10000, CRYPTO_BONUS_MAX_PERCENT), 5000)
    for (const percent of [0, 50.01, -2, null, undefined, '']) {
      assert.equal(cryptoBonusFor(10000, percent), 0, String(percent))
    }
    assert.equal(cryptoBonusFor(0, 5), 0)
    assert.equal(parseCryptoBonusPercent('2.5'), 2.5)
    assert.equal(parseCryptoBonusPercent(50), 50)
    assert.equal(parseCryptoBonusPercent(51), null)
  })

  test('prints USDT with two decimals', () => {
    assert.equal(formatUsdt(108.1), '108.10 USDT')
    assert.equal(formatUsdt(0.5), '0.50 USDT')
  })
})

describe('cryptoExplorerTxUrl', () => {
  const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'

  test('links each network to its explorer\'s transaction page', () => {
    assert.deepStrictEqual(
      CRYPTO_NETWORKS.map((network) => cryptoExplorerTxUrl(network.value, HASH)),
      [
        `https://tronscan.org/#/transaction/${HASH}`,
        `https://bscscan.com/tx/${HASH}`,
        `https://etherscan.io/tx/${HASH}`,
        `https://polygonscan.com/tx/${HASH}`,
        `https://solscan.io/tx/${HASH}`,
        `https://tonviewer.com/transaction/${HASH}`,
      ],
    )
  })

  test('encodes the trimmed hash, so a pasted value cannot change the address', () => {
    assert.equal(cryptoExplorerTxUrl('TRC20', `  ${HASH}\n`), `https://tronscan.org/#/transaction/${HASH}`)
    assert.equal(
      cryptoExplorerTxUrl('TON', 'abc/../def?x=1#y z'),
      'https://tonviewer.com/transaction/abc%2F..%2Fdef%3Fx%3D1%23y%20z',
    )
    // The server accepts base64-style hashes ([0-9A-Za-z+/=_-]); their symbols are encoded too.
    assert.equal(
      cryptoExplorerTxUrl('TON', 'te6cckEB+AQEA/w_-Hk='),
      'https://tonviewer.com/transaction/te6cckEB%2BAQEA%2Fw_-Hk%3D',
    )
  })

  test('has no link for an unknown network or an empty hash', () => {
    assert.equal(cryptoExplorerTxUrl('ARBITRUM', HASH), null)
    assert.equal(cryptoExplorerTxUrl(null, HASH), null)
    assert.equal(cryptoExplorerTxUrl('TRC20', '   '), null)
    assert.equal(cryptoExplorerTxUrl('TRC20', null), null)
  })
})
