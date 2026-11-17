/**
 * The Advanced Filters form on its own: nothing applies before Apply; Apply sends every field (the range as
 * IST instants); Reset clears the form and sends {}; each preset applies its one filter alone and stages
 * just that; the form opens on the filters in force; a half or reversed range is refused with a message.
 */
import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { EventsFiltersValues } from '../eventsPageModel'
import { EventsFilters } from './EventsFilters'

// The competitions of the loaded events, as the page passes them (eventCompetitionOptions).
const COMPETITIONS = [
  { label: 'Nepal Premier League', value: 'Nepal Premier League' },
  { label: 'Wimbledon', value: 'Wimbledon' },
]

function setup(props: { initialValues?: EventsFiltersValues; loading?: boolean } = {}) {
  const onFilter = vi.fn<(values: EventsFiltersValues) => void>()
  render(<EventsFilters onFilter={onFilter} competitionOptions={COMPETITIONS} {...props} />)
  return onFilter
}

function field(name: string) {
  return screen.getByRole('combobox', { name }) as HTMLInputElement
}

function dateField(name: string) {
  return screen.getByLabelText(name) as HTMLInputElement
}

function choose(fieldName: string, optionName: string) {
  fireEvent.keyDown(field(fieldName), { key: 'ArrowDown' })
  fireEvent.click(within(screen.getByRole('listbox', { name: fieldName })).getByRole('option', { name: optionName }))
}

function lastCall(onFilter: ReturnType<typeof setup>) {
  const calls = onFilter.mock.calls
  return calls[calls.length - 1]?.[0]
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('EventsFilters', () => {
  test('shows the four legacy fields with their placeholders and options, and applies nothing on its own', () => {
    const onFilter = setup()
    assert.equal(field('Sport Type').getAttribute('placeholder'), 'Select sport...')
    assert.equal(field('Event Status').getAttribute('placeholder'), 'Select status...')
    assert.equal(field('Competition').getAttribute('placeholder'), 'Select competition...')
    assert.equal(dateField('Start date').type, 'datetime-local')
    assert.equal(dateField('End date').type, 'datetime-local')
    assert.ok(screen.getByRole('group', { name: 'Date Range' }))

    fireEvent.keyDown(field('Event Status'), { key: 'ArrowDown' })
    assert.deepEqual(
      within(screen.getByRole('listbox', { name: 'Event Status' })).getAllByRole('option').map((o) => o.textContent),
      ['In-Play', 'Upcoming', 'Finished'],
    )
    fireEvent.keyDown(field('Event Status'), { key: 'Escape' })
    fireEvent.keyDown(field('Competition'), { key: 'ArrowDown' })
    assert.deepEqual(
      within(screen.getByRole('listbox', { name: 'Competition' })).getAllByRole('option').map((o) => o.textContent),
      ['Nepal Premier League', 'Wimbledon'],
    )
    fireEvent.keyDown(field('Competition'), { key: 'Escape' })

    choose('Sport Type', 'Tennis')
    assert.equal(onFilter.mock.calls.length, 0, 'a staged choice is not applied')
    assert.deepEqual(
      within(screen.getByRole('group', { name: 'Quick presets' })).getAllByRole('button').map((b) => b.textContent),
      ['Live Now', 'Next 24h', 'Cricket Only'],
    )
  })

  test('Apply sends every field, an empty one as undefined, the range as IST instants', () => {
    const onFilter = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    assert.equal(onFilter.mock.calls.length, 1)
    assert.deepEqual(Object.keys(lastCall(onFilter) ?? {}), ['sport', 'status', 'timeRange', 'competition'])
    assert.deepEqual(lastCall(onFilter), { sport: undefined, status: undefined, timeRange: undefined, competition: undefined })

    choose('Sport Type', 'Football')
    choose('Event Status', 'Upcoming')
    choose('Competition', 'Nepal Premier League')
    fireEvent.change(dateField('Start date'), { target: { value: '2026-10-07T17:30' } })
    fireEvent.change(dateField('End date'), { target: { value: '2026-10-08T09:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    const applied = lastCall(onFilter)
    assert.equal(applied?.sport, 'Football')
    assert.equal(applied?.status, 'upcoming')
    assert.equal(applied?.competition, 'Nepal Premier League')
    assert.deepEqual(applied?.timeRange?.map((d) => d.toISOString()), ['2026-10-07T12:00:00.000Z', '2026-10-08T03:30:00.000Z'])

    // clearing a field sends it as undefined again
    fireEvent.click(screen.getByRole('button', { name: 'Clear Sport Type' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    assert.equal(lastCall(onFilter)?.sport, undefined)
  })

  test('Reset empties the form and applies no filter', () => {
    const onFilter = setup()
    choose('Sport Type', 'Cricket')
    fireEvent.change(dateField('Start date'), { target: { value: '2026-10-07T17:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    assert.deepEqual(lastCall(onFilter), {})
    assert.equal(field('Sport Type').value, '')
    assert.equal(dateField('Start date').value, '')
  })

  test('each preset applies its one filter alone and the form shows just that filter', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-07T12:00:45.000Z'))
    const onFilter = setup()
    choose('Sport Type', 'Tennis')
    choose('Competition', 'Wimbledon')

    fireEvent.click(screen.getByRole('button', { name: 'Live Now' }))
    assert.deepEqual(lastCall(onFilter), { status: 'inplay' })
    assert.equal(field('Event Status').value, 'In-Play')
    assert.equal(field('Sport Type').value, '', 'the dropped sport no longer shows')
    assert.equal(field('Competition').value, '')

    fireEvent.click(screen.getByRole('button', { name: 'Next 24h' }))
    const next = lastCall(onFilter)
    assert.deepEqual(Object.keys(next ?? {}), ['timeRange'])
    assert.deepEqual(next?.timeRange?.map((d) => d.toISOString()), ['2026-10-07T12:00:45.000Z', '2026-10-08T12:00:45.000Z'])
    assert.equal(dateField('Start date').value, '2026-10-07T17:30')
    assert.equal(dateField('End date').value, '2026-10-08T17:30')
    assert.equal(field('Event Status').value, '')

    fireEvent.click(screen.getByRole('button', { name: 'Cricket Only' }))
    assert.deepEqual(lastCall(onFilter), { sport: 'Cricket' })
    assert.equal(field('Sport Type').value, 'Cricket')
    assert.equal(dateField('Start date').value, '')
  })

  test('opens on the filters in force', () => {
    setup({
      initialValues: {
        sport: 'Basketball',
        status: 'finished',
        competition: 'NBA',
        timeRange: [new Date('2026-10-07T18:45:00.000Z'), new Date('2026-10-08T18:45:00.000Z')],
      },
    })
    assert.equal(field('Sport Type').value, 'Basketball')
    assert.equal(field('Event Status').value, 'Finished')
    // A competition no loaded event belongs to any longer is still named, not dropped.
    assert.equal(field('Competition').value, 'NBA')
    assert.equal(dateField('Start date').value, '2026-10-08T00:15')
    assert.equal(dateField('End date').value, '2026-10-09T00:15')
  })

  test('a half or reversed range is refused with a message on the field, which takes focus', () => {
    const onFilter = setup()
    fireEvent.change(dateField('Start date'), { target: { value: '2026-10-07T17:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    assert.equal(onFilter.mock.calls.length, 0)
    assert.equal(screen.getByRole('alert').textContent, 'Choose an end date')
    assert.equal(dateField('End date').getAttribute('aria-invalid'), 'true')
    assert.equal(document.activeElement, dateField('End date'))

    fireEvent.change(dateField('End date'), { target: { value: '2026-10-07T10:00' } })
    assert.equal(screen.queryByRole('alert'), null, 'an edit clears the message')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    assert.equal(onFilter.mock.calls.length, 0)
    assert.equal(screen.getByRole('alert').textContent, 'The end date is before the start date')

    fireEvent.change(dateField('Start date'), { target: { value: '' } })
    fireEvent.change(dateField('End date'), { target: { value: '2026-10-07T10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    assert.equal(screen.getByRole('alert').textContent, 'Choose a start date')
    assert.equal(document.activeElement, dateField('Start date'))
  })

  test('Apply shows the query in flight', () => {
    setup({ loading: true })
    assert.equal(screen.getByRole('button', { name: 'Apply' }).getAttribute('aria-busy'), 'true')
  })
})
