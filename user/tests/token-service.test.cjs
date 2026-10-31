const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-source.cjs');

const { tokenService } = loader({}, { TextDecoder, Uint8Array, atob })('src/lib/tokenService.ts');

function token(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${body}.signature`;
}

test('token service decodes URL-safe UTF-8 JWT payloads', () => {
  const jwt = token({ exp: 4_102_444_800, nonce: 'Om6QJM~0AOfD', name: 'प्लेयर' });
  assert.match(jwt.split('.')[1], /[-_]/);
  assert.deepEqual({ ...tokenService.decodeToken(jwt) }, {
    exp: 4_102_444_800,
    nonce: 'Om6QJM~0AOfD',
    name: 'प्लेयर',
  });
  assert.equal(tokenService.isTokenExpired(jwt), false);
});

test('token service treats malformed and expiry-less tokens as expired', () => {
  assert.equal(tokenService.isTokenExpired('not-a-jwt'), true);
  assert.equal(tokenService.isTokenExpired(token({ sub: '7' })), true);
  assert.equal(tokenService.getTokenExpiry('not-a-jwt'), null);
  assert.equal(tokenService.decodeToken('not-a-jwt'), null);
});

test('token service treats current and past expiries as expired', () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(tokenService.isTokenExpired(token({ exp: now })), true);
  assert.equal(tokenService.isTokenExpired(token({ exp: now - 60 })), true);
});

test('token service reports future expiry in milliseconds', () => {
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(tokenService.getTokenExpiry(token({ exp: expiry })), expiry * 1000);
});
