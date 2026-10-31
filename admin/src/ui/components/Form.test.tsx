import assert from 'node:assert/strict'
import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, test, vi } from 'vitest'
import { Button } from './Button'
import { Form, FormActions, FormField, FormSection } from './Form'
import formStyles from './Form.module.css'
import gridStyles from './LayoutPrimitives.module.css'

describe('Form', () => {
  test('is a native noValidate form and forwards its ref', () => {
    const ref = createRef<HTMLFormElement>()
    render(
      <Form ref={ref} noValidate={false} aria-label="Campaign form">
        <input name="name" />
      </Form>,
    )

    const form = screen.getByRole('form', { name: 'Campaign form' }) as HTMLFormElement
    assert.equal(ref.current, form)
    assert.equal(form.noValidate, true)
  })

  test('keeps one persistent polite region for form-engine error summaries', () => {
    const { rerender } = render(
      <Form aria-label="Campaign form" errorAnnouncement="2 fields need attention" errorAnnouncementRevision={0}>
        <input />
      </Form>,
    )
    const status = screen.getByRole('status')
    const firstContent = status.firstElementChild
    assert.equal(status.getAttribute('aria-live'), 'polite')
    assert.equal(status.getAttribute('aria-atomic'), 'true')
    assert.equal(status.textContent, '2 fields need attention')

    rerender(
      <Form aria-label="Campaign form" errorAnnouncement="2 fields need attention" errorAnnouncementRevision={1}>
        <input />
      </Form>,
    )
    assert.equal(screen.getByRole('status'), status)
    assert.notEqual(status.firstElementChild, firstContent)
    assert.equal(status.textContent, '2 fields need attention')

    rerender(
      <Form aria-label="Campaign form" errorAnnouncement="" errorAnnouncementRevision={1}>
        <input />
      </Form>,
    )
    assert.equal(status.textContent, '')
  })

  test('lets one native submit event reach the handler without synthesising an Enter submit', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    render(
      <Form onSubmit={onSubmit} aria-label="Native form">
        <input aria-label="Campaign name" />
        <button type="submit">Save</button>
      </Form>,
    )

    const input = screen.getByRole('textbox', { name: 'Campaign name' })
    fireEvent.keyDown(input, { key: 'Enter' })
    assert.equal(onSubmit.mock.calls.length, 0)

    fireEvent.submit(screen.getByRole('form', { name: 'Native form' }))
    assert.equal(onSubmit.mock.calls.length, 1)
  })

  test('groups a composite field with a legend and linked help and error text', () => {
    render(
      <FormField
        id="eligible-games"
        label="Eligible games"
        required
        help="Select one or more games."
        error="Choose at least one game."
        aria-describedby="campaign-context"
      >
        <span id="campaign-context">Applies to this campaign.</span>
        <label><input type="checkbox" /> Sports</label>
        <label><input type="checkbox" /> Casino</label>
      </FormField>,
    )

    const group = screen.getByRole('group', { name: 'Eligible games, required' })
    assert.equal(group.tagName, 'FIELDSET')
    assert.equal(group.id, 'eligible-games')
    assert.equal(group.hasAttribute('aria-required'), false)
    assert.equal(group.getAttribute('aria-invalid'), 'true')
    const ids = group.getAttribute('aria-describedby')?.split(' ') ?? []
    assert.deepEqual(ids, ['campaign-context', 'eligible-games-help', 'eligible-games-error'])
    for (const id of ids) assert.ok(document.getElementById(id), `missing description ${id}`)
    assert.equal(screen.getAllByRole('checkbox').length, 2)
    assert.equal(screen.getByRole('alert').textContent, 'Choose at least one game.')
  })

  test('retains a caller description for a composite field without unsupported group states', () => {
    render(
      <>
        <span id="schedule-context">All times use IST.</span>
        <FormField label="Schedule" aria-describedby="schedule-context">
          <input type="date" />
        </FormField>
      </>,
    )
    const group = screen.getByRole('group', { name: 'Schedule' })
    assert.equal(group.getAttribute('aria-describedby'), 'schedule-context')
    assert.equal(group.hasAttribute('aria-invalid'), false)
    assert.equal(group.hasAttribute('aria-required'), false)
  })

  test('groups fields with a fieldset, visible legend and the responsive kit grid', () => {
    render(
      <FormSection title="Eligibility" description="Choose who can receive this campaign.">
        <input aria-label="Minimum deposit" />
        <input aria-label="Maximum deposit" />
      </FormSection>,
    )

    const group = screen.getByRole('group', { name: 'Eligibility' })
    assert.equal(group.tagName, 'FIELDSET')
    assert.match(group.textContent ?? '', /Choose who can receive this campaign/)
    const grid = group.querySelector(`.${gridStyles.grid}`)
    assert.ok(grid)
    assert.ok(grid.classList.contains(gridStyles.base1))
    assert.ok(grid.classList.contains(gridStyles.md2))
  })

  test('renders the sticky responsive action surface without changing button semantics', () => {
    render(
      <FormActions data-testid="actions" className="caller-actions">
        <Button>Cancel</Button>
        <Button type="submit" variant="primary">Save campaign</Button>
      </FormActions>,
    )

    const actions = screen.getByTestId('actions')
    assert.ok(actions.classList.contains(formStyles.actions))
    assert.ok(actions.classList.contains('caller-actions'))
    assert.equal(screen.getByRole('button', { name: 'Cancel' }).getAttribute('type'), 'button')
    assert.equal(screen.getByRole('button', { name: 'Save campaign' }).getAttribute('type'), 'submit')
  })
})
