/**
 * The panel must show the section that owns the current page (decision 7): the longest matching row wins,
 * the four prefixes cover routes with no row, and an unmatched route keeps what the user is looking at.
 * A rail click shows a section only until the next navigation, and a new sections array for the same path
 * (a directorMode switch) must not throw the user out of the section they chose unless it disappeared.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { act, renderHook } from '@testing-library/react'
import { IconPoint } from '@tabler/icons-react'
import type { ShellRow, ShellRowEntry, ShellSection } from './shellTypes'
import { useShownSection } from './useShownSection'

function row(sectionKey: string, to: string, label: string): ShellRow {
  return {
    id: `${sectionKey}|${to}|${to}`,
    sectionKey,
    sectionTitle: sectionKey,
    to,
    label,
    icon: IconPoint,
    keywords: [],
    badgeKey: null,
  }
}

function section(key: string, rows: ShellRow[]): ShellSection {
  return {
    key,
    title: key,
    subtitle: null,
    icon: IconPoint,
    badgeKey: null,
    entries: rows.map((entryRow): ShellRowEntry => ({ kind: 'row', row: entryRow })),
    rows,
  }
}

const OVERVIEW = section('overview', [row('overview', '/overview', 'Overview')])
const TRADING = section('trading', [row('trading', '/matka/results', 'Matka results')])
const USERS = section('userManagement', [
  row('userManagement', '/players', 'Players'),
  row('userManagement', '/players/create', 'Create Player'),
])
const SYSTEM = section('system', [row('system', '/config/settings', 'Settings')])
const SECTIONS: readonly ShellSection[] = [OVERVIEW, TRADING, USERS, SYSTEM]

interface ShownProps {
  pathname: string
  sections: readonly ShellSection[]
}

function renderShown(pathname: string, sections: readonly ShellSection[] = SECTIONS) {
  return renderHook((props: ShownProps) => useShownSection(props.pathname, props.sections), {
    initialProps: { pathname, sections },
  })
}

describe('useShownSection', () => {
  test('a cold load on a matched route shows the row section and marks the longest row', () => {
    const { result } = renderShown('/players/create')
    assert.equal(result.current.shownKey, 'userManagement')
    assert.equal(result.current.activeTo, '/players/create')
  })

  test('a cold load on an unmatched route shows the first section with no active row', () => {
    const { result } = renderShown('/notifications')
    assert.equal(result.current.shownKey, 'overview')
    assert.equal(result.current.activeTo, null)
  })

  test('a prefix fallback picks the section without marking a row', () => {
    const { result } = renderShown('/sports/event/42')
    assert.equal(result.current.shownKey, 'trading')
    assert.equal(result.current.activeTo, null)
  })

  test('navigation resolves the new pathname', () => {
    const { result, rerender } = renderShown('/players')
    rerender({ pathname: '/overview', sections: SECTIONS })
    assert.equal(result.current.shownKey, 'overview')
    assert.equal(result.current.activeTo, '/overview')
  })

  test('navigation to an unmatched route keeps the section currently shown', () => {
    const { result, rerender } = renderShown('/players')
    rerender({ pathname: '/notifications', sections: SECTIONS })
    assert.equal(result.current.shownKey, 'userManagement')
    assert.equal(result.current.activeTo, null)
  })

  test('a rail click shows that section and leaves the active row alone', () => {
    const { result } = renderShown('/players')
    act(() => result.current.showSection('system'))
    assert.equal(result.current.shownKey, 'system')
    assert.equal(result.current.activeTo, '/players')
  })

  test('a rail click holds only until the next navigation to a matched route', () => {
    const { result, rerender } = renderShown('/players')
    act(() => result.current.showSection('system'))
    rerender({ pathname: '/overview', sections: SECTIONS })
    assert.equal(result.current.shownKey, 'overview')
    assert.equal(result.current.activeTo, '/overview')
  })

  test('after a rail click, navigation to an unmatched route keeps the clicked section', () => {
    const { result, rerender } = renderShown('/players')
    act(() => result.current.showSection('system'))
    rerender({ pathname: '/notifications', sections: SECTIONS })
    assert.equal(result.current.shownKey, 'system')
    assert.equal(result.current.activeTo, null)
  })

  test('a new sections array for the same path does not recompute while the shown section is visible', () => {
    const { result, rerender } = renderShown('/players')
    act(() => result.current.showSection('system'))
    rerender({ pathname: '/players', sections: [...SECTIONS] })
    assert.equal(result.current.shownKey, 'system')
    assert.equal(result.current.activeTo, '/players')
  })

  test('when the shown section vanishes for the same path, steps 1-4 run again and the row match wins', () => {
    const { result, rerender } = renderShown('/players')
    act(() => result.current.showSection('system'))
    rerender({ pathname: '/players', sections: [OVERVIEW, TRADING, USERS] })
    assert.equal(result.current.shownKey, 'userManagement')
    assert.equal(result.current.activeTo, '/players')
  })

  test('when the shown section vanishes on an unmatched route, the first section is shown', () => {
    const { result, rerender } = renderShown('/notifications')
    act(() => result.current.showSection('system'))
    assert.equal(result.current.shownKey, 'system')
    rerender({ pathname: '/notifications', sections: [OVERVIEW, TRADING, USERS] })
    assert.equal(result.current.shownKey, 'overview')
    assert.equal(result.current.activeTo, null)
  })

  test('no sections gives no shown section; sections arriving or leaving for the same path are resolved', () => {
    const { result, rerender } = renderShown('/players', [])
    assert.equal(result.current.shownKey, null)
    assert.equal(result.current.activeTo, null)
    rerender({ pathname: '/players', sections: SECTIONS })
    assert.equal(result.current.shownKey, 'userManagement')
    assert.equal(result.current.activeTo, '/players')
    rerender({ pathname: '/players', sections: [] })
    assert.equal(result.current.shownKey, null)
    assert.equal(result.current.activeTo, null)
  })

  test('activeTo follows a sections change for the same path', () => {
    const { result, rerender } = renderShown('/players/create')
    assert.equal(result.current.activeTo, '/players/create')
    const usersWithoutCreate = section('userManagement', [row('userManagement', '/players', 'Players')])
    rerender({ pathname: '/players/create', sections: [OVERVIEW, TRADING, usersWithoutCreate, SYSTEM] })
    assert.equal(result.current.shownKey, 'userManagement')
    assert.equal(result.current.activeTo, '/players')
  })

  test('showSection keeps its identity across renders', () => {
    const { result, rerender } = renderShown('/players')
    const first = result.current.showSection
    rerender({ pathname: '/overview', sections: [...SECTIONS] })
    assert.equal(result.current.showSection, first)
  })
})
