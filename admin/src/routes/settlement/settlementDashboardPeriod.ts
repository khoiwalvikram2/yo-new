import { TZDate } from '@date-fns/tz';
import { format, startOfMonth, endOfMonth, subDays, subMonths } from 'date-fns';
import { isDayString } from '@/ui/components/istDate';

export const SETTLEMENT_DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7Days', label: 'Last 7 days' },
  { value: 'last30Days', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'allTime', label: 'All time' },
  { value: 'custom', label: 'Custom' },
] as const;
export type SettlementDatePreset = typeof SETTLEMENT_DATE_PRESETS[number]['value'];
export type SettlementPeriodSelection = { preset: Exclude<SettlementDatePreset, 'custom'> } | { preset: 'custom'; from: string; to: string };

export function settlementDashboardPeriod(selection: SettlementPeriodSelection, timeZone: string, now = new Date()) {
  const today = new TZDate(now, timeZone);
  const day = (value: Date) => format(value, 'yyyy-MM-dd');
  let from = day(today); let to = from;
  switch (selection.preset) {
    case 'yesterday': from = to = day(subDays(today, 1)); break;
    case 'last7Days': from = day(subDays(today, 6)); break;
    case 'last30Days': from = day(subDays(today, 29)); break;
    case 'thisMonth': from = day(startOfMonth(today)); break;
    case 'lastMonth': { const previous = subMonths(today, 1); from = day(startOfMonth(previous)); to = day(endOfMonth(previous)); break; }
    case 'allTime': from = '2000-01-01'; break;
    case 'custom':
      if (!isDayString(selection.from) || !isDayString(selection.to) || selection.from > selection.to) throw new Error('Choose a valid date range');
      from = selection.from; to = selection.to; break;
  }
  return { fromDate: from, toDate: to };
}

export function settlementPeriodLabel(from: string, to: string, timeZone: string) {
  const display = (day: string) => { const [y, m, d] = day.split('-').map(Number); return format(new TZDate(y, m - 1, d, timeZone), 'dd MMM yyyy'); };
  return from === to ? display(from) : `${display(from)} – ${display(to)}`;
}
