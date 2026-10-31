import assert from 'node:assert/strict'
import { render, screen } from '@testing-library/react'
import { describe, test } from 'vitest'
import { FieldShell } from './FieldShell'

describe('FieldShell', () => {
  test('owns the label, required state and every descriptive id', () => {
    render(
      <FieldShell
        id="approval-note"
        label="Approval note"
        required
        help="Explain the decision"
        error="A note is required"
        count="0 / 120"
        describedBy="external-guidance"
      >
        {(props) => <textarea {...props} />}
      </FieldShell>,
    )

    const control = screen.getByRole('textbox', { name: 'Approval note' })
    assert.equal(control.id, 'approval-note')
    assert.equal(control.getAttribute('aria-required'), 'true')
    assert.equal(control.getAttribute('aria-invalid'), 'true')
    assert.equal(
      control.getAttribute('aria-describedby'),
      'external-guidance approval-note-help approval-note-error approval-note-count',
    )
    assert.equal(screen.getByText('Explain the decision').id, 'approval-note-help')
    assert.equal(screen.getByRole('alert').id, 'approval-note-error')
    assert.equal(screen.getByText('0 / 120').id, 'approval-note-count')
  })

  test('keeps a hidden real label and generates a stable control id', () => {
    render(
      <FieldShell label="Internal note" hideLabel>
        {(props) => <input {...props} />}
      </FieldShell>,
    )

    const control = screen.getByRole('textbox', { name: 'Internal note' })
    const label = screen.getByText('Internal note')
    assert.ok(control.id.startsWith('field-'))
    assert.equal(label.getAttribute('for'), control.id)
  })

  test('only makes the count a live region when requested', () => {
    const { rerender } = render(
      <FieldShell id="remark" label="Remark" count="30 / 100">
        {(props) => <textarea {...props} />}
      </FieldShell>,
    )

    assert.equal(document.getElementById('remark-count')?.textContent, '30 / 100')
    assert.equal(screen.getByRole('status').textContent, '')

    rerender(
      <FieldShell id="remark" label="Remark" count="95 / 100" countLive>
        {(props) => <textarea {...props} />}
      </FieldShell>,
    )
    assert.equal(document.getElementById('remark-count')?.textContent, '95 / 100')
    assert.equal(screen.getByRole('status').textContent, '95 / 100')
    assert.equal(screen.getByRole('status').getAttribute('aria-live'), 'polite')
    assert.equal(screen.getByRole('status').getAttribute('aria-atomic'), 'true')
  })

  test('marks the count over its limit only when asked', () => {
    const { rerender } = render(
      <FieldShell id="remark" label="Remark" count="100 / 100">
        {(props) => <textarea {...props} />}
      </FieldShell>,
    )
    const count = document.getElementById('remark-count') as HTMLElement
    assert.equal(count.className.includes('over'), false)

    rerender(
      <FieldShell id="remark" label="Remark" count="104 / 100" countOver>
        {(props) => <textarea {...props} />}
      </FieldShell>,
    )
    assert.ok(count.className.includes('over'))
    assert.ok(count.className.includes('count'))
  })

  test('an error overrides a caller-supplied success status', () => {
    const { container } = render(
      <FieldShell id="amount" label="Amount" status="success" error="Amount is required">
        {(props) => <input {...props} />}
      </FieldShell>,
    )

    const root = container.firstElementChild as HTMLElement
    assert.equal(screen.getByRole('textbox', { name: 'Amount' }).getAttribute('aria-invalid'), 'true')
    assert.ok(root.className.includes('error'))
    assert.equal(root.className.includes('success'), false)
  })
})
