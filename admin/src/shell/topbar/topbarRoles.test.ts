import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import { deriveTopbarRoles, type TopbarRoleInput } from './topbarRoles'

/**
 * Every topbar widget's visibility comes from one set of flags (Topbar.tsx:49-66, moved verbatim).
 * These tests pin the role predicates and the wallet precedence so a future edit cannot silently
 * show a Super Admin's bells, an agent's tenant selects, or two wallets at once.
 */

/** Base input for a plain administrator; each test overrides only what it needs. */
function baseInput(overrides: Partial<TopbarRoleInput> = {}): TopbarRoleInput {
  return {
    roles: [],
    isAgent: false,
    agentSchemeType: undefined,
    userName: 'Rahul S.',
    agentUsername: undefined,
    ...overrides,
  }
}

describe('deriveTopbarRoles', () => {
  test('Super Admin sees neither bell and loses the tenant/currency selects', () => {
    // Topbar.tsx:361 hides both bells with `!isSuperAdmin`; Topbar.tsx:219 hides the desktop
    // selects with `!isAgent && !isWhitelabelAdmin && !isSuperAdmin`.
    const roles = deriveTopbarRoles(baseInput({ roles: ['Super Admin'] }))
    assert.equal(roles.isSuperAdmin, true)
    assert.equal(roles.showGeneralBell, false)
    assert.equal(roles.showTaskBell, false)
    assert.equal(roles.showTenantCurrency, false)
    assert.equal(roles.wallet, null)
  })

  test('a Whitelabel Admin role mounts the whitelabel wallet and hides tenant/currency', () => {
    const roles = deriveTopbarRoles(baseInput({ roles: ['Whitelabel Admin'] }))
    assert.equal(roles.isWhitelabelAdmin, true)
    assert.equal(roles.wallet, 'whitelabel')
    assert.equal(roles.showTenantCurrency, false)
    assert.equal(roles.showGeneralBell, true)
  })

  test('a SHARING agent resolves to the agentSharing wallet', () => {
    const roles = deriveTopbarRoles(
      baseInput({ isAgent: true, agentSchemeType: 'SHARING', userName: undefined, agentUsername: 'agent-sharing-1' }),
    )
    assert.equal(roles.isSharingAgent, true)
    assert.equal(roles.isCreditAgent, false)
    assert.equal(roles.wallet, 'agentSharing')
    assert.equal(roles.userName, 'agent-sharing-1')
    assert.equal(roles.userRole, 'Agent')
  })

  test('a CREDIT agent resolves to the agentCredit wallet only, never agentSharing', () => {
    // AgentCreditWalletView already carries a Sharing tab (decision 4); a CREDIT scheme agent must
    // not also mount a separate AgentSharingWallet next to it.
    const roles = deriveTopbarRoles(baseInput({ isAgent: true, agentSchemeType: 'CREDIT' }))
    assert.equal(roles.isCreditAgent, true)
    assert.equal(roles.isSharingAgent, false)
    assert.equal(roles.wallet, 'agentCredit')
  })

  test('a COMMISSION agent resolves to the agentCommission wallet', () => {
    const roles = deriveTopbarRoles(baseInput({ isAgent: true, agentSchemeType: 'COMMISSION' }))
    assert.equal(roles.isCommissionAgent, true)
    assert.equal(roles.wallet, 'agentCommission')
  })

  test('every agent loses the task bell and the tenant/currency selects, keeps the general bell', () => {
    const roles = deriveTopbarRoles(baseInput({ isAgent: true, agentSchemeType: 'CREDIT' }))
    assert.equal(roles.showTaskBell, false)
    assert.equal(roles.showGeneralBell, true)
    assert.equal(roles.showTenantCurrency, false)
  })

  test('userName falls back to the agent username, then to "User"', () => {
    const withAgentUsername = deriveTopbarRoles(baseInput({ userName: null, agentUsername: 'agent-77' }))
    assert.equal(withAgentUsername.userName, 'agent-77')
    const withNeither = deriveTopbarRoles(baseInput({ userName: null, agentUsername: null }))
    assert.equal(withNeither.userName, 'User')
  })
})
