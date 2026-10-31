import {
  startOfDay,
  endOfDay,
  addDays,
  DEFAULT_ADMIN_TZ,
} from '@/shared/utils/date';

export type AgentDashboardDatePreset =
  | 'allTime'
  | 'today'
  | 'yesterday'
  | 'lastWeek'
  | 'lastMonth'
  | 'custom';

export type AgentDashboardDateRangeApplyPayload =
  | { kind: 'preset'; preset: Exclude<AgentDashboardDatePreset, 'custom'> }
  | { kind: 'custom'; dateFrom: string; dateTo: string };

export const AGENT_DASHBOARD_PERIOD_PRESETS: Array<{ label: string; value: AgentDashboardDatePreset }> = [
  { label: 'All time', value: 'allTime' },
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last week', value: 'lastWeek' },
  { label: 'Last month', value: 'lastMonth' },
  { label: 'Custom', value: 'custom' },
];

/**
 * Rolling-window IST ranges that match the Agent Profile KPI presets exactly:
 *   Last week  = today − 6 days … today  (7 inclusive days)
 *   Last month = today − 29 days … today (30 inclusive days)
 */
export function getDateRangeISOForAgentDashboardPreset(
  preset: Exclude<AgentDashboardDatePreset, 'custom'>
): { dateFrom: string; dateTo: string } {
  const TZ = DEFAULT_ADMIN_TZ;
  const now = new Date();

  switch (preset) {
    case 'allTime':
      return {
        dateFrom: startOfDay('2000-01-01', TZ).toISOString(),
        dateTo: endOfDay(now, TZ).toISOString(),
      };
    case 'today':
      return {
        dateFrom: startOfDay(now, TZ).toISOString(),
        dateTo: endOfDay(now, TZ).toISOString(),
      };
    case 'yesterday': {
      const y = addDays(startOfDay(now, TZ), -1);
      return {
        dateFrom: startOfDay(y, TZ).toISOString(),
        dateTo: endOfDay(y, TZ).toISOString(),
      };
    }
    case 'lastWeek': {
      const from = addDays(startOfDay(now, TZ), -6);
      return {
        dateFrom: startOfDay(from, TZ).toISOString(),
        dateTo: endOfDay(now, TZ).toISOString(),
      };
    }
    case 'lastMonth': {
      const from = addDays(startOfDay(now, TZ), -29);
      return {
        dateFrom: startOfDay(from, TZ).toISOString(),
        dateTo: endOfDay(now, TZ).toISOString(),
      };
    }
    default:
      return {
        dateFrom: startOfDay(now, TZ).toISOString(),
        dateTo: endOfDay(now, TZ).toISOString(),
      };
  }
}
