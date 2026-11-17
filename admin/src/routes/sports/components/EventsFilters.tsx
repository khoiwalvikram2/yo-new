import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { IconCalendar, IconCricket, IconFilter, IconPlayerRecordFilled, IconRestore } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { Combobox } from '@/ui/components/Combobox'
import { DateTimeField } from '@/ui/components/DateTimeField'
import { Form, FormField } from '@/ui/components/Form'
import { strokeFor } from '@/ui/components/icons'
import {
  EMPTY_STAGED_FILTERS,
  EVENT_FILTER_PRESETS,
  EVENT_SPORT_OPTIONS,
  EVENT_STATUS_OPTIONS,
  eventFilterPreset,
  filtersFromStaged,
  stagedFromFilters,
  stagedRangeErrors,
  type EventFilterPreset,
  type EventOption,
  type EventsFiltersValues,
  type StagedEventFilters,
  type StagedRangeErrors,
} from '../eventsPageModel'
import styles from '../EventsPage.module.css'

export type { EventsFiltersValues }

interface EventsFiltersProps {
  onFilter: (values: EventsFiltersValues) => void
  loading?: boolean
  /** The filters in force: the form opens on them. */
  initialValues?: EventsFiltersValues
  /** The competitions to choose from: those of the loaded events (eventCompetitionOptions). */
  competitionOptions?: readonly EventOption[]
}

/* The presets' glyphs replace the legacy emoji (a red circle, a calendar, a cricket bat). */
const PRESET_ICONS: Record<EventFilterPreset, ReactNode> = {
  'live-now': <IconPlayerRecordFilled size={14} className={styles.presetLive} />,
  'next-24h': <IconCalendar size={14} stroke={strokeFor(14)} />,
  'cricket-only': <IconCricket size={14} stroke={strokeFor(14)} />,
}

/**
 * The Advanced Filters form. Nothing applies until Apply (or a preset, or Reset), as before: Apply sends
 * every field, Reset clears the form and every filter, and a preset applies its one filter on its own.
 */
export function EventsFilters({ onFilter, loading = false, initialValues, competitionOptions = [] }: EventsFiltersProps) {
  const [staged, setStaged] = useState<StagedEventFilters>(() => stagedFromFilters(initialValues))
  // A chosen competition stays on offer even once no loaded event belongs to it, so the field still names it.
  const competitions = staged.competition && !competitionOptions.some((option) => option.value === staged.competition)
    ? [...competitionOptions, { label: staged.competition, value: staged.competition }]
    : competitionOptions
  const [errors, setErrors] = useState<StagedRangeErrors>({})
  const startRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLInputElement>(null)

  const update = (patch: Partial<StagedEventFilters>) => setStaged((current) => ({ ...current, ...patch }))

  // A date edit clears the range's messages; Apply checks the range again.
  const updateRange = (patch: Pick<Partial<StagedEventFilters>, 'start' | 'end'>) => {
    update(patch)
    setErrors({})
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const rangeErrors = stagedRangeErrors(staged)
    if (rangeErrors.start || rangeErrors.end) {
      setErrors(rangeErrors)
      ;(rangeErrors.start ? startRef : endRef).current?.focus()
      return
    }
    onFilter(filtersFromStaged(staged))
  }

  const handleReset = () => {
    setStaged(EMPTY_STAGED_FILTERS)
    setErrors({})
    onFilter({})
  }

  const handlePreset = (preset: EventFilterPreset) => {
    const { applied, staged: next } = eventFilterPreset(preset, Date.now())
    setStaged(next)
    setErrors({})
    onFilter(applied)
  }

  return (
    <Form onSubmit={handleSubmit}>
      <div className={styles.filterFrame}>
        <div className={styles.filterGrid}>
          <Combobox
            label="Sport Type"
            size="sm"
            searchable={false}
            clearable
            placeholder="Select sport..."
            options={EVENT_SPORT_OPTIONS}
            value={staged.sport}
            onChange={(value) => update({ sport: value })}
          />
          <Combobox
            label="Event Status"
            size="sm"
            searchable={false}
            clearable
            placeholder="Select status..."
            options={EVENT_STATUS_OPTIONS}
            value={staged.status}
            onChange={(value) => update({ status: value })}
          />
          <FormField label="Date Range" className={styles.rangeField}>
            <div className={styles.rangeFields}>
              <DateTimeField
                ref={startRef}
                label="Start date"
                size="sm"
                value={staged.start}
                onChange={(value) => updateRange({ start: value })}
                error={errors.start}
              />
              <DateTimeField
                ref={endRef}
                label="End date"
                size="sm"
                value={staged.end}
                onChange={(value) => updateRange({ end: value })}
                error={errors.end}
              />
            </div>
          </FormField>
          <Combobox
            label="Competition"
            size="sm"
            searchable={false}
            clearable
            placeholder="Select competition..."
            options={competitions}
            value={staged.competition}
            onChange={(value) => update({ competition: value })}
          />
        </div>
      </div>

      <div className={styles.filterFoot}>
        <div className={styles.presets} role="group" aria-label="Quick presets">
          {EVENT_FILTER_PRESETS.map((preset) => (
            <Button
              key={preset.value}
              size="sm"
              variant="ghost"
              icon={PRESET_ICONS[preset.value]}
              onClick={() => handlePreset(preset.value)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div className={styles.filterActions}>
          <Button size="sm" icon={<IconRestore size={15} stroke={strokeFor(15)} />} onClick={handleReset}>
            Reset
          </Button>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            icon={<IconFilter size={15} stroke={strokeFor(15)} />}
            loading={loading}
          >
            Apply
          </Button>
        </div>
      </div>
    </Form>
  )
}

