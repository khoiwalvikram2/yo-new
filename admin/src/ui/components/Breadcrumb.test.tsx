/**
 * The topbar breadcrumb replaces DynamicBreadcrumb, whose clickable crumbs were <span onClick> and could not
 * be reached by keyboard. The kit version must be a labelled navigation landmark with an ordered list, use
 * real router links for earlier crumbs, and announce exactly one crumb as the current page. useBreadcrumbs
 * is mocked: the real hook reads authStore (and through it Apollo), and its own rules are T29's concern.
 */
import { test, describe, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { BreadcrumbItem } from '@/hooks/useBreadcrumbs'
import { Breadcrumb } from './Breadcrumb'

const crumbs = vi.hoisted(() => ({ items: [] as BreadcrumbItem[] }))
vi.mock('@/hooks/useBreadcrumbs', () => ({ useBreadcrumbs: () => crumbs.items }))

function LocationProbe() {
  const { pathname } = useLocation()
  return (
    <div role="status" aria-label="Current path">
      {pathname}
    </div>
  )
}

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Breadcrumb />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('Breadcrumb', () => {
  beforeEach(() => {
    crumbs.items = []
  })

  test('renders nothing when useBreadcrumbs returns no crumbs', () => {
    renderAt('/login')
    assert.equal(screen.queryByRole('navigation'), null)
    assert.equal(screen.queryByRole('list'), null)
  })

  test('renders a Breadcrumb landmark with an ordered list of deduplicated crumbs', () => {
    crumbs.items = [
      { label: 'Dashboard', path: '/overview' },
      { label: 'Payments', path: '/payments/deposits' },
      { label: 'Payments', path: '/payments/deposits' },
      { label: 'Deposit Requests', path: '/payments/deposits', isLast: true },
    ]
    renderAt('/payments/deposits')
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const list = screen.getByRole('list')
    assert.equal(list.tagName, 'OL')
    assert.ok(nav.contains(list))
    const items = screen.getAllByRole('listitem')
    assert.deepEqual(
      items.map((item) => item.textContent),
      ['Dashboard', 'Payments', 'Deposit Requests'],
    )
  })

  test('earlier crumbs are real links; the final crumb and a crumb for the current path are not', () => {
    crumbs.items = [
      { label: 'Dashboard', path: '/overview' },
      { label: 'Payments', path: '/payments/deposits' },
      { label: 'Deposit Requests', path: '/payments/deposits', isLast: true },
    ]
    renderAt('/payments/deposits')
    const links = screen.getAllByRole('link')
    assert.equal(links.length, 1)
    const home = screen.getByRole('link', { name: 'Dashboard' })
    assert.equal(home.getAttribute('href'), '/overview')
    assert.equal(screen.queryByRole('link', { name: 'Payments' }), null)
    assert.equal(screen.queryByRole('link', { name: 'Deposit Requests' }), null)
  })

  test('only the final crumb carries aria-current="page"', () => {
    crumbs.items = [
      { label: 'Dashboard', path: '/overview' },
      { label: 'Payments', path: '/payments/deposits' },
      { label: 'Deposit Requests', path: '/payments/deposits', isLast: true },
    ]
    renderAt('/payments/deposits')
    const current = screen.getByRole('navigation', { name: 'Breadcrumb' }).querySelectorAll('[aria-current="page"]')
    assert.equal(current.length, 1)
    assert.equal(current[0].textContent, 'Deposit Requests')
  })

  test('isLast on the first crumb unlinks it but leaves aria-current on the final crumb only', () => {
    crumbs.items = [
      { label: 'Dashboard', path: '/overview', isLast: true },
      { label: 'Reports', path: '/reports' },
    ]
    renderAt('/reports/summary')
    assert.equal(screen.queryAllByRole('link').length, 0)
    const current = screen.getByRole('navigation', { name: 'Breadcrumb' }).querySelectorAll('[aria-current="page"]')
    assert.equal(current.length, 1)
    assert.equal(current[0].textContent, 'Reports')
  })

  test('clicking a crumb link navigates inside the router', async () => {
    crumbs.items = [
      { label: 'Dashboard', path: '/overview' },
      { label: 'Players', path: '/players' },
      { label: 'Player List', path: '/players/list', isLast: true },
    ]
    renderAt('/players/list')
    const probe = screen.getByRole('status', { name: 'Current path' })
    assert.equal(probe.textContent, '/players/list')
    fireEvent.click(screen.getByRole('link', { name: 'Players' }))
    await waitFor(() => assert.equal(probe.textContent, '/players'))
  })

  test('passes className to the navigation landmark', () => {
    crumbs.items = [{ label: 'Dashboard', path: '/overview', isLast: true }]
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <Breadcrumb className="topbarCrumbs" />
      </MemoryRouter>,
    )
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    assert.ok(nav.classList.contains('topbarCrumbs'))
  })
})
