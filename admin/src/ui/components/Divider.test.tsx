import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, render, screen } from '@testing-library/react'
import { Divider } from './Divider'
import styles from './Divider.module.css'

afterEach(cleanup)

describe('Divider', () => {
  test('uses a native hr for a horizontal content separator', () => {
    render(<Divider aria-label="Account details" className="caller" />)

    const divider = screen.getByRole('separator', { name: 'Account details' })
    assert.equal(divider.tagName, 'HR')
    assert.equal(divider.hasAttribute('role'), false)
    assert.equal(divider.hasAttribute('aria-orientation'), false)
    assert.ok(divider.classList.contains(styles.horizontal))
    assert.ok(divider.classList.contains('caller'))
  })

  test('uses an explicitly oriented separator between controls', () => {
    render(
      <div>
        <button type="button">Previous</button>
        <Divider orientation="vertical" aria-label="Page controls" />
        <button type="button">Next</button>
      </div>,
    )

    const divider = screen.getByRole('separator', { name: 'Page controls' })
    assert.equal(divider.tagName, 'SPAN')
    assert.equal(divider.getAttribute('aria-orientation'), 'vertical')
    assert.ok(divider.classList.contains(styles.vertical))
  })
})
