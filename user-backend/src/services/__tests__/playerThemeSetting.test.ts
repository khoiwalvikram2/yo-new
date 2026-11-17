// user-backend/src/services/__tests__/playerThemeSetting.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MATCHBOOK_COLORS, PLAYER_THEME_PRESETS } from '@shared/theme/playerTheme.js'
import { playerThemeSetting, resetPlayerThemeWarnings } from '../playerThemeSetting.js'

const teal = PLAYER_THEME_PRESETS.find((preset) => preset.id === 'teal')!.colors

test('nothing stored sends nothing; a valid theme is sent as stored', () => {
  const logged: string[] = []
  assert.equal(playerThemeSetting(null, 't', (m) => logged.push(m)), null)
  assert.equal(playerThemeSetting(undefined, 't', (m) => logged.push(m)), null)
  assert.deepEqual(playerThemeSetting({ presetId: 'teal', colors: teal }, 't', (m) => logged.push(m)), { presetId: 'teal', colors: teal })
  assert.deepEqual(logged, [])
})

test('a value the schema refuses is logged and only its valid parts are sent', () => {
  resetPlayerThemeWarnings()
  const logged: string[] = []
  assert.deepEqual(playerThemeSetting({ sportsIconStyle: '3d', primary: '#FF3B30' }, 'grandwinn-com', (m) => logged.push(m)), { sportsIconStyle: '3d' })
  assert.equal(logged.length, 1)
  assert.match(logged[0]!, /grandwinn-com/)
})

test('a bad value is logged once per distinct value, not on every poll', () => {
  resetPlayerThemeWarnings()
  const logged: string[] = []
  const log = (m: string) => logged.push(m)
  const bad = { sportsIconStyle: '3d', primary: '#FF3B30' }
  playerThemeSetting(bad, 'once', log)
  playerThemeSetting(bad, 'once', log)
  assert.equal(logged.length, 1)
  playerThemeSetting({ sportsIconStyle: 'flat', primary: '#FF3B30' }, 'once', log)
  assert.equal(logged.length, 2)
})

test('colours dropped for contrast are logged once and the rest is sent', () => {
  resetPlayerThemeWarnings()
  const logged: string[] = []
  const log = (m: string) => logged.push(m)
  // A menu colour the white menu text cannot be read on (playerThemeErrors: chrome).
  const stored = { sportsIconStyle: 'flat', colors: { ...MATCHBOOK_COLORS, chrome: '#DDDDDD' } }
  assert.deepEqual(playerThemeSetting(stored, 'dim', log), { sportsIconStyle: 'flat' })
  playerThemeSetting(stored, 'dim', log)
  assert.equal(logged.length, 1)
  assert.match(logged[0]!, /dim/)
})

test('a bright action colour is no longer dropped: its buttons take dark ink', () => {
  // The shared rule since 2026-11-01 (playerTheme.ts onActionColor): an action colour is never an error, a bright one
  // gets #141518 button text. This case used '#F9270C' as the colour to drop, from before that change.
  resetPlayerThemeWarnings()
  const logged: string[] = []
  const stored = { sportsIconStyle: 'flat', colors: { ...MATCHBOOK_COLORS, action: '#F9270C' } }
  assert.deepEqual(playerThemeSetting(stored, 'bright', (m) => logged.push(m)), stored)
  assert.deepEqual(logged, [])
})
