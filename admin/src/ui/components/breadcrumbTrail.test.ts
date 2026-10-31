/**
 * toBreadcrumbTrail carries DynamicBreadcrumb's display rules into the new topbar unchanged: a crumb that
 * repeats the label before it is dropped, only earlier crumbs that point somewhere else are links, and the
 * current page is never a link. useBreadcrumbs can mark the FIRST crumb isLast while another crumb follows;
 * that crumb must look current without being announced as the page, or two crumbs would claim aria-current.
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import type { BreadcrumbItem } from '@/hooks/useBreadcrumbs'
import { toBreadcrumbTrail } from './breadcrumbTrail'

describe('toBreadcrumbTrail', () => {
  test('returns an empty trail for no crumbs', () => {
    assert.deepEqual(toBreadcrumbTrail([], '/overview'), [])
  })

  test('a single root crumb is home, current and final, and not a link', () => {
    const items: BreadcrumbItem[] = [{ label: 'Dashboard', path: '/overview', isLast: true }]
    assert.deepEqual(toBreadcrumbTrail(items, '/overview'), [
      { label: 'Dashboard', href: null, isHome: true, isCurrent: true, isFinal: true },
    ])
  })

  test('links earlier crumbs and leaves the final crumb unlinked', () => {
    const items: BreadcrumbItem[] = [
      { label: 'Dashboard', path: '/overview' },
      { label: 'Players', path: '/players' },
      { label: 'Player List', path: '/players/list', isLast: true },
    ]
    assert.deepEqual(toBreadcrumbTrail(items, '/players/list'), [
      { label: 'Dashboard', href: '/overview', isHome: true, isCurrent: false, isFinal: false },
      { label: 'Players', href: '/players', isHome: false, isCurrent: false, isFinal: false },
      { label: 'Player List', href: null, isHome: false, isCurrent: true, isFinal: true },
    ])
  })

  test('a crumb whose path is the current pathname is not a link even when it is not last', () => {
    const items: BreadcrumbItem[] = [
      { label: 'Dashboard', path: '/overview' },
      { label: 'Payments', path: '/payments/deposits' },
      { label: 'Deposit Requests', path: '/payments/deposits', isLast: true },
    ]
    assert.deepEqual(toBreadcrumbTrail(items, '/payments/deposits'), [
      { label: 'Dashboard', href: '/overview', isHome: true, isCurrent: false, isFinal: false },
      { label: 'Payments', href: null, isHome: false, isCurrent: false, isFinal: false },
      { label: 'Deposit Requests', href: null, isHome: false, isCurrent: true, isFinal: true },
    ])
  })

  test('drops a crumb that repeats the label of the crumb before it in the unfiltered list', () => {
    const run: BreadcrumbItem[] = [
      { label: 'A', path: '/a' },
      { label: 'A', path: '/a2' },
      { label: 'A', path: '/a3' },
      { label: 'B', path: '/b', isLast: true },
    ]
    const trail = toBreadcrumbTrail(run, '/b')
    assert.deepEqual(trail.map((crumb) => crumb.label), ['A', 'B'])
    assert.equal(trail[0].href, '/a')
    assert.equal(trail[1].isFinal, true)

    const apart: BreadcrumbItem[] = [
      { label: 'Players', path: '/players' },
      { label: 'Reports', path: '/reports' },
      { label: 'Players', path: '/players/x', isLast: true },
    ]
    assert.deepEqual(
      toBreadcrumbTrail(apart, '/players/x').map((crumb) => crumb.label),
      ['Players', 'Reports', 'Players'],
    )
  })

  test('a path with a route parameter, an empty path or no path is not a link', () => {
    const items: BreadcrumbItem[] = [
      { label: 'Dashboard', path: '/overview' },
      { label: 'Player', path: '/players/:id' },
      { label: 'Empty', path: '' },
      { label: 'Label only' },
      { label: 'Final', path: '/x/y', isLast: true },
    ]
    assert.deepEqual(
      toBreadcrumbTrail(items, '/x/y').map((crumb) => crumb.href),
      ['/overview', null, null, null, null],
    )
  })

  test('isLast on the first crumb styles it current without making it final', () => {
    const items: BreadcrumbItem[] = [
      { label: 'Dashboard', path: '/overview', isLast: true },
      { label: 'Reports', path: '/reports' },
    ]
    assert.deepEqual(toBreadcrumbTrail(items, '/reports/summary'), [
      { label: 'Dashboard', href: null, isHome: true, isCurrent: true, isFinal: false },
      { label: 'Reports', href: null, isHome: false, isCurrent: true, isFinal: true },
    ])
  })
})
