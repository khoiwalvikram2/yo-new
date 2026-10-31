/**
 * sectionMetaFor is what the rail and the panel heading show for a section key. Every key the
 * navigation model can produce (getNavigationForUser / getAgentNavigation) must hit the table
 * (S "Sections" table); the fallback exists only for a key nobody currently emits and must never
 * leak an inherited Object.prototype property such as "toString" as if it were a real section.
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import {
  IconChartBar,
  IconCube,
  IconGift,
  IconPoint,
  IconSettings,
  IconStack2,
  IconUsers,
  IconWallet,
} from '@tabler/icons-react'
import { SECTION_META, sectionMetaFor } from './sectionMeta'

describe('SECTION_META', () => {
  test('has exactly the seven spec keys, each with its title, subtitle and icon', () => {
    assert.deepEqual(Object.keys(SECTION_META), [
      'overview',
      'trading',
      'userManagement',
      'marketing',
      'finance',
      'reporting',
      'system',
    ])
    assert.deepEqual(SECTION_META.overview, {
      title: 'Analytics',
      subtitle: 'Understand your business',
      icon: IconChartBar,
    })
    assert.deepEqual(SECTION_META.trading, {
      title: 'Trading',
      subtitle: 'Overview, markets and bets',
      icon: IconCube,
    })
    assert.deepEqual(SECTION_META.userManagement, {
      title: 'Users',
      subtitle: 'Players and agents',
      icon: IconUsers,
    })
    assert.deepEqual(SECTION_META.marketing, {
      title: 'Marketing',
      subtitle: 'Bonuses, referrals and VIP',
      icon: IconGift,
    })
    assert.deepEqual(SECTION_META.finance, {
      title: 'Finance',
      subtitle: 'Money in and money out',
      icon: IconWallet,
    })
    assert.deepEqual(SECTION_META.reporting, {
      title: 'Reporting',
      subtitle: 'Numbers you can export',
      icon: IconStack2,
    })
    assert.deepEqual(SECTION_META.system, {
      title: 'System',
      subtitle: 'Access and configuration',
      icon: IconSettings,
    })
  })
})

describe('sectionMetaFor', () => {
  test('returns the table entry for a known key and ignores the fallback label', () => {
    assert.deepEqual(sectionMetaFor('finance', 'ignored'), SECTION_META.finance)
  })

  test('falls back to the section label, no subtitle and IconPoint for a key not in the table', () => {
    assert.deepEqual(sectionMetaFor('promotions', 'Promotions'), {
      title: 'Promotions',
      subtitle: null,
      icon: IconPoint,
    })
  })

  test('ignores inherited Object.prototype keys such as toString (I3)', () => {
    assert.deepEqual(sectionMetaFor('toString', 'X'), { title: 'X', subtitle: null, icon: IconPoint })
  })
})
