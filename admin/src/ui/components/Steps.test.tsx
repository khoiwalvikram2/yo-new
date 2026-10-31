import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { Steps, type StepItem } from './Steps'
import styles from './Steps.module.css'

const STEPS: StepItem[] = [
  { title: 'Basic Info', description: 'Name & schedule' },
  { title: 'Betting', description: 'Limits and rates' },
  { title: 'Review' },
]

function items() {
  return within(screen.getByRole('navigation', { name: 'Form steps' })).getAllByRole('listitem')
}

describe('Steps', () => {
  test('renders an ordered list in a named landmark with the current step marked', () => {
    render(<Steps label="Form steps" steps={STEPS} current={1} />)
    const list = screen.getByRole('list')
    assert.equal(list.tagName, 'OL')
    const [first, second, third] = items()
    assert.equal(second.getAttribute('aria-current'), 'step')
    assert.equal(first.getAttribute('aria-current'), null)
    assert.equal(second.textContent, '2BettingLimits and rates')
    assert.ok(third.textContent?.startsWith('3Review'))
  })

  test('derives done and upcoming from the current index; done steps say so and show a check', () => {
    render(<Steps label="Form steps" steps={STEPS} current={1} />)
    const [first, second, third] = items()
    assert.ok(first.classList.contains(styles.done))
    assert.ok(second.classList.contains(styles.current))
    assert.ok(third.classList.contains(styles.upcoming))
    assert.ok(first.querySelector('svg.tabler-icon-check'))
    assert.ok(within(first).getByText(', completed'))
    assert.equal(first.querySelector(`.${styles.marker}`)?.getAttribute('aria-hidden'), 'true')
  })

  test('a step can be flagged as an error while the current step keeps aria-current', () => {
    render(<Steps label="Form steps" steps={[{ ...STEPS[0], state: 'error' }, STEPS[1], STEPS[2]]} current={1} />)
    const [first, second] = items()
    assert.ok(first.classList.contains(styles.error))
    assert.ok(within(first).getByText(', has errors'))
    assert.equal(first.textContent?.startsWith('1'), true)
    assert.equal(second.getAttribute('aria-current'), 'step')
  })

  test('without onSelect no step is interactive', () => {
    render(<Steps label="Form steps" steps={STEPS} current={2} />)
    assert.equal(screen.queryByRole('button'), null)
  })

  test('onSelect turns only completed steps into buttons that jump back', () => {
    const onSelect = vi.fn()
    render(<Steps label="Form steps" steps={STEPS} current={2} onSelect={onSelect} />)
    const buttons = screen.getAllByRole('button')
    assert.equal(buttons.length, 2)
    const back = screen.getByRole('button', { name: 'Basic Info , completed' })
    assert.equal(back.getAttribute('aria-describedby') !== null, true)
    fireEvent.click(back)
    assert.deepStrictEqual(onSelect.mock.calls, [[0]])
    assert.equal(within(items()[2]).queryByRole('button'), null)
  })
})
