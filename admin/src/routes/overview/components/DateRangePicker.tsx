import { useState, useEffect } from 'react'
import { IconCalendar, IconCheck, IconRefresh } from '@tabler/icons-react'
import { Select } from '@/ui/components/Select'
import { DateField } from '@/ui/components/DateField'
import { Button } from '@/ui/components/Button'
import { Popover } from '@/ui/components/Popover'
import { isDayString, istDayOf, istDayStart, istDayEnd } from '@/ui/components/istDate'
import { useDashboardStore, type DateRangePreset } from '@/state/dashboardStore'
import {
  AGENT_DASHBOARD_PERIOD_PRESETS,
  type AgentDashboardDatePreset,
  type AgentDashboardDateRangeApplyPayload,
} from '@/shared/utils/agentDashboardDateRange'
import styles from './DateRangePicker.module.css'

export type DashboardDateRangeApplyPayload =
  | { kind: 'preset'; preset: Exclude<DateRangePreset, 'custom'> }
  | { kind: 'custom'; dateFrom: string; dateTo: string };

export type { AgentDashboardDatePreset, AgentDashboardDateRangeApplyPayload };

const EXECUTIVE_PERIOD_PRESETS: Array<{ label: string; value: DateRangePreset }> = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: '7D', value: 'last7days' },
  { label: '30D', value: 'last30days' },
  { label: 'This Month', value: 'thisMonth' },
  { label: 'Last Month', value: 'lastMonth' },
  { label: 'Custom', value: 'custom' },
];

type ExecutivePeriodCoreProps = {
  variant?: 'executive';
  appliedPreset: DateRangePreset;
  dateFrom?: string;
  dateTo?: string;
  onApply: (payload: DashboardDateRangeApplyPayload) => void;
  onReset: () => void;
};

type AgentPeriodCoreProps = {
  variant: 'agent';
  appliedPreset: AgentDashboardDatePreset;
  dateFrom?: string;
  dateTo?: string;
  onApply: (payload: AgentDashboardDateRangeApplyPayload) => void;
  onReset: () => void;
};


type PeriodPickerLayoutProps = { layout?: 'responsive' | 'panel'; onDone?: () => void }
type PeriodDateRangePickerCoreProps = (ExecutivePeriodCoreProps | AgentPeriodCoreProps) & PeriodPickerLayoutProps

function PeriodDateRangePickerCore(props: PeriodDateRangePickerCoreProps) {
  const { dateFrom, dateTo, layout = 'responsive', onDone } = props
  const options = props.variant === 'agent' ? AGENT_DASHBOARD_PERIOD_PRESETS : EXECUTIVE_PERIOD_PRESETS
  const [selected, setSelected] = useState<string>(props.appliedPreset || 'today')
  const [from, setFrom] = useState(dateFrom ? istDayOf(dateFrom) : '')
  const [to, setTo] = useState(dateTo ? istDayOf(dateTo) : '')
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const resize = () => setMobile(window.innerWidth < 640)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    setSelected(props.appliedPreset || 'today')
    setFrom(dateFrom ? istDayOf(dateFrom) : '')
    setTo(dateTo ? istDayOf(dateTo) : '')
  }, [props.appliedPreset, dateFrom, dateTo])
  const custom = selected === 'custom'
  const whole = isDayString(from) && isDayString(to) && from <= to
  const blocked = custom && !whole
  const changed = selected !== props.appliedPreset || (custom && (from !== (dateFrom ? istDayOf(dateFrom) : '') || to !== (dateTo ? istDayOf(dateTo) : '')))
  function choose(value: string) {
    setSelected(value)
    if (value === 'custom') {
      setFrom(dateFrom ? istDayOf(dateFrom) : '')
      setTo(dateTo ? istDayOf(dateTo) : '')
    }
  }
  function done() { setOpen(false); onDone?.() }
  function apply() {
    if (custom) {
      if (!whole) return
      props.onApply({ kind: 'custom', dateFrom: istDayStart(from), dateTo: istDayEnd(to) })
    } else if (props.variant === 'agent') {
      props.onApply({ kind: 'preset', preset: selected as Exclude<AgentDashboardDatePreset, 'custom'> })
    } else {
      props.onApply({ kind: 'preset', preset: selected as Exclude<DateRangePreset, 'custom'> })
    }
    done()
  }
  function reset() {
    props.onReset()
    setSelected('today')
    setFrom('')
    setTo('')
    done()
  }
  const fields = custom && <div className={styles.dates}>
    <DateField label="Start date" placeholder="Start date" value={from} onChange={setFrom} />
    <DateField label="End date" placeholder="End date" value={to} onChange={setTo} error={from && to && from > to ? 'The end date is before the start' : undefined} />
  </div>
  const actions = <div className={styles.actions}>
    <Button variant="primary" size="sm" icon={<IconCheck size={14} />} onClick={apply} disabled={blocked || (!custom && !changed)}>Apply</Button>
    <Button size="sm" icon={<IconRefresh size={14} />} onClick={reset}>Reset</Button>
  </div>
  const panel = <div className={styles.panel}>
    <div className={styles.chips}>{options.map(option => <Button size="sm" key={option.value} aria-pressed={selected === option.value} variant={selected === option.value ? 'primary' : 'secondary'} onClick={() => choose(option.value)}>{option.label}</Button>)}</div>
    {fields}{blocked && (!from || !to) && <p className={styles.help}>Pick both dates</p>}{actions}
  </div>
  if (layout === 'panel') return panel
  if (mobile) return <Popover label="Period" open={open} onOpenChange={setOpen} className={styles.popover} trigger={<Button icon={<IconCalendar size={16} />}>Period · {options.find(o => o.value === selected)?.label ?? 'Today'}</Button>}>{panel}</Popover>
  return <div className={styles.inline}>
    <Select label="Period preset" value={selected} options={options} onChange={choose} size="sm" />
    {fields}{actions}
  </div>
}

function DashboardDateRangePickerStore({ layout, onDone }: PeriodPickerLayoutProps) {
  const { filters, setDateRangePreset, setDateRange, resetFilters } = useDashboardStore();
  const { dateRange } = filters;

  return (
    <PeriodDateRangePickerCore
      variant="executive"
      layout={layout}
      onDone={onDone}
      appliedPreset={dateRange.preset || 'today'}
      dateFrom={dateRange.dateFrom}
      dateTo={dateRange.dateTo}
      onApply={(payload) => {
        if (payload.kind === 'custom') {
          setDateRange({
            dateFrom: payload.dateFrom,
            dateTo: payload.dateTo,
            preset: 'custom',
          });
        } else {
          setDateRangePreset(payload.preset);
        }
      }}
      onReset={() => {
        resetFilters();
      }}
    />
  );
}

export type DashboardDateRangePickerProps =
  | ({ mode?: 'store' } & PeriodPickerLayoutProps)
  | {
      mode: 'controlled';
      presetVariant?: 'executive';
      appliedPreset: DateRangePreset;
      dateFrom: string;
      dateTo: string;
      onApply: (payload: DashboardDateRangeApplyPayload) => void;
      onReset: () => void;
    }
  | {
      mode: 'controlled';
      presetVariant: 'agent';
      appliedPreset: AgentDashboardDatePreset;
      dateFrom: string;
      dateTo: string;
      onApply: (payload: AgentDashboardDateRangeApplyPayload) => void;
      onReset: () => void;
    };

export function DashboardDateRangePicker(props: DashboardDateRangePickerProps = {}) {
  if (props.mode === 'controlled' && props.presetVariant === 'agent') {
    return (
      <PeriodDateRangePickerCore
        variant="agent"
        appliedPreset={props.appliedPreset}
        dateFrom={props.dateFrom}
        dateTo={props.dateTo}
        onApply={props.onApply}
        onReset={props.onReset}
      />
    );
  }
  if (props.mode === 'controlled') {
    return (
      <PeriodDateRangePickerCore
        variant="executive"
        appliedPreset={props.appliedPreset}
        dateFrom={props.dateFrom}
        dateTo={props.dateTo}
        onApply={props.onApply}
        onReset={props.onReset}
      />
    );
  }
  return <DashboardDateRangePickerStore layout={props.layout} onDone={props.onDone} />;
}
