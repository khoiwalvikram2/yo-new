import test from 'node:test'
import assert from 'node:assert/strict'
import { paymentWhitelabelSelectionRequired, resolvePaymentTenant } from './paymentTenant.js'

test('Super Admin must select a whitelabel before gateway configuration or approval', () => {
  for (const ctx of [
    { directorMode: 'core', tenant: 'default', directorWhitelabelId: 'site_a' },
    { directorMode: 'whitelabel', tenant: 'default', directorWhitelabelId: null },
    { tenant: 'default' },
  ]) {
    const context = { ...ctx, user: { roles: ['Super Admin'] } }
    assert.equal(paymentWhitelabelSelectionRequired(context), true)
    assert.throws(() => resolvePaymentTenant(context), /Select a whitelabel/)
  }
})

test('Super Admin uses the selected whitelabel rather than the host/default tenant', () => {
  const context = { user: { roles: ['super_admin'] }, tenant: 'default', directorMode: 'whitelabel', directorWhitelabelId: 'site_b' }
  assert.equal(resolvePaymentTenant(context), 'site_b')
  assert.equal(paymentWhitelabelSelectionRequired(context), false)
})

test('whitelabel admins and agents use their authenticated tenant, ignoring director selection', () => {
  for (const role of ['Whitelabel Admin', 'Support Admin', 'Agent']) {
    assert.equal(resolvePaymentTenant({ user: { roles: [role] }, tenant: 'site_a', directorMode: 'whitelabel', directorWhitelabelId: 'site_b' }), 'site_a')
  }
})

test('payment scope cannot silently fall back to default for a missing user or tenant', () => {
  assert.throws(() => resolvePaymentTenant({ tenant: 'site_a' }), /authentication required/)
  assert.throws(() => resolvePaymentTenant({ user: { roles: [] } }), /whitelabel is required/)
  assert.equal(resolvePaymentTenant({ user: { roles: [] }, whitelabel: { id: 'site_a' } }), 'site_a')
})
