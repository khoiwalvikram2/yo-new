import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PageHeader } from './PageHeader'
import styles from './PageHeader.module.css'

afterEach(cleanup)

function renderHeader(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>)
}

describe('PageHeader', () => {
  test('renders only the page title without category or descriptive copy', () => {
    renderHeader(
      <PageHeader
        eyebrow="Finance"
        title="Deposit Requests"
        sub="Requests waiting on a decision, newest first."
      />,
    )

    const headings = screen.getAllByRole('heading')
    assert.equal(headings.length, 1)
    assert.equal(headings[0]?.tagName, 'H1')
    assert.equal(headings[0]?.textContent, 'Deposit Requests')
    assert.ok(screen.queryByText('Finance') === null)
    assert.ok(screen.queryByText(/Requests waiting/) === null)
  })

  test('uses an accessible icon link immediately to the left of the title', () => {
    renderHeader(
      <PageHeader
        title="Create Bonus"
        back={{ to: '/bonuses', label: 'Back to bonuses' }}
      />,
    )

    const link = screen.getByRole('link', { name: 'Back to bonuses' })
    assert.equal(link.tagName, 'A')
    assert.equal(link.getAttribute('href'), '/bonuses')
    assert.equal(link.textContent, '')
    assert.equal(link.nextElementSibling, screen.getByRole('heading', { level: 1 }))
    assert.equal(link.querySelector('svg')?.getAttribute('aria-hidden'), 'true')
  })

  test('puts actions in the dedicated slot that becomes a full phone row', () => {
    const { container } = renderHeader(
      <PageHeader title="Exposure" meta={<span>In play</span>} actions={<button type="button">Refresh</button>} />,
    )

    const action = screen.getByRole('button', { name: 'Refresh' })
    const slot = action.parentElement
    assert.ok(slot?.classList.contains(styles.actions))
    assert.equal(slot?.parentElement, container.querySelector('header'))
    assert.ok(slot?.contains(screen.getByText('In play')))
    assert.equal(screen.getByRole('heading', { level: 1 }).parentElement?.textContent, 'Exposure')
    assert.ok(
      screen.getByRole('heading', { level: 1 }).compareDocumentPosition(slot as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  test('accepts the shell hook null while preserving arbitrary header attributes and classes', () => {
    const { container } = renderHeader(
      <PageHeader
        eyebrow={null}
        title="Exposure"
        className="route-header"
        aria-label="Exposure page header"
      />,
    )

    const header = container.querySelector('header')
    assert.equal(header?.getAttribute('aria-label'), 'Exposure page header')
    assert.ok(header?.classList.contains('route-header'))
    assert.equal(header?.querySelector('p'), null)
  })
})
