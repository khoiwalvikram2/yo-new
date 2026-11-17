// shared/src/theme/playerTheme.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contrast, luminance, mix } from './color'
import {
  MATCHBOOK_COLORS, PLAYER_THEME_PRESETS, THEME_MODES, TOKEN_INPUTS, ON_ACTION_BRAND_TOKENS, ACTION_TEXT_DARK, onActionColor, matchingPresetId, playerThemeColorsSchema, playerThemeCss,
  playerThemeErrors, playerThemeOverrides, playerThemeSchema, playerThemeTokens, resolvePlayerTheme,
} from './playerTheme'

const preset = (id: string) => {
  const found = PLAYER_THEME_PRESETS.find((item) => item.id === id)
  if (!found) throw new Error(`no preset ${id}`)
  return found.colors
}

test('there are six presets; every one is valid and readable in both modes', () => {
  assert.deepEqual(PLAYER_THEME_PRESETS.map((item) => item.id), ['matchbook', 'royal-blue', 'emerald', 'royal-purple', 'teal', 'saffron'])
  for (const { id, colors } of PLAYER_THEME_PRESETS) {
    assert.deepEqual(playerThemeErrors(colors), {}, id)
    assert.ok(playerThemeColorsSchema.safeParse(colors).success, id)
    for (const mode of THEME_MODES) {
      const t: Record<string, string> = playerThemeTokens(colors, mode)
      const on = (token: string, background: string) => contrast(t[token] ?? '', t[background] ?? '')
      for (const token of ['--mb-text', '--mb-red-text', '--mb-link', '--mb-muted', '--mb-faint']) {
        assert.ok(on(token, '--mb-panel') >= 4.5, `${id} ${mode} ${token}`)
      }
      for (const token of ['--mb-chrome-red', '--mb-chrome-link']) assert.ok(on(token, '--mb-chrome') >= 4.5, `${id} ${mode} ${token}`)
      assert.ok(contrast('#FFFFFF', t['--mb-red'] ?? '') >= 4.5, `${id} ${mode} button text`)
    }
  }
})

test('Matchbook and no colours inject nothing; letter case does not matter', () => {
  assert.equal(playerThemeCss(MATCHBOOK_COLORS), '')
  assert.equal(playerThemeCss(null), '')
  assert.equal(playerThemeCss(undefined), '')
  assert.equal(playerThemeCss({ ...MATCHBOOK_COLORS, action: '#c51a1b' }), '')
})

test('changing one key colour overrides only the tokens derived from it, in both modes', () => {
  const colors = { ...MATCHBOOK_COLORS, action: '#1D4ED8' }
  const overrides = playerThemeOverrides(colors)
  // Every token derived from the action colour, including the brand shades that used to be literals in the player CSS.
  const expected = Object.entries(TOKEN_INPUTS).filter(([, inputs]) => inputs.includes('action')).map(([token]) => token).sort()
  for (const token of ['--mb-red', '--mb-brand-bright', '--mb-chrome-red', '--mb-red-text', '--mb-brand-top', '--mb-brand-edge', '--mb-brand-accent', '--mb-nav-active']) assert.ok(expected.includes(token), token)
  assert.equal(expected.every((token) => !token.startsWith('--mb-chrome-') || ['--mb-chrome-red'].includes(token)), true)
  assert.deepEqual(Object.keys(overrides.light).sort(), expected)
  assert.deepEqual(Object.keys(overrides.dark).sort(), expected)
  const css = playerThemeCss(colors)
  assert.match(css, /^html:root:not\(\.dark\)\{--mb-red:#1D4ED8;/)
  assert.match(css, /\nhtml\.dark:root\{--mb-red:#1D4ED8;/)
})

test('a light-mode change leaves dark mode alone', () => {
  const overrides = playerThemeOverrides({ ...MATCHBOOK_COLORS, light: { ...MATCHBOOK_COLORS.light, page: '#F4F1EA' } })
  assert.deepEqual(overrides.dark, {})
  assert.equal(overrides.light['--mb-page'], '#F4F1EA')
  assert.equal(overrides.light['--mb-text'], undefined)
  assert.equal(overrides.light['--mb-line'], undefined)
  assert.equal(overrides.light['--mb-red'], undefined)
})

test('validation names the field and the reason', () => {
  const errors = playerThemeErrors({
    ...MATCHBOOK_COLORS,
    chrome: '#DDDDDD',
    light: { ...MATCHBOOK_COLORS.light, panel: '#333333', text: '#EEEEEE' },
    dark: { ...MATCHBOOK_COLORS.dark, page: '#FFFFFF' },
  })
  assert.equal(errors.action, undefined)
  assert.equal(errors.chrome, 'Menu text is hard to read on this color; choose a darker shade')
  assert.equal(errors['light.panel'], 'The light theme needs a light color here')
  assert.equal(errors['light.text'], 'Text is hard to read on the page or panel color')
  assert.equal(errors['dark.page'], 'The dark theme needs a dark color here')
})

test('the schema normalises colours and refuses unknown keys or bad values', () => {
  const parsed = playerThemeSchema.parse({ presetId: 'custom', sportsIconStyle: '3d', colors: { ...MATCHBOOK_COLORS, action: '#abc' } })
  assert.equal(parsed.colors?.action, '#AABBCC')
  assert.equal(playerThemeSchema.safeParse({ colors: { ...MATCHBOOK_COLORS, extra: '#FFFFFF' } }).success, false)
  assert.equal(playerThemeSchema.safeParse({ primary: '#FFFFFF' }).success, false)
  assert.equal(playerThemeSchema.safeParse({ sportsIconStyle: 'neon' }).success, false)
  assert.equal(playerThemeSchema.safeParse({ colors: { ...MATCHBOOK_COLORS, link: 'blue' } }).success, false)
  assert.equal(playerThemeSchema.safeParse({}).success, true)
})

test('a stored theme is read part by part', () => {
  assert.equal(resolvePlayerTheme(null), null)
  assert.equal(resolvePlayerTheme('x'), null)
  assert.equal(resolvePlayerTheme([]), null)
  assert.deepEqual(resolvePlayerTheme({ sportsIconStyle: '3d' }), { sportsIconStyle: '3d' })
  assert.deepEqual(resolvePlayerTheme({ sportsIconStyle: '3d', colors: { action: 'nope' } }), { sportsIconStyle: '3d' })
  assert.deepEqual(resolvePlayerTheme({ presetId: 'cd-exch', primary: '#FF3B30', sportsIconStyle: 'neon' }), { presetId: 'cd-exch' })
  assert.equal(resolvePlayerTheme({ colors: { ...MATCHBOOK_COLORS, chrome: '#DDDDDD' } })?.colors, undefined, 'unreadable colours are not applied')
  assert.deepEqual(resolvePlayerTheme({ colors: preset('teal') })?.colors, preset('teal'))
})

test('matchingPresetId finds a preset by its colours, ignoring case', () => {
  assert.equal(matchingPresetId(MATCHBOOK_COLORS), 'matchbook')
  const blue = preset('royal-blue')
  assert.equal(matchingPresetId({ ...blue, action: blue.action.toLowerCase() }), 'royal-blue')
  assert.equal(matchingPresetId({ ...blue, action: '#1D4ED9' }), 'custom')
})

type Input = 'action' | 'link' | 'chrome' | 'page' | 'panel' | 'text' | 'line'
const MB_ALT: Record<Input, string> = {
  action: '#1D4ED8', link: '#0369A1', chrome: '#1E293B', page: '#F4F1EA', panel: '#FAFAFA', text: '#222222', line: '#CCCCCC',
}
const withInput = (input: Input, mode: 'light' | 'dark', value: string) =>
  input === 'action' || input === 'link' || input === 'chrome'
    ? { ...MATCHBOOK_COLORS, [input]: value }
    : { ...MATCHBOOK_COLORS, [mode]: { ...MATCHBOOK_COLORS[mode], [input]: value } }

test('each input overrides exactly the tokens that depend on it', () => {
  for (const input of Object.keys(MB_ALT) as Input[]) {
    const shared = input === 'action' || input === 'link' || input === 'chrome'
    for (const mode of THEME_MODES) {
      const value = mode === 'dark' && !shared ? mix(MB_ALT[input], '#000000', 0.8) : MB_ALT[input]
      const overrides = playerThemeOverrides(withInput(input, mode, value))
      const expected = Object.entries(TOKEN_INPUTS).filter(([, inputs]) => inputs.includes(input)).map(([token]) => token).sort()
      assert.deepEqual(Object.keys(overrides[mode]).sort(), expected, `${input} ${mode}`)
      if (!shared) assert.deepEqual(overrides[mode === 'light' ? 'dark' : 'light'], {}, `${input} ${mode} other mode`)
    }
  }
})

test('a new dark panel re-emits muted and faint even when the derived value equals the Matchbook one', () => {
  const overrides = playerThemeOverrides({ ...MATCHBOOK_COLORS, dark: { ...MATCHBOOK_COLORS.dark, panel: '#35383C', text: '#BDBFC3' } })
  assert.ok('--mb-faint' in overrides.dark)
  assert.ok('--mb-muted' in overrides.dark)
})

test('presets are readable on the weakest surface and chrome ramps keep their text readable', () => {
  for (const { id, colors } of PLAYER_THEME_PRESETS) {
    for (const mode of THEME_MODES) {
      const t: Record<string, string> = playerThemeTokens(colors, mode)
      const g = (token: string) => t[token] ?? ''
      const { panel, page } = colors[mode]
      const surfaces = mode === 'light' ? [panel, page, mix(panel, page, 0.55)] : [panel, mix(panel, '#FFFFFF', 0.1), page]
      for (const token of ['--mb-red-text', '--mb-link', '--mb-focus', '--mb-muted', '--mb-faint']) {
        for (const surface of surfaces) assert.ok(contrast(g(token), surface) >= 4.5, `${id} ${mode} ${token} on ${surface}`)
      }
      for (const token of ['--mb-red', '--mb-brand-bright', '--mb-chrome-3']) assert.ok(contrast('#FFFFFF', g(token)) >= 4.5, `${id} ${mode} white on ${token}`)
      assert.ok(contrast('#B9BCC3', g('--mb-chrome-2')) >= 4.5, `${id} ${mode} chrome-2`)
      for (const token of ['--mb-chrome-red', '--mb-chrome-link']) {
        assert.ok(contrast(g(token), g('--mb-chrome')) >= 4.5, `${id} ${mode} ${token}`)
        assert.ok(luminance(g(token)) > luminance(g('--mb-chrome')), `${id} ${mode} ${token} lighter`)
      }
    }
  }
})

test('white stays readable on every white-text brand token, and chrome steps stay dark enough, for all presets', () => {
  for (const { id, colors } of PLAYER_THEME_PRESETS) {
    for (const mode of THEME_MODES) {
      const t: Record<string, string> = playerThemeTokens(colors, mode)
      for (const token of ON_ACTION_BRAND_TOKENS) assert.ok(contrast('#FFFFFF', t[token] ?? '') >= 4.5, `${id} ${mode} white on ${token}`)
      assert.ok(contrast(t['--mb-nav-active'] ?? '', t['--mb-chrome'] ?? '') >= 4.5, `${id} nav-active on chrome`)
      assert.ok(contrast(t['--mb-red'] ?? '', t['--mb-brand-wash'] ?? '') >= 4.5, `${id} ${mode} action on the wash`)
      // The charcoal steps carry the light greys of the menu and footer, so none may be lighter than the chrome-3 step.
      for (const token of ['--mb-chrome-field', '--mb-chrome-field-hover', '--mb-chrome-band', '--mb-chrome-rule', '--mb-chrome-tile']) {
        assert.ok(contrast('#B9BCC3', t[token] ?? '') >= 4.5, `${id} ${mode} grey text on ${token}`)
      }
    }
  }
})

test('an action change emits the new brand shades and a chrome change emits the new charcoal steps', () => {
  const action = playerThemeOverrides({ ...MATCHBOOK_COLORS, action: '#1D4ED8' })
  for (const token of ['--mb-brand-top', '--mb-brand-top-action', '--mb-brand-edge', '--mb-brand-accent', '--mb-brand-night', '--mb-nav-active']) {
    assert.ok(token in action.light && token in action.dark, token)
  }
  assert.equal(action.light['--mb-chrome-field'], undefined)
  const chrome = playerThemeOverrides({ ...MATCHBOOK_COLORS, chrome: '#1E293B' })
  for (const token of ['--mb-chrome-field', '--mb-chrome-edge', '--mb-chrome-foot', '--mb-chrome-ticker', '--mb-chrome-hero-end', '--mb-chrome-line-5']) {
    assert.ok(token in chrome.light && token in chrome.dark, token)
  }
  assert.equal(chrome.light['--mb-brand-top'], undefined)
})

test('the css for every preset is plain declarations only', () => {
  for (const { id, colors } of PLAYER_THEME_PRESETS) {
    for (const line of playerThemeCss(colors).split(String.fromCharCode(10)).filter(Boolean)) {
      assert.match(line, /^(html:root:not\(\.dark\)|html\.dark:root)\{(--mb-[a-z0-9-]+:#[0-9A-F]{6};?)+\}$/, id)
    }
  }
})

test('playerThemeCss fails closed on bad colours', () => {
  assert.equal(playerThemeCss({ ...MATCHBOOK_COLORS, action: 'red}body{color:red' }), '')
})

test('chrome that makes the lighter menu steps unreadable is refused', () => {
  assert.ok(playerThemeErrors({ ...MATCHBOOK_COLORS, chrome: '#767676' }).chrome)
})

test('preset ids are slugs', () => {
  for (const presetId of ['custom', 'matchbook', 'royal-blue', 'cd-exch']) assert.ok(playerThemeSchema.safeParse({ presetId }).success, presetId)
  for (const presetId of ['Royal Blue', '', 'a'.repeat(41), 'x;y']) assert.equal(playerThemeSchema.safeParse({ presetId }).success, false, presetId)
})

test('a stored palette with one extra unknown key is still read', () => {
  const stored = { ...MATCHBOOK_COLORS, extra: '#FFFFFF', light: { ...MATCHBOOK_COLORS.light, extra: '#000000' } }
  assert.deepEqual(resolvePlayerTheme({ colors: stored })?.colors, MATCHBOOK_COLORS)
})

test('a dark page lighter than the panel still gets readable accent and text tokens', () => {
  const colors = { ...MATCHBOOK_COLORS, dark: { page: '#4A4A4A', panel: '#141414', text: '#D8D8D8', line: '#32363D' } }
  const t: Record<string, string> = playerThemeTokens(colors, 'dark')
  for (const token of ['--mb-red-text', '--mb-link', '--mb-focus', '--mb-muted', '--mb-faint']) {
    assert.ok(contrast(t[token] ?? '', '#4A4A4A') >= 4.5, token)
  }
})

test('dark text must be readable on the lightest dark step too', () => {
  const errors = playerThemeErrors({ ...MATCHBOOK_COLORS, dark: { ...MATCHBOOK_COLORS.dark, text: '#8A8C90' } })
  assert.equal(errors['dark.text'], 'Text is hard to read on the page or panel color')
})

test('perturbing one input changes only tokens that list it in TOKEN_INPUTS', () => {
  const values = ['#FFFFFF', '#000000', '#808080', '#123456', '#E0A030', '#35383C', '#F4F1EA']
  const inputs: Input[] = ['action', 'link', 'chrome', 'page', 'panel', 'text', 'line']
  for (const input of inputs) {
    for (const mode of THEME_MODES) {
      const base: Record<string, string> = playerThemeTokens(MATCHBOOK_COLORS, mode)
      for (const value of values) {
        const changed: Record<string, string> = playerThemeTokens(withInput(input, mode, value), mode)
        for (const token of Object.keys(base)) {
          if (changed[token] === base[token]) continue
          const listed: readonly string[] = TOKEN_INPUTS[token as keyof typeof TOKEN_INPUTS]
          assert.ok(listed.includes(input), `${token} changed with ${input}=${value} (${mode}) but does not list it`)
        }
      }
    }
  }
})

test('bright action colours get dark button text and every brand shade under it stays readable', () => {
  assert.equal(ACTION_TEXT_DARK, '#141518')
  assert.equal(onActionColor('#C51A1B'), '#FFFFFF')
  for (const action of ['#0DCE97', '#F4B740', '#FFD400', '#00B2FF']) {
    const colors = { ...MATCHBOOK_COLORS, action }
    assert.deepEqual(playerThemeErrors(colors), {}, `${action} is valid`)
    assert.equal(onActionColor(action), '#141518', action)
    for (const mode of THEME_MODES) {
      const t: Record<string, string> = playerThemeTokens(colors, mode)
      assert.equal(t['--mb-on-red'], '#141518')
      for (const token of ON_ACTION_BRAND_TOKENS) assert.ok(contrast('#141518', t[token] ?? '') >= 4.5, `${action} ${mode} ink on ${token}`)
    }
    assert.ok(playerThemeCss(colors).includes('--mb-on-red:#141518'))
  }
})

test('every preset keeps white button text and emits nothing for Matchbook', () => {
  for (const { id, colors } of PLAYER_THEME_PRESETS) {
    assert.deepEqual(playerThemeErrors(colors), {}, id)
    for (const mode of THEME_MODES) assert.equal(playerThemeTokens(colors, mode)['--mb-on-red'], '#FFFFFF', `${id} ${mode}`)
  }
  assert.equal(playerThemeCss(MATCHBOOK_COLORS), '')
})
