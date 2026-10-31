/**
 * The reports band is a heading, a line of copy and one link. What matters is that the link goes to the
 * Export Center (the page its gate was taken from), is named by its words rather than its arrow, and that
 * the decoration stays out of the accessibility tree.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ReportsBanner } from './ReportsBanner'

describe('ReportsBanner', () => {
  test('names itself and links "Create a report" to the Export Center', () => {
    const { container } = render(
      <MemoryRouter>
        <ReportsBanner />
      </MemoryRouter>
    )
    assert.ok(screen.getByRole('region', { name: 'Get deeper insights' }))
    // level 2, as every card title on /overview is: h1 page, h2 card or band, h3 label inside a card
    assert.ok(screen.getByRole('heading', { name: 'Get deeper insights', level: 2 }))
    assert.ok(screen.getByText('Build custom exports and save them as templates.'))

    const link = screen.getByRole('link', { name: 'Create a report' })
    assert.equal(link.getAttribute('href'), '/reporting/exports')
    // one flex item holding the words, a word space and the hidden arrow, so the link's gap never
    // falls between the text and the arrow
    assert.equal(link.children.length, 1)
    assert.equal(link.textContent, 'Create a report →')
    const arrow = link.querySelector('[aria-hidden="true"]')
    assert.equal(arrow?.textContent, '→')

    const svgs = container.querySelectorAll('svg')
    assert.equal(svgs.length, 2)
    svgs.forEach(svg => assert.equal(svg.getAttribute('aria-hidden'), 'true'))
  })
})
