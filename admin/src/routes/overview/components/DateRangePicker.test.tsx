/**
 * The shared period picker has two hosts with opposite needs. AgentHome places it on the page, so its
 * default layout keeps its own trigger: a row that opens an antd popover below 640px, an inline Select
 * above it. /overview opens it from the kit Popover behind the period pill, where that trigger would be a
 * surface inside a surface, so it asks for layout="panel": the presets at every width, with the staged one
 * announced by aria-pressed, and onDone after Apply and Reset so the host can close and hand focus back to
 * the pill. In the panel Apply stays disabled until Custom holds a whole range in order, so it can never
 * close the popover having applied nothing. The picker picks its layout from window.innerWidth at mount, so
 * each test sets the width first.
 */
import { test, describe, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react'
import { Popover } from '@/ui/components/Popover'
import { useDashboardStore } from '@/state/dashboardStore'
import { DashboardDateRangePicker } from './DateRangePicker'

const EXECUTIVE_CHIPS = ['Today', 'Yesterday', '7D', '30D', 'This Month', 'Last Month', 'Custom']

const innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

function chipNames(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('button[aria-pressed]'), (b) => b.textContent ?? '')
}

function pressedChips(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('button[aria-pressed="true"]'), (b) => b.textContent ?? '')
}

beforeEach(() => {
  useDashboardStore.getState().resetFilters()
})

afterEach(() => {
  if (innerWidthDescriptor) Object.defineProperty(window, 'innerWidth', innerWidthDescriptor)
})

describe('DateRangePicker default layout (AgentHome)', () => {
  test('at 375px it renders one "Period" button and no preset chips until that button is used', () => {
    setViewportWidth(375)
    const { container } = render(<DashboardDateRangePicker />)

    const buttons = screen.getAllByRole('button')
    assert.equal(buttons.length, 1)
    assert.match(buttons[0].textContent ?? '', /^Period/)
    for (const name of EXECUTIVE_CHIPS.filter((n) => n !== 'Today')) {
      assert.equal(screen.queryByRole('button', { name }), null, `no ${name} chip on the page`)
    }
    assert.equal(screen.queryByRole('combobox'), null)
    assert.equal(container.querySelector('[aria-pressed]'), null)
  })

  test('at 375px the staged agent presets are accessible pressed buttons', async () => {
    setViewportWidth(375)
    render(
      <DashboardDateRangePicker
        mode="controlled"
        presetVariant="agent"
        appliedPreset="today"
        dateFrom="2026-09-21T18:30:00.000Z"
        dateTo="2026-09-22T18:29:59.999Z"
        onApply={() => {}}
        onReset={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Period/ }))

    const chip = await screen.findByRole('button', { name: 'Yesterday' })
    const grid = chip.parentElement as HTMLElement
    assert.ok(grid.querySelectorAll('button').length > 1)
    assert.equal(chip.getAttribute('aria-pressed'), 'false')
    fireEvent.click(chip)
    assert.equal(chip.getAttribute('aria-pressed'), 'true')
  })

  test('at 1024px it renders the inline preset combobox', () => {
    setViewportWidth(1024)
    render(<DashboardDateRangePicker />)

    assert.ok(screen.getByRole('combobox'))
    assert.equal(screen.queryByRole('button', { name: 'This Month' }), null)
  })
})

describe('DateRangePicker layout="panel"', () => {
  for (const width of [375, 1280]) {
    test(`at ${width}px it renders the seven presets in place, Today pressed`, () => {
      setViewportWidth(width)
      const { container } = render(<DashboardDateRangePicker layout="panel" />)

      assert.deepEqual(chipNames(container), EXECUTIVE_CHIPS)
      assert.deepEqual(pressedChips(container), ['Today'])
      assert.equal(screen.queryByRole('button', { name: /Period/ }), null, 'no trigger of its own')
      assert.equal(screen.queryByRole('combobox'), null)
    })
  }

  test('This Month then Apply writes thisMonth to the store and calls onDone once', () => {
    setViewportWidth(375)
    const onDone = vi.fn()
    const { container } = render(<DashboardDateRangePicker layout="panel" onDone={onDone} />)

    fireEvent.click(screen.getByRole('button', { name: 'This Month' }))

    assert.deepEqual(pressedChips(container), ['This Month'])
    assert.equal(useDashboardStore.getState().filters.dateRange.preset, 'today', 'staged, not applied')
    assert.equal(onDone.mock.calls.length, 0)

    fireEvent.click(screen.getByRole('button', { name: /Apply/ }))

    assert.equal(useDashboardStore.getState().filters.dateRange.preset, 'thisMonth')
    assert.equal(onDone.mock.calls.length, 1)
  })

  test('7D then Reset puts the store back on today and calls onDone once', () => {
    setViewportWidth(1280)
    useDashboardStore.getState().setDateRangePreset('lastMonth')
    const onDone = vi.fn()
    const { container } = render(<DashboardDateRangePicker layout="panel" onDone={onDone} />)
    assert.deepEqual(pressedChips(container), ['Last Month'])

    fireEvent.click(screen.getByRole('button', { name: '7D' }))
    fireEvent.click(screen.getByRole('button', { name: /Reset/ }))

    assert.equal(useDashboardStore.getState().filters.dateRange.preset, 'today')
    assert.equal(onDone.mock.calls.length, 1)
    assert.deepEqual(pressedChips(container), ['Today'])
  })
})

describe('DateRangePicker inside the kit Popover, as /overview composes it', () => {
  for (const width of [375, 1280]) {
    test(`at ${width}px the Period dialog holds the presets directly, and Apply closes it and returns focus to the pill`, async () => {
      setViewportWidth(width)
      render(
        <Popover label="Period" trigger={<button type="button">Applied range</button>}>
          {({ close }) => <DashboardDateRangePicker layout="panel" onDone={close} />}
        </Popover>,
      )
      const trigger = screen.getByRole('button', { name: 'Applied range' })
      act(() => {
        trigger.focus()
      })

      fireEvent.click(trigger)

      const dialog = await screen.findByRole('dialog', { name: 'Period' })
      assert.equal(within(dialog).queryByRole('button', { name: /Period/ }), null, 'no nested Period trigger')
      assert.equal(within(dialog).queryByRole('combobox'), null, 'no nested listbox')
      assert.deepEqual(chipNames(dialog), EXECUTIVE_CHIPS)

      fireEvent.click(within(dialog).getByRole('button', { name: 'This Month' }))
      fireEvent.click(within(dialog).getByRole('button', { name: /Apply/ }))

      assert.equal(useDashboardStore.getState().filters.dateRange.preset, 'thisMonth')
      await waitFor(() => assert.equal(Boolean(screen.queryByRole('dialog')), false))
      await waitFor(() => assert.equal(document.activeElement, trigger))
    })
  }
})

describe('DateRangePicker layout="panel": Apply acts only on a whole custom range', () => {
  beforeEach(() => {
    // only Date: antd's motion and floating-ui still need real timers
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-22T10:00:00+05:30'))
    useDashboardStore.getState().resetFilters()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function pickDay(input: HTMLElement, isoDay: string): Promise<void> {
    await act(async () => fireEvent.change(input, { target: { value: isoDay } }))
  }

  test('a cleared date leaves Apply disabled and the popover open; a whole range applies and calls onDone once', async () => {
    setViewportWidth(1280)
    const onDone = vi.fn()
    render(
      <Popover label="Period" trigger={<button type="button">Applied range</button>}>
        {({ close }) => (
          <DashboardDateRangePicker
            layout="panel"
            onDone={() => {
              onDone()
              close()
            }}
          />
        )}
      </Popover>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Applied range' }))
    const dialog = await screen.findByRole('dialog', { name: 'Period' })
    const stored = useDashboardStore.getState().filters.dateRange
    assert.equal(stored.preset, 'today')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Custom' }))
    const start = within(dialog).getByPlaceholderText('Start date') as HTMLInputElement
    const end = within(dialog).getByPlaceholderText('End date') as HTMLInputElement
    const apply = () => within(dialog).getByRole('button', { name: /Apply/ }) as HTMLButtonElement
    assert.notEqual(end.value, '', 'Custom starts from the applied range')
    assert.equal(apply().disabled, false)

    fireEvent.change(end, { target: { value: '' } })

    // the field shows what Apply would act on: no End date, not the stored one
    assert.equal(end.value, '')
    assert.notEqual(start.value, '')
    assert.equal(apply().disabled, true)
    fireEvent.click(apply())
    assert.deepEqual(useDashboardStore.getState().filters.dateRange, stored, 'nothing applied')
    assert.equal(onDone.mock.calls.length, 0)
    assert.ok(screen.getByRole('dialog', { name: 'Period' }), 'the popover stays open')

    // an End before the Start is not a range either (the store would drop it to Today)
    await pickDay(end, '2026-09-20')
    await waitFor(() => assert.equal(end.value, '2026-09-20'))
    assert.equal(apply().disabled, true)

    await pickDay(end, '2026-09-24')
    await waitFor(() => assert.equal(end.value, '2026-09-24'))
    assert.equal(apply().disabled, false)
    fireEvent.click(apply())

    const applied = useDashboardStore.getState().filters.dateRange
    assert.equal(applied.preset, 'custom')
    assert.equal(applied.dateFrom, stored.dateFrom, 'the Start the field showed')
    assert.ok(applied.dateTo > applied.dateFrom)
    assert.match(applied.dateTo, /T18:29:59\.999Z$/, 'the End is the close of an IST day')
    assert.equal(onDone.mock.calls.length, 1)
    await waitFor(() => assert.equal(Boolean(screen.queryByRole('dialog')), false))
  })
})
