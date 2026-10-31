import { useEffect, useState } from 'react'
import { Alert, Button, Card, Checkbox, Form, Select, Space, Tag, TimePicker, Typography, App } from 'antd'
import { useMutation, useQuery } from '@apollo/client'
import dayjs, { type Dayjs } from 'dayjs'
import { DESK_CALENDAR, SET_DESK_CALENDAR } from '@/lib/gql'
import { useAuth, can } from '@/state/auth'

/**
 * When the desk works.
 *
 * Presented as a settings screen but it is really an SLA control: every task's
 * deadline is computed against these hours and the escalation ladder does not
 * advance outside them. The summary line above the form exists because four
 * separate fields do not read as "we are shut on Sundays" until someone joins
 * them up.
 */

type DeskCalendar = {
  timezone: string
  openMinute: number
  closeMinute: number
  days: number[]
  isOpenNow: boolean
}

const DAY_NAMES: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
]

/**
 * Zones offered in the picker.
 *
 * `Intl.supportedValuesOf` where the browser has it, which is the honest list —
 * the server accepts anything this runtime recognises. The fallback is the
 * handful of zones this platform's whitelabels actually operate in, so an older
 * browser gets a working control rather than an empty one.
 */
function timezoneOptions(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (k: string) => string[] }
  try {
    const all = intl.supportedValuesOf?.('timeZone')
    if (all && all.length > 0) return all
  } catch {
    // Falls through to the short list below.
  }
  return [
    'Asia/Kolkata',
    'Asia/Dubai',
    'Asia/Colombo',
    'Asia/Kathmandu',
    'Asia/Dhaka',
    'Asia/Karachi',
    'Asia/Singapore',
    'Europe/London',
    'Europe/Malta',
    'UTC',
  ]
}

/**
 * 09:00 from 540, for a control that thinks in clock time.
 *
 * Built by setting the clock fields, not by adding minutes to midnight. Adding
 * elapsed minutes is wrong on the *viewer's* own DST transition day: in a zone
 * that springs forward at 01:00, midnight plus 540 minutes is 10:00, not 09:00,
 * so the picker showed an hour that was never stored — and pressing Save
 * without touching anything wrote that shifted hour back to the server. These
 * are wall-clock minutes on the desk's calendar; the browser's zone must not
 * enter into it.
 *
 * A fixed reference date keeps this stable regardless of what today happens to
 * be in the viewer's zone.
 */
const CLOCK_BASE = '2000-01-01'
const toClock = (minute: number): Dayjs =>
  dayjs(CLOCK_BASE).hour(Math.floor(minute / 60) % 24).minute(minute % 60).second(0).millisecond(0)
const toMinute = (d: Dayjs): number => d.hour() * 60 + d.minute()

/** "Mon–Sat" where the days run together, "Mon, Wed, Fri" where they do not. */
function describeDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b)
  if (sorted.length === 0) return 'no days'
  if (sorted.length === 7) return 'every day'
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1)
  const name = (d: number) => DAY_NAMES.find((x) => x.value === d)?.label ?? String(d)
  return contiguous && sorted.length > 2
    ? `${name(sorted[0])}–${name(sorted[sorted.length - 1])}`
    : sorted.map(name).join(', ')
}

/** 1260 reads as 21:00; 1440 is midnight, which `toClock` would render as 00:00. */
function describeMinute(minute: number): string {
  if (minute >= 1440) return '24:00'
  return toClock(minute).format('HH:mm')
}

export function DeskSettingsPage() {
  const me = useAuth((s) => s.me)
  const mayManage = can(me, 'crm.settings', 'manage')
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [error, setError] = useState<string | null>(null)

  const { data, loading, refetch } = useQuery<{ crmDeskCalendar: DeskCalendar }>(DESK_CALENDAR)
  const [save, { loading: saving }] = useMutation(SET_DESK_CALENDAR)

  const calendar = data?.crmDeskCalendar

  useEffect(() => {
    if (!calendar) return
    form.setFieldsValue({
      timezone: calendar.timezone,
      open: toClock(calendar.openMinute),
      close: toClock(calendar.closeMinute),
      days: calendar.days,
    })
  }, [calendar, form])

  const onFinish = async (values: { timezone: string; open: Dayjs; close: Dayjs; days: number[] }) => {
    setError(null)
    const { data: res } = await save({
      variables: {
        timezone: values.timezone,
        openMinute: toMinute(values.open),
        // Midnight is the end of the day, not the start of it. Without this a
        // desk that runs until 00:00 would be stored as closing at minute zero,
        // which is a desk that is never open.
        closeMinute: toMinute(values.close) === 0 ? 1440 : toMinute(values.close),
        days: values.days,
      },
    })
    if (!res?.crmSetDeskCalendar?.ok) {
      setError(res?.crmSetDeskCalendar?.error ?? 'Could not save the desk calendar')
      return
    }
    message.success('Desk calendar saved')
    await refetch()
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Desk settings
        </Typography.Title>
        <Typography.Text className="crm-muted">
          The hours your desk works. Every task deadline is measured against them.
        </Typography.Text>
      </div>

      {calendar && (
        <Alert
          type={calendar.isOpenNow ? 'success' : 'info'}
          showIcon
          message={
            <span>
              Open <strong>{describeDays(calendar.days)}</strong>,{' '}
              <strong>
                {describeMinute(calendar.openMinute)}–{describeMinute(calendar.closeMinute)}
              </strong>{' '}
              ({calendar.timezone}) —{' '}
              <Tag color={calendar.isOpenNow ? 'green' : 'default'} style={{ marginInlineEnd: 0 }}>
                {calendar.isOpenNow ? 'open now' : 'closed now'}
              </Tag>
            </span>
          }
          description="A task raised outside these hours is not counted late for the time nobody was working, and the escalation ladder does not climb while the desk is shut."
        />
      )}

      <Card size="small" loading={loading}>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
        {!mayManage && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="You can see the desk calendar but not change it."
            description="Changing it needs the “Change desk settings” permission."
          />
        )}
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          disabled={!mayManage || saving}
          requiredMark={false}
          style={{ maxWidth: 520 }}
        >
          <Form.Item
            name="timezone"
            label="Time zone"
            rules={[{ required: true, message: 'Choose the zone your desk works in' }]}
            extra="The zone the desk works in, not the one you are reading this from."
          >
            <Select
              showSearch
              options={timezoneOptions().map((z) => ({ value: z, label: z }))}
              filterOption={(input, option) =>
                String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>

          <Space size={16} align="start" wrap>
            <Form.Item name="open" label="Opens" rules={[{ required: true }]}>
              <TimePicker format="HH:mm" minuteStep={15} needConfirm={false} allowClear={false} />
            </Form.Item>
            <Form.Item
              name="close"
              label="Closes"
              rules={[{ required: true }]}
              extra="Use 00:00 for a desk that runs to midnight."
            >
              <TimePicker format="HH:mm" minuteStep={15} needConfirm={false} allowClear={false} />
            </Form.Item>
          </Space>

          <Form.Item
            name="days"
            label="Working days"
            rules={[{ required: true, message: 'Choose at least one working day' }]}
          >
            <Checkbox.Group options={DAY_NAMES} />
          </Form.Item>

          {mayManage && (
            <Button type="primary" htmlType="submit" loading={saving}>
              Save desk calendar
            </Button>
          )}
        </Form>
      </Card>
    </Space>
  )
}
