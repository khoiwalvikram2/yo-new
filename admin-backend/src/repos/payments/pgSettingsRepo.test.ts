import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWebhookToken, buildWebhookUrl } from './pgSettingsTokens.js'

test('generateWebhookToken returns a 22-char base64url token and is unique', () => {
  const t = generateWebhookToken()
  assert.match(t, /^[A-Za-z0-9_-]{22}$/)
  assert.notEqual(generateWebhookToken(), t)
})

test('buildWebhookUrl builds the tenant webhook url from base + token', () => {
  assert.equal(buildWebhookUrl('https://user.example.com', 'abc'), 'https://user.example.com/wlp/abc')
  assert.equal(buildWebhookUrl('https://user.example.com/', 'abc'), 'https://user.example.com/wlp/abc')
})
