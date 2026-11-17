import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CRYPTO_NETWORKS,
  cryptoAmountFor,
  cryptoBonusFor,
  cryptoTxHashError,
  cryptoWalletAddressError,
  isCryptoAllowedForUser,
  isCryptoNetwork,
  normalizeCryptoTxHash,
  parseCryptoBonusPercent,
  parseCryptoRate,
} from './cryptoDeposit.js'

test('parseCryptoRate accepts a positive number or numeric string and nothing else', () => {
  assert.equal(parseCryptoRate(92.5), 92.5)
  assert.equal(parseCryptoRate('92.5000'), 92.5) // numeric columns arrive as strings
  for (const bad of [null, undefined, '', 0, -1, '0', 'abc', NaN, Infinity]) assert.equal(parseCryptoRate(bad), null, String(bad))
})

test('cryptoAmountFor rounds the USDT to send UP to 2 decimals', () => {
  assert.equal(cryptoAmountFor(1000, 92.5), 10.82) // 10.8108...
  assert.equal(cryptoAmountFor(100, 91), 1.1) // 1.0989...
  assert.equal(cryptoAmountFor(1, 95), 0.02) // never rounds a deposit down to nothing
})

test('cryptoAmountFor does not add a cent to an exact division', () => {
  assert.equal(cryptoAmountFor(1100, 10), 110)
  assert.equal(cryptoAmountFor(9250, 92.5), 100)
  assert.equal(cryptoAmountFor(300000, 88.9), 3374.58) // 3374.5781...
  // every whole-USDT deposit must quote exactly that many USDT
  for (const rate of [83.3, 88.9, 91.07, 92.5, 99.99]) {
    for (const usdt of [1, 7, 33, 110, 4999]) assert.equal(cryptoAmountFor(Number((usdt * rate).toFixed(4)), rate), usdt, `${usdt} @ ${rate}`)
  }
})

test('cryptoAmountFor returns null when there is nothing to quote', () => {
  assert.equal(cryptoAmountFor(1000, null), null)
  assert.equal(cryptoAmountFor(1000, 0), null)
  assert.equal(cryptoAmountFor(0, 92.5), null)
  assert.equal(cryptoAmountFor(-5, 92.5), null)
  assert.equal(cryptoAmountFor(NaN, 92.5), null)
})

test('isCryptoAllowedForUser: no allow-list means every player', () => {
  for (const none of [undefined, null, '', '   ']) {
    assert.equal(isCryptoAllowedForUser(none, 761), true, JSON.stringify(none))
    assert.equal(isCryptoAllowedForUser(none, null), true, JSON.stringify(none)) // logged-out visitors too
  }
})

test('isCryptoAllowedForUser: a list allows exactly the listed players', () => {
  assert.equal(isCryptoAllowedForUser('761', 761), true)
  assert.equal(isCryptoAllowedForUser('761', 762), false)
  assert.equal(isCryptoAllowedForUser('761', 7610), false) // an ID, not a prefix
  assert.equal(isCryptoAllowedForUser(' 761 , 802 ', 802), true)
  assert.equal(isCryptoAllowedForUser('761', null), false) // not logged in
  assert.equal(isCryptoAllowedForUser('761', undefined), false)
})

test('isCryptoAllowedForUser: a list with no valid ID allows nobody, never everybody', () => {
  // each of these is a plausible typo on the server; none may open crypto to all players
  for (const typo of ['761;762', 'id761', '"761"', 'all', '*', ',', '761.5', '-761']) {
    assert.equal(isCryptoAllowedForUser(typo, 761), false, typo)
    assert.equal(isCryptoAllowedForUser(typo, 1), false, typo)
  }
  // a bad entry does not take the good ones down with it
  assert.equal(isCryptoAllowedForUser('761, abc', 761), true)
  assert.equal(isCryptoAllowedForUser('761,', 761), true)
  assert.equal(isCryptoAllowedForUser('761,', 0), false) // the empty entry is not user 0
})

test('the bonus percent is a number above 0 and at most 50; anything else is no bonus', () => {
  assert.equal(parseCryptoBonusPercent(5), 5)
  assert.equal(parseCryptoBonusPercent('2.50'), 2.5) // numeric columns arrive as strings
  assert.equal(parseCryptoBonusPercent(50), 50)
  for (const off of [null, undefined, '', 0, '0', -5, 50.01, 500, 'abc', NaN]) assert.equal(parseCryptoBonusPercent(off), null, String(off))
})

test('cryptoBonusFor: 5% on a deposit worth 100 USDT credits what 105 USDT would', () => {
  const rate = 90
  const deposit = 100 * rate // the player pays 100 USDT for 9,000
  assert.equal(cryptoBonusFor(deposit, 5), 450)
  assert.equal(deposit + cryptoBonusFor(deposit, 5), 105 * rate)
  // rounded down to the paisa, never more than promised
  assert.equal(cryptoBonusFor(1234.56, 3.33), 41.11) // 41.1108...
  assert.equal(cryptoBonusFor(1000, 2.5), 25)
  for (const off of [null, 0, 60]) assert.equal(cryptoBonusFor(9000, off), 0, String(off))
  assert.equal(cryptoBonusFor(0, 5), 0)
})

test('only the supported USDT networks are networks', () => {
  assert.deepEqual(CRYPTO_NETWORKS.map((n) => n.value), ['TRC20', 'BEP20', 'ERC20', 'POLYGON', 'SOLANA', 'TON'])
  for (const n of CRYPTO_NETWORKS) assert.equal(isCryptoNetwork(n.value), true, n.value)
  for (const bad of ['trc20', 'BTC', '', null, undefined, 20]) assert.equal(isCryptoNetwork(bad), false, String(bad))
})

test('a wallet address must match its network, because funds sent across networks are lost', () => {
  assert.equal(cryptoWalletAddressError('TRC20', 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE'), null)
  assert.equal(cryptoWalletAddressError('BEP20', '0x55d398326f99059fF775485246999027B3197955'), null)
  assert.equal(cryptoWalletAddressError('ERC20', '0xdAC17F958D2ee523a2206206994597C13D831ec7'), null)
  assert.equal(cryptoWalletAddressError('POLYGON', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'), null)
  assert.equal(cryptoWalletAddressError('SOLANA', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'), null)
  assert.equal(cryptoWalletAddressError('TON', 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'), null)

  // an EVM address on Tron, and a Tron address on BNB Smart Chain
  assert.match(cryptoWalletAddressError('TRC20', '0x55d398326f99059fF775485246999027B3197955') ?? '', /TRC20/)
  assert.match(cryptoWalletAddressError('BEP20', 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE') ?? '', /BEP20/)
  assert.match(cryptoWalletAddressError('TRC20', 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLS') ?? '', /TRC20/) // 33 characters
  assert.match(cryptoWalletAddressError('ERC20', '0x55d398326f99059fF775485246999027B319795G') ?? '', /ERC20/) // not hex

  assert.equal(cryptoWalletAddressError('TRC20', ''), 'Wallet address is required')
  assert.equal(cryptoWalletAddressError('TRC20', '   '), 'Wallet address is required')
  assert.equal(cryptoWalletAddressError('SOLANA', 'Es9vMFrzaCERmJfr F4H2FYD4KCoNkY11McCe8BenwNYB'), 'Wallet address cannot contain spaces')
  assert.equal(cryptoWalletAddressError('TON', 'EQCxE6mUtQ'), 'Wallet address is too short')
  assert.equal(cryptoWalletAddressError('TON', 'E'.repeat(129)), 'Wallet address is too long')
  assert.equal(cryptoWalletAddressError('BTC', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'), 'Choose a supported network')
})

test('a transaction hash is required, has no spaces and is 20 to 128 characters', () => {
  assert.equal(cryptoTxHashError('f'.repeat(64)), null)
  assert.equal(cryptoTxHashError(`0x${'a'.repeat(64)}`), null)
  assert.equal(cryptoTxHashError(`  ${'b'.repeat(64)}  `), null) // pasted with spaces around it
  assert.equal(cryptoTxHashError(undefined), 'Transaction hash is required for crypto deposits')
  assert.equal(cryptoTxHashError('   '), 'Transaction hash is required for crypto deposits')
  assert.equal(cryptoTxHashError('abc'), 'Enter the full transaction hash (TxID)')
  assert.equal(cryptoTxHashError('a'.repeat(129)), 'Enter the full transaction hash (TxID)')
  assert.equal(cryptoTxHashError(`${'a'.repeat(30)} ${'b'.repeat(30)}`), 'Enter the full transaction hash (TxID)')
  assert.equal(normalizeCryptoTxHash(`  ${'c'.repeat(64)}\n`), 'c'.repeat(64))
})

test('a transaction hash holds only hash characters (hex, base58, base64 and base64url)', () => {
  assert.equal(cryptoTxHashError('5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW'), null) // Solana
  assert.equal(cryptoTxHashError('Ze5uuMv0OZbNtRRmPVGbKuLRw3Avm4nMZlJ+2nD1HmM='), null) // TON, base64
  assert.equal(cryptoTxHashError('Ze5uuMv0OZbNtRRmPVGbKuLRw3Avm4nMZlJ-2nD1HmM_'), null) // TON, base64url
  for (const markup of ['<img/src=x/onerror=alert(1)>', `${'a'.repeat(30)}"><b>`, `javascript:${'a'.repeat(30)}`, `${'a'.repeat(30)};drop`]) {
    assert.equal(cryptoTxHashError(markup), 'Enter the full transaction hash (TxID)', markup)
  }
})
