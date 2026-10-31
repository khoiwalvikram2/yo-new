const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, themeEnvironment, settingsTheme } = require('./load-source.cjs');

test('first visit initializes light before React renders', () => {
  const { theme, rootElement, styles, values } = themeEnvironment();
  theme.applyThemeAtStartup();
  assert.equal(theme.getThemeMode(), 'light');
  assert.equal(rootElement.classList.contains('light'), true);
  assert.equal(rootElement.classList.contains('dark'), false);
  assert.equal(rootElement.style.colorScheme, 'light');
  assert.equal(styles.get('--background'), 'var(--background-light)');
  assert.equal(values.get('stakex_theme_mode'), 'light');
  assert.equal(styles.get('--brand-primary'), '#2460EB');
});

test('saved dark mode is applied and survives a new session', () => {
  const first = themeEnvironment();
  first.theme.setThemeMode('dark');
  const second = themeEnvironment(Object.fromEntries(first.values));
  second.theme.applyThemeAtStartup();
  assert.equal(second.rootElement.classList.contains('dark'), true);
  assert.equal(second.rootElement.style.colorScheme, 'dark');
  assert.equal(second.styles.get('--text'), 'var(--text-dark)');
});

test('legacy auto-saved dark mode migrates to the new light default', () => {
  const { theme, rootElement, values } = themeEnvironment({ stakex_theme_mode: 'dark' });
  theme.applyThemeAtStartup();
  assert.equal(rootElement.classList.contains('light'), true);
  assert.equal(rootElement.classList.contains('dark'), false);
  assert.equal(values.get('stakex_theme_mode'), 'light');
  assert.equal(values.get('stakex_theme_mode_version'), '2');
});

test('invalid stored mode safely defaults to light', () => {
  const { theme } = themeEnvironment({ stakex_theme_mode: 'automatic' });
  assert.equal(theme.getThemeMode(), 'light');
});

test('switching dark back to light resets every semantic palette variable', () => {
  const { theme, styles, rootElement } = themeEnvironment();
  theme.setThemeMode('dark');
  const keys = Array.from(styles.keys());
  theme.setThemeMode('light');
  for (const key of keys) assert.match(styles.get(key), /light/, key);
  assert.equal(rootElement.classList.contains('dark'), false);
  assert.equal(rootElement.classList.contains('light'), true);
});

test('mode event is emitted after styles, classes and preference are updated', () => {
  const { theme, globals, rootElement, values, styles } = themeEnvironment();
  let count = 0;
  globals.window.addEventListener('theme-mode-change', event => {
    count++;
    assert.equal(event.detail.mode, 'dark');
    assert.equal(values.get('stakex_theme_mode'), 'dark');
    assert.equal(values.get('stakex_theme_mode_version'), '2');
    assert.equal(rootElement.classList.contains('dark'), true);
    assert.equal(styles.get('--surface'), 'var(--surface-dark)');
  });
  theme.setThemeMode('dark');
  assert.equal(count, 1);
});

test('blocked browser storage still allows repeated light/dark switching', () => {
  const { theme, rootElement } = themeEnvironment({}, true);
  assert.doesNotThrow(() => theme.applyThemeAtStartup());
  theme.toggleThemeMode();
  assert.equal(rootElement.classList.contains('dark'), true);
  theme.toggleThemeMode();
  assert.equal(rootElement.classList.contains('light'), true);
});

test('mode switches preserve configured whitelabel brand', () => {
  const { theme, styles } = themeEnvironment({ stakex_brand_theme: JSON.stringify({ '--brand-primary': '#a52e46' }) });
  theme.applyThemeAtStartup();
  theme.setThemeMode('dark');
  theme.setThemeMode('light');
  assert.equal(styles.get('--brand-primary'), '#a52e46');
});

test('malformed saved brand falls back without blocking startup', () => {
  const { theme, styles } = themeEnvironment({ stakex_brand_theme: '{bad json' });
  theme.applyThemeAtStartup();
  assert.equal(styles.get('--brand-primary'), '#2460EB');
});

test('server-side theme lookup and initialization do not require a DOM', () => {
  const theme = loader()('src/lib/theme.ts');
  assert.equal(theme.getThemeMode(), 'light');
  assert.doesNotThrow(() => theme.applyThemeAtStartup());
  assert.doesNotThrow(() => theme.toggleThemeMode());
});

test('legacy dark-only whitelabel palettes cannot force the light mode dark', () => {
  const environment = themeEnvironment();
  environment.theme.setThemeMode('light');
  const apply = settingsTheme(environment);
  apply({ whitelabelTheme: { primary: '#a52e46', bgPage: '#090909', textPrimary: '#ffffff', border: '#333333' } });
  assert.equal(environment.styles.get('--background'), '#F4F6FA');
  assert.equal(environment.styles.get('--text'), '#18243A');
  assert.equal(environment.styles.get('--brand-primary'), '#a52e46');
});

test('configured whitelabel light and dark palettes track the selected mode', () => {
  const environment = themeEnvironment();
  const apply = settingsTheme(environment);
  const parsed = { whitelabelTheme: { primary: '#a52e46', light: { bgPage: '#faf5f5', textPrimary: '#201010' }, dark: { bgPage: '#201010', textPrimary: '#faf5f5' } } };
  environment.theme.setThemeMode('dark');
  apply(parsed);
  assert.equal(environment.styles.get('--background'), '#201010');
  assert.equal(environment.styles.get('--text'), '#faf5f5');
  environment.theme.setThemeMode('light');
  apply(parsed);
  assert.equal(environment.styles.get('--background'), '#faf5f5');
  assert.equal(environment.styles.get('--text'), '#201010');
  assert.equal(environment.styles.get('--brand-primary'), '#a52e46');
});

test('legacy dark palette remains available when dark is explicitly selected', () => {
  const environment = themeEnvironment();
  environment.theme.setThemeMode('dark');
  settingsTheme(environment)({ whitelabelTheme: { bgPage: '#090909', textPrimary: '#ffffff' } });
  assert.equal(environment.styles.get('--background'), '#090909');
  assert.equal(environment.styles.get('--text'), '#ffffff');
});
