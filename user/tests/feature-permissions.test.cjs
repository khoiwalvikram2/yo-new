const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-source.cjs');
test('product menus wait for current owner settings, then retain each effective visibility flag', () => {
  const state = { isLoading: true, parsedSettings: { features: { sportsEnabled: true, casinoEnabled: true, matkaEnabled: true, registerEnabled: true } } };
  const hooks = loader({ '../lib/app-settings': { useAppSettings: () => state } })('src/hooks/useAppSettings.ts');
  assert.deepEqual(JSON.parse(JSON.stringify(hooks.useFeatureFlags())), { sportsEnabled: false, casinoEnabled: false, matkaEnabled: false, registerEnabled: true });
  state.isLoading = false;
  assert.equal(hooks.useFeatureFlags(), state.parsedSettings.features);
  for (const domain of ['sports', 'casino', 'matka']) {
    state.parsedSettings.features[`${domain}Enabled`] = false;
    assert.equal(hooks.useFeatureFlags()[`${domain}Enabled`], false);
    state.parsedSettings.features[`${domain}Enabled`] = true;
  }
  state.isLoading = true; // Logout/login owner changes must hide the previous owner's menus.
  assert.equal(hooks.useFeatureFlags().casinoEnabled, false);
});
