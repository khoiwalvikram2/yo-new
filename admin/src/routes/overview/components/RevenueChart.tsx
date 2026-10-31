import { useMemo } from 'react';
import { useQuery } from '@apollo/client';
import clsx from 'clsx';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { LoadingState } from '@/ui/components/LoadingState';
import { DASHBOARD_TRENDS_QUERY } from '../graphql';
import { useDashboardStore } from '@/state/dashboardStore';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useFormatDate } from '@/shared/core/useFormatDate';
import { toChartNumber } from '@/lib/chartValue';
import { ChartDialog } from './ChartDialog';
import { ChartLegend } from './ChartLegend';
import { REVENUE_SERIES, seriesLegend } from './chartLegendModel';
import { GRADIENT_CLASS, SERIES_CLASS } from './chartSlotClasses';
import s from './charts.module.css';

/* The card this chart sits in supplies the surface, the title and the inset (OverviewPage
   SectionCard), so the component renders the plot and nothing else. Colours are carried by the
   classes in charts.module.css rather than by props, so the plot follows a theme flip on its own. */

/** One swatch per series, in ramp order (M:954-956). */
const RAMP_DOTS = [s.k1, s.k2, s.k3];

/** Each area's gradient id; the area's fill is a url() into the plot's own <defs>. */
const GRADIENT_ID: Readonly<Record<string, string>> = {
  turnover: 'colorTurnover',
  ggr: 'colorGGR',
  ngr: 'colorNGR',
};

/** The legend: Turnover, GGR, NGR in declared order, each swatch on its own area's slot (task 410). */
const LEGEND = seriesLegend(REVENUE_SERIES);

/** The DashboardTrends fields this chart reads (graphql.ts); a type only. */
type TrendPoint = { date: string; turnover: number; ggr: number; ngr: number };

type TipEntry = { name?: string | number; value?: unknown; dataKey?: string | number };

/** The mockup's .tip (M:942-958), replacing recharts' contentStyle/labelStyle/itemStyle. */
function RampTip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: TipEntry[];
  label?: unknown;
  format: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const heading = label == null ? '' : String(label);
  return (
    <div className={s.tip}>
      {heading ? <p className={s.tipLabel}>{heading}</p> : null}
      {payload.map((entry, i) => (
        <div className={s.tipRow} key={String(entry.dataKey ?? i)}>
          <i className={clsx(s.tipDot, RAMP_DOTS[i % RAMP_DOTS.length])} aria-hidden="true" />
          <span className={s.tipName}>{entry.name}</span>
          <b className={s.tipValue}>{format(toChartNumber(entry.value))}</b>
        </div>
      ))}
    </div>
  );
}

/* The expanded overlay is rendered HERE rather than by the page so that it redraws the data this
   component has already fetched. A second <RevenueChart/> mounted inside the dialog would open a
   second useQuery with a 60s poller of its own. The trigger, by contrast, belongs in the card head,
   which is the page's markup — so the open flag is the page's and arrives as a prop. */
interface RevenueChartProps {
  /** Renders the full-screen overlay beside the inline plot. */
  expanded?: boolean;
  /** Closes it. Fired by the dialog's close control, its scrim and Escape. */
  onCollapse?: () => void;
}

export function RevenueChart({ expanded = false, onCollapse }: RevenueChartProps) {
  const { getDateRangeForQuery } = useDashboardStore();
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const { formatDate } = useFormatDate();

  const dateRange = getDateRangeForQuery();

  const { data, loading, error } = useQuery(DASHBOARD_TRENDS_QUERY, {
    variables: { dateRange },
    pollInterval: 60000,
    errorPolicy: 'all',
  });

  const chartData = useMemo(() => {
    if (!data?.dashboardTrends) return [];

    return data.dashboardTrends.map((point: TrendPoint) => ({
      date: formatDate(point.date, 'MMM d'),
      turnover: convertFromWhitelabelCurrency(point.turnover),
      ggr: convertFromWhitelabelCurrency(point.ggr),
      ngr: convertFromWhitelabelCurrency(point.ngr),
    }));
  }, [data, convertFromWhitelabelCurrency, formatDate]);

  if (loading && !data) {
    return <LoadingState label="Loading revenue trends" height={220} />;
  }

  if (error && !data) {
    return <p className={s.error}>Failed to load revenue trends: {error.message}</p>;
  }

  /* One helper, two call sites: the inline plot and the dialog's copy. The dialog portals to
     document.body, outside this section's subtree, so its chart must still sit inside the same
     .plot wrapper — every grid, axis and tick colour in charts.module.css is a :global()
     rule scoped to that class, and a copy rendered outside it would lose all of them. */
  const renderPlot = (height: number) => (
    <div className={s.plot}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
          {/* one colour per gradient, three stops of alpha (M:3553), on its own series' slot */}
          <defs>
            {REVENUE_SERIES.map((series) => (
              <linearGradient
                key={series.key}
                id={GRADIENT_ID[series.key]}
                className={GRADIENT_CLASS[series.slot]}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0" className={s.gA} />
                <stop offset="0.55" className={s.gB} />
                <stop offset="1" className={s.gC} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} />
          <YAxis tickFormatter={(value) => formatAmount(value)} tick={{ fontSize: 10, fontWeight: 500 }} />
          <Tooltip
            cursor={{ className: s.cursorLine }}
            content={<RampTip format={(value) => formatAmount(value)} />}
          />
          <Legend wrapperStyle={{ paddingTop: 16 }} content={<ChartLegend entries={LEGEND} />} />
          {REVENUE_SERIES.map((series) => (
            <Area
              key={series.key}
              type="monotone"
              dataKey={series.key}
              className={SERIES_CLASS[series.slot]}
              strokeWidth={2}
              fillOpacity={1}
              fill={`url(#${GRADIENT_ID[series.key]})`}
              name={series.name}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <>
      {renderPlot(220)}
      {expanded && onCollapse ? (
        <ChartDialog title="Revenue Trends" onClose={onCollapse}>
          {renderPlot(600)}
        </ChartDialog>
      ) : null}
    </>
  );
}
