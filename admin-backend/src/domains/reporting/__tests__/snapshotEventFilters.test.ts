import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  eventFilterToRepoScope,
  resolveSnapshotEventFilters,
} from '../snapshotEventFilters.js'

describe('resolveSnapshotEventFilters', () => {
  it('returns null for Super Admin core mode with no GraphQL args', () => {
    const ctx = {
      user: { roles: ['Super Admin'] },
      directorMode: 'core',
    }
    assert.equal(resolveSnapshotEventFilters(ctx), null)
  })

  it('returns explicit tenant/whitelabel for Super Admin core when args provided', () => {
    const ctx = {
      user: { roles: ['Super Admin'] },
      directorMode: 'core',
    }
    assert.deepEqual(resolveSnapshotEventFilters(ctx, { tenant: 't1', whitelabelId: null }), {
      tenant: 't1',
    })
  })

  it('scopes to director whitelabel in whitelabel mode', () => {
    const ctx = {
      user: { roles: ['Super Admin'] },
      directorMode: 'whitelabel',
      directorWhitelabelId: 'wl-99',
    }
    assert.deepEqual(resolveSnapshotEventFilters(ctx), { whitelabelId: 'wl-99' })
  })

  it('uses ctx tenant for whitelabel admin', () => {
    const ctx = {
      user: { roles: ['Whitelabel Admin'] },
      tenant: 'acme',
      whitelabel: { id: 'wl-1' },
    }
    assert.deepEqual(resolveSnapshotEventFilters(ctx), { tenant: 'acme', whitelabelId: 'wl-1' })
  })
})

describe('eventFilterToRepoScope', () => {
  it('returns undefined when filter is null', () => {
    assert.equal(eventFilterToRepoScope(null), undefined)
  })

  it('returns undefined for empty object', () => {
    assert.equal(eventFilterToRepoScope({}), undefined)
  })

  it('passes through whitelabel-only scope', () => {
    assert.deepEqual(eventFilterToRepoScope({ whitelabelId: 'wl-9' }), { whitelabelId: 'wl-9' })
  })
})
