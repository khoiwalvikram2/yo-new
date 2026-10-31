/**
 * NAV_ICONS must cover every Font Awesome name that navigationData.ts and the agent navigation
 * builder (navigationUtils.ts) can actually emit, verified by walking the
 * real data and both agent schemes, not by trusting the literal count in the map. A gap here
 * means some row would silently render IconPoint in the rail or panel.
 */
import { test, describe, vi } from 'vitest'
import assert from 'node:assert/strict'
import { IconClock, IconHeartHandshake, IconPoint } from '@tabler/icons-react'

// navigationUtils.ts imports ./uiStore, which imports @/shared/core/api and starts a
// useAuthStore.subscribe() at module load (contracts §14 "Standard mocks").
const ui = vi.hoisted(() => ({ directorMode: 'core' as 'core' | 'whitelabel' }))
vi.mock('@/shared/core/uiStore', () => ({ useUIStore: { getState: () => ui } }))

import { navigationData } from '@/components/sidebar/navigationData'
import { getAgentNavigation, type AgentAccount } from '@/shared/core/navigationUtils'
import { NAV_ICONS, faKey, navIcon } from './navIcons'

function agentNav(schemeType: AgentAccount['schemeType'], allowedDomains: string[]): unknown {
  const agent: AgentAccount = { id: 'a1', schemeType, allowedDomains, levelIndex: null }
  return getAgentNavigation(agent, allowedDomains)
}

/** Walks any nested object/array and collects faKey(icon) for every string "icon" field found. */
function collectFaKeys(source: unknown, names: Set<string>): void {
  if (Array.isArray(source)) {
    source.forEach((item) => collectFaKeys(item, names))
    return
  }
  if (source && typeof source === 'object') {
    const record = source as Record<string, unknown>
    if (typeof record.icon === 'string') names.add(faKey(record.icon))
    Object.values(record).forEach((value) => collectFaKeys(value, names))
  }
}

describe('NAV_ICONS', () => {
  test('maps every FA name reachable from navigationData and both agent schemes (I1)', () => {
    const names = new Set<string>()
    collectFaKeys(navigationData, names)
    collectFaKeys(agentNav('COMMISSION', ['sports', 'casino', 'matka']), names)
    collectFaKeys(agentNav('SHARING', ['sports', 'casino', 'matka']), names)

    assert.ok(names.size > 0)
    assert.deepEqual(
      [...names].filter((name) => !Object.hasOwn(NAV_ICONS, name)),
      [],
    )
    assert.deepEqual(Object.keys(NAV_ICONS).sort(), [...names].sort())
    assert.equal(navIcon('fa-solid fa-clock'), IconClock)
  })
})

describe('navIcon', () => {
  test('strips the fa-solid/fa- prefixes and falls back to IconPoint when unmapped or missing (I2)', () => {
    assert.equal(navIcon('fa-solid fa-handshake'), IconHeartHandshake)
    assert.equal(navIcon('fa-handshake'), IconHeartHandshake)
    assert.equal(navIcon('fa-solid fa-rocket'), IconPoint)
    assert.equal(navIcon(''), IconPoint)
    assert.equal(navIcon(undefined), IconPoint)
  })
})
