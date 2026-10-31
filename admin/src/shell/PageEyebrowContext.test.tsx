import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen } from '@testing-library/react'
import { PageEyebrowProvider, usePageEyebrow } from './PageEyebrowContext'

function EyebrowProbe() {
  const eyebrow = usePageEyebrow()
  return <output data-testid="eyebrow">{eyebrow ?? 'no section'}</output>
}

describe('PageEyebrowContext', () => {
  test('is safe outside AppShell and reports that no section is shown', () => {
    render(<EyebrowProbe />)
    assert.equal(screen.getByTestId('eyebrow').textContent, 'no section')
  })

  test('exposes the exact shown-section label and updates without adding a DOM wrapper', () => {
    const view = render(
      <PageEyebrowProvider value="Payment Operations">
        <EyebrowProbe />
      </PageEyebrowProvider>,
    )

    assert.equal(screen.getByTestId('eyebrow').textContent, 'Payment Operations')
    assert.equal(view.container.childElementCount, 1)
    assert.equal(view.container.firstElementChild?.tagName, 'OUTPUT')

    view.rerender(
      <PageEyebrowProvider value="Reports & Insights">
        <EyebrowProbe />
      </PageEyebrowProvider>,
    )
    assert.equal(screen.getByTestId('eyebrow').textContent, 'Reports & Insights')

    view.rerender(
      <PageEyebrowProvider value={null}>
        <EyebrowProbe />
      </PageEyebrowProvider>,
    )
    assert.equal(screen.getByTestId('eyebrow').textContent, 'no section')
  })
})
