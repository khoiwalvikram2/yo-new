// admin-backend/src/domains/app-config/__tests__/playerThemeInput.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MATCHBOOK_COLORS, PLAYER_THEME_PRESETS } from '@shared/theme/playerTheme.js'
import { parsePlayerThemeInput } from '../playerThemeInput.js'

const blue = PLAYER_THEME_PRESETS.find((preset) => preset.id === 'royal-blue')!.colors

test('null clears the theme; a valid theme is normalised', () => {
  assert.equal(parsePlayerThemeInput(null), null)
  assert.deepEqual(parsePlayerThemeInput({ presetId: 'custom', sportsIconStyle: 'flat', colors: { ...blue, action: '#1d4ed8' } }),
    { presetId: 'custom', sportsIconStyle: 'flat', colors: blue })
  assert.deepEqual(parsePlayerThemeInput({ sportsIconStyle: '3d' }), { sportsIconStyle: '3d' })
})

test('a bad shape or an unreadable colour is refused with the field and the reason', () => {
  assert.throws(() => parsePlayerThemeInput({ primary: '#FFFFFF' }), /^Error: Invalid player theme: /)
  assert.throws(() => parsePlayerThemeInput({ colors: { ...MATCHBOOK_COLORS, link: 'blue' } }), /Invalid player theme: colors\.link: Use a hex color/)
  assert.throws(() => parsePlayerThemeInput({ colors: { ...MATCHBOOK_COLORS, chrome: '#DDDDDD' } }), /Invalid player theme: colors\.chrome: Menu text is hard to read/)
  assert.throws(() => parsePlayerThemeInput('theme'), /Invalid player theme/)
})
