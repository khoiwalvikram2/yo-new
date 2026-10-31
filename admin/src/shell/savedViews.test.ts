/**
 * resolveSavedViews turns sidebarStore's favourited paths into the ShellRows the current user can still see,
 * in favourites order, silently hiding a saved path that no longer resolves (spec "Saved views": "a saved
 * path the user can no longer see is hidden") rather than rendering something broken.
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import { IconCash, IconUsers } from '@tabler/icons-react'
import type { ShellEntry, ShellRow, ShellSection } from './shellTypes'
import { resolveSavedViews } from './savedViews'

function makeRow(sectionKey: string, to: string, label: string): ShellRow {
  return {
    id: `${sectionKey}|${to}|${to}`,
    sectionKey,
    sectionTitle: sectionKey,
    to,
    label,
    icon: label === 'Players' ? IconUsers : IconCash,
    keywords: [],
    badgeKey: null,
  }
}

function makeSection(key: string, rows: ShellRow[]): ShellSection {
  const entries: ShellEntry[] = rows.map((row) => ({ kind: 'row', row }))
  return {
    key,
    title: key,
    subtitle: null,
    icon: IconCash,
    badgeKey: null,
    entries,
    rows,
  }
}

describe('resolveSavedViews', () => {
  test('resolves favourites to rows in favourites order, not section order', () => {
    const payments = makeRow('trading', '/payments', 'Payments')
    const players = makeRow('players', '/players', 'Players')
    const sections = [makeSection('trading', [payments]), makeSection('players', [players])]
    const result = resolveSavedViews(['/players', '/payments'], sections)
    assert.deepEqual(result.map((row) => row.to), ['/players', '/payments'])
  })

  test('hides a favourite path no longer present in any section', () => {
    const payments = makeRow('trading', '/payments', 'Payments')
    const sections = [makeSection('trading', [payments])]
    const result = resolveSavedViews(['/payments', '/gone'], sections)
    assert.deepEqual(result.map((row) => row.to), ['/payments'])
  })

  test('normalises query strings and trailing slashes before matching', () => {
    const payments = makeRow('trading', '/payments', 'Payments')
    const sections = [makeSection('trading', [payments])]
    const result = resolveSavedViews(['/payments/?tab=1'], sections)
    assert.equal(result.length, 1)
    assert.equal(result[0].to, '/payments')
  })

  test('de-duplicates rows sharing a normalised `to`, first section wins', () => {
    const first = makeRow('trading', '/dup', 'First')
    const second = makeRow('players', '/dup', 'Second')
    const sections = [makeSection('trading', [first]), makeSection('players', [second])]
    const result = resolveSavedViews(['/dup'], sections)
    assert.equal(result.length, 1)
    assert.equal(result[0].label, 'First')
  })

  test('returns an empty list with no favourites', () => {
    const payments = makeRow('trading', '/payments', 'Payments')
    const sections = [makeSection('trading', [payments])]
    assert.deepEqual(resolveSavedViews([], sections), [])
  })
})
