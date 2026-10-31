import { useMemo } from 'react';
import { useQuery } from '@apollo/client';
import clsx from 'clsx';
import {
  BarChart,
  Bar,
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
import { PRODUCT_REVENUE_SERIES, seriesLegend } from './chartLegendModel';
import { SERIES_CLASS } from './chartSlotClasses';
import s from './charts.module.css';

/* The card supplies the surface, the title and the inset; this renders the plot only.
   The three stacked segments are parts of one total, so they take the indigo ramp in order
   (M:919-924) rather than three hues. */
const RAMP_DOTS = [s.k1, s.k2, s.k3];

/** The legend: Sports, Casino, Matka in declared order, each swatch on its own segment's slot (task 410). */
const LEGEND = seriesLegend(PRODUCT_REVENUE_SERIES);

/** Only the top segment of the stack rounds its upper corners. */
const TOP_RADIUS: [number, number, number, number] = [6, 6, 0, 0];
const FLAT_RADIUS: [number, number, number, number] = [0, 0, 0, 0];

/** The DashboardTrends fields this chart reads (graphql.ts); a type only. */
type TrendPoint = {
  date: string;
  sportsGGR?: number | null;
  casinoGGR?: number | null;
  matkaGGR?: number | null;
};

type TipEntry = { name?: string | number; value?: unknown; dataKey?: string | number };

/** The mockup's .tip (M:942-958). */
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

/* The overlay is rendered here, not by the page, so it redraws the data this component already
   fetched — a second instance inside the dialog would mean a second polling useQuery. The trigger
   sits in the card head, which is the page's markup, so the open flag arrives as a prop. */
interface ProductRevenueTrendsChartProps {
  /** Renders the full-screen overlay beside the inline plot. */
  expanded?: boolean;
  /** Closes it. Fired by the dialog's close control, its scrim and Escape. */
  onCollapse?: () => void;
}

export function ProductRevenueTrendsChart({
  expanded = false,
  onCollapse,
}: ProductRevenueTrendsChartProps) {
  const { getDateRangeForQuery } = useDashboardStore();
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const { formatDate } = useFormatDate();

  const dateRange = getDateRangeForQuery();

  const { data: trendsData, loading: trendsLoading } = useQuery(DASHBOARD_TRENDS_QUERY, {
    variables: { dateRange },
    pollInterval: 60000,
    errorPolicy: 'all',
  });

  const loading = trendsLoading;

  const stackedBarData = useMemo(() => {
    if (!trendsData?.dashboardTrends) return [];

    return trendsData.dashboardTrends.map((point: TrendPoint) => ({
      date: formatDate(point.date, 'MMM d'),
      Sports: convertFromWhitelabelCurrency(point.sportsGGR || 0),
      Casino: convertFromWhitelabelCurrency(point.casinoGGR || 0),
      Matka: convertFromWhitelabelCurrency(point.matkaGGR || 0),
    }));
  }, [trendsData, convertFromWhitelabelCurrency, formatDate]);

  if (loading && !trendsData) {
    return <LoadingState label="Loading product revenue" height={220} />;
  }

  /* One helper, two call sites: the inline plot and the dialog's copy. The dialog portals to
     document.body, outside this section's subtree, so its chart must still sit inside the same
     .plot wrapper — every bar, axis and tick colour in charts.module.css is a :global()
     rule scoped to that class, and a copy rendered outside it would lose all of them. */
  const renderPlot = (height: number) => (
    <div className={s.plot}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={stackedBarData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fontWeight: 500 }} />
          <YAxis tickFormatter={(value) => formatAmount(value)} tick={{ fontSize: 11, fontWeight: 500 }} />
          <Tooltip
            cursor={{ className: s.cursorBar }}
            content={<RampTip format={(value) => formatAmount(value)} />}
          />
          <Legend wrapperStyle={{ paddingTop: '10px' }} content={<ChartLegend entries={LEGEND} />} />
          {PRODUCT_REVENUE_SERIES.map((series, index) => (
            <Bar
              key={series.key}
              dataKey={series.key}
              stackId="a"
              className={SERIES_CLASS[series.slot]}
              radius={index === PRODUCT_REVENUE_SERIES.length - 1 ? TOP_RADIUS : FLAT_RADIUS}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <>
      {renderPlot(220)}
      {expanded && onCollapse ? (
        <ChartDialog title="Product Revenue" onClose={onCollapse}>
          {renderPlot(600)}
        </ChartDialog>
      ) : null}
    </>
  );
}
