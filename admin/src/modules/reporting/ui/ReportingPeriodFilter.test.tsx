import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { FilterSheetContext } from '@/ui/components/filterSheetContext'
import { ReportingPeriodFilter } from './ReportingPeriodFilter'
import type { ReportingDatePreset } from '../reportingDateFilter'

type Change = [string, string, ReportingDatePreset]

/* 2026-10-06T18:30:00.000Z is midnight starting 7 Oct in IST; one millisecond earlier is still 6 Oct. */
const IST_7_OCT = '2026-10-06T18:30:00.000Z'
const IST_6_OCT_LAST_MS = '2026-10-06T18:29:59.999Z'

function at(instant: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(instant))
}

afterEach(() => {
  vi.useRealTimers()
})

function setup(props: Partial<ComponentProps<typeof ReportingPeriodFilter>> = {}) {
  const changes: Change[] = []
  const view = render(
    <ReportingPeriodFilter
      dateFrom="2000-01-01"
      dateTo="2026-10-07"
      preset="allTime"
      onChange={(from, to, preset) => changes.push([from, to, preset])}
      {...props}
    />,
  )
  return { changes, ...view }
}

const presets = () => screen.getByRole('group', { name: 'Period' })
const pressed = () =>
  within(presets())
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent)

async function openPanel(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
  return screen.findByRole('dialog', { name: 'Period' })
}

describe('ReportingPeriodFilter', () => {
  test('states the applied period on the pill and presses the matching preset, on kit controls only', () => {
    at(IST_7_OCT)
    const { container } = setup()
    const pill = screen.getByRole('button', { name: 'Period: All time' })
    assert.equal(pill.getAttribute('aria-haspopup'), 'dialog')
    assert.deepEqual(
      within(presets()).getAllByRole('button').map((button) => button.textContent),
      ['All time', 'Today', 'Yesterday'],
    )
    assert.deepEqual(pressed(), ['All time'])
    assert.equal(container.querySelector('[class^="ant-"], [class*=" ant-"]'), null)
    assert.equal(container.querySelector('select'), null)
  })

  test('a preset button applies its IST range at once, as the legacy select did', () => {
    at(IST_7_OCT)
    const { changes } = setup()
    fireEvent.click(within(presets()).getByRole('button', { name: 'Today' }))
    fireEvent.click(within(presets()).getByRole('button', { name: 'Yesterday' }))
    fireEvent.click(within(presets()).getByRole('button', { name: 'All time' }))
    assert.deepEqual(changes, [
      ['2026-10-07', '2026-10-07', 'today'],
      ['2026-10-06', '2026-10-06', 'yesterday'],
      ['2000-01-01', '2026-10-07', 'allTime'],
    ])
  })

  test('"today" is the IST day, one millisecond before IST midnight included', () => {
    at(IST_6_OCT_LAST_MS)
    const { changes } = setup()
    fireEvent.click(within(presets()).getByRole('button', { name: 'Today' }))
    fireEvent.click(within(presets()).getByRole('button', { name: 'Yesterday' }))
    assert.deepEqual(changes, [
      ['2026-10-06', '2026-10-06', 'today'],
      ['2026-10-05', '2026-10-05', 'yesterday'],
    ])
  })

  test('a controlled preset decides what is pressed, and a custom range presses nothing', () => {
    at(IST_7_OCT)
    const { rerender } = setup()
    fireEvent.click(within(presets()).getByRole('button', { name: 'Today' }))
    assert.deepEqual(pressed(), ['All time'], 'the owner has not applied it yet')

    rerender(
      <ReportingPeriodFilter dateFrom="2026-10-07" dateTo="2026-10-07" preset="today" onChange={() => {}} />,
    )
    assert.deepEqual(pressed(), ['Today'])
    assert.ok(screen.getByRole('button', { name: 'Period: 07 Oct 2026 – 07 Oct 2026' }))

    rerender(
      <ReportingPeriodFilter dateFrom="2026-09-07" dateTo="2026-10-07" preset="custom" onChange={() => {}} />,
    )
    assert.deepEqual(pressed(), [])
    assert.ok(screen.getByRole('button', { name: 'Period: 07 Sep 2026 – 07 Oct 2026' }))
  })

  test('without a preset prop it keeps its own, starting on All time', () => {
    at(IST_7_OCT)
    const { changes } = setup({ preset: undefined })
    assert.deepEqual(pressed(), ['All time'])
    fireEvent.click(within(presets()).getByRole('button', { name: 'Yesterday' }))
    assert.deepEqual(pressed(), ['Yesterday'])
    assert.deepEqual(changes, [['2026-10-06', '2026-10-06', 'yesterday']])
  })

  test('Custom opens on the last 30 days and applies the chosen days as they are', async () => {
    at(IST_7_OCT)
    const { changes } = setup()
    const pill = screen.getByRole('button', { name: 'Period: All time' })
    pill.focus()
    const dialog = await openPanel('Period: All time')

    assert.equal(within(dialog).getByRole('button', { name: 'All time' }).getAttribute('aria-pressed'), 'true')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Custom' }))
    const start = within(dialog).getByLabelText('Start date') as HTMLInputElement
    const end = within(dialog).getByLabelText('End date') as HTMLInputElement
    assert.equal(start.value, '2026-09-07')
    assert.equal(end.value, '2026-10-07')
    assert.deepEqual(changes, [], 'nothing applies until Apply')

    fireEvent.change(start, { target: { value: '2026-09-01' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))

    assert.deepEqual(changes, [['2026-09-01', '2026-10-07', 'custom']])
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    await waitFor(() => assert.equal(document.activeElement, pill))
  })

  test('an applied custom range seeds the panel, and an incomplete one cannot be applied', async () => {
    at(IST_7_OCT)
    const { changes } = setup({ preset: 'custom', dateFrom: '2026-08-01', dateTo: '2026-08-31' })
    const dialog = await openPanel('Period: 01 Aug 2026 – 31 Aug 2026')

    assert.equal(within(dialog).getByRole('button', { name: 'Custom' }).getAttribute('aria-pressed'), 'true')
    const end = within(dialog).getByLabelText('End date') as HTMLInputElement
    assert.equal((within(dialog).getByLabelText('Start date') as HTMLInputElement).value, '2026-08-01')
    assert.equal(end.value, '2026-08-31')

    fireEvent.change(end, { target: { value: '' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    assert.ok(within(dialog).getByText('Pick both dates'))
    assert.deepEqual(changes, [])
  })

  test('a preset chosen in the panel applies its range; Reset returns to All time', async () => {
    at(IST_7_OCT)
    const { changes } = setup({ preset: 'today', dateFrom: '2026-10-07', dateTo: '2026-10-07' })

    let dialog = await openPanel('Period: 07 Oct 2026 – 07 Oct 2026')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yesterday' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))

    dialog = await openPanel('Period: 07 Oct 2026 – 07 Oct 2026')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }))
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))

    assert.deepEqual(changes, [
      ['2026-10-06', '2026-10-06', 'yesterday'],
      ['2000-01-01', '2026-10-07', 'allTime'],
    ])
  })

  test('unusable days fall back to the preset name on the pill', () => {
    at(IST_7_OCT)
    setup({ preset: 'custom', dateFrom: '', dateTo: '' })
    assert.ok(screen.getByRole('button', { name: 'Period: Custom' }))
    assert.deepEqual(pressed(), [])
  })
})

describe('ReportingPeriodFilter in the Filters sheet', () => {
  function sheet(props: Partial<ComponentProps<typeof ReportingPeriodFilter>> = {}) {
    const changes: Change[] = []
    render(
      <FilterSheetContext.Provider value={true}>
        <ReportingPeriodFilter dateFrom="2000-01-01" dateTo="2026-10-07" preset="allTime"
          onChange={(from, to, preset) => changes.push([from, to, preset])} {...props} />
      </FilterSheetContext.Provider>,
    )
    return changes
  }
  const choices = () => within(screen.getByRole('group', { name: 'Period' }))

  test('shows All time, Today, Yesterday and Custom at once, with no second panel', () => {
    at(IST_7_OCT)
    const changes = sheet()
    assert.deepEqual(choices().getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')]),
      [['All time', 'true'], ['Today', 'false'], ['Yesterday', 'false'], ['Custom', 'false']])
    assert.equal(screen.queryByRole('button', { name: /^Period:/ }), null, 'no pill that opens a panel')
    assert.ok(screen.getByText('All time', { selector: 'b' }))
    fireEvent.click(choices().getByRole('button', { name: 'Yesterday' }))
    assert.deepEqual(changes, [['2026-10-06', '2026-10-06', 'yesterday']])
  })

  test('Custom opens its two dates and applies them only on Apply range; an incomplete range says why', () => {
    at(IST_7_OCT)
    const changes = sheet()
    fireEvent.click(choices().getByRole('button', { name: 'Custom' }))
    assert.deepEqual(changes, [], 'choosing Custom applies nothing yet')
    const start = screen.getByLabelText('Start date') as HTMLInputElement
    assert.equal(start.value, '2026-09-07')
    fireEvent.change(start, { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply range' }))
    assert.deepEqual(changes, [['2026-10-01', '2026-10-07', 'custom']])
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '' } })
    assert.ok(screen.getByText('Pick both dates'))
    assert.equal(screen.getByRole('button', { name: 'Apply range' }).getAttribute('aria-disabled'), 'true')
  })

  test('an applied custom range opens on Custom with its dates, marked applied', () => {
    sheet({ preset: 'custom', dateFrom: '2026-10-01', dateTo: '2026-10-05' })
    assert.equal(choices().getByRole('button', { name: 'Custom' }).getAttribute('aria-pressed'), 'true')
    assert.equal((screen.getByLabelText('Start date') as HTMLInputElement).value, '2026-10-01')
    assert.ok(screen.getByRole('button', { name: 'Range applied' }))
  })
})
