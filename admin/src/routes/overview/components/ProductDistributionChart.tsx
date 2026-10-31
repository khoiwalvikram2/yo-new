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
  Cell,
} from 'recharts';
import { LoadingState } from '@/ui/components/LoadingState';
import { Skeleton } from '@/ui/components/Skeleton';
import { DASHBOARD_KPIS_QUERY } from '../graphql';
import { useDashboardStore } from '@/state/dashboardStore';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useFormatLocale } from '@/shared/core/useFormatLocale';
import { toChartNumber } from '@/lib/chartValue';
import { ChartDialog } from './ChartDialog';
import { ChartLegend } from './ChartLegend';
import { PRODUCT_DISTRIBUTION_SERIES, seriesLegend } from './chartLegendModel';
import s from './charts.module.css';

/* The card supplies the surface, the title and the inset; this renders the plot only.
   Sports/Casino/Matka are categories rather than steps of one measure, so the bars take the
   decorative hue ramp instead of the indigo ramp (M:931-934). */
const PRODUCT_BARS = [s.hInd, s.hRed, s.hGrn];
const PRODUCT_DOTS = [s.kInd, s.kRed, s.kGrn];

/* The one series and its legend: "Bet Count" on the swatch it has always shown, the first bar's
   hue, drawn from the series declaration rather than from recharts' legend position (task 410). */
const [BET_COUNT] = PRODUCT_DISTRIBUTION_SERIES;
const LEGEND = seriesLegend(PRODUCT_DISTRIBUTION_SERIES);

type TipEntry = { name?: string | number; value?: unknown; dataKey?: string | number };

/** The mockup's .tip (M:942-958). */
function ProductTip({
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
  /* the swatch follows the hovered category, not the row, because this plot's single series is
     coloured per bar */
  const index = ['Sports', 'Casino', 'Matka'].indexOf(heading);
  return (
    <div className={s.tip}>
      {heading ? <p className={s.tipLabel}>{heading}</p> : null}
      {payload.map((entry, i) => (
        <div className={s.tipRow} key={String(entry.dataKey ?? i)}>
          <i
            className={clsx(s.tipDot, PRODUCT_DOTS[(index < 0 ? i : index) % PRODUCT_DOTS.length])}
            aria-hidden="true"
          />
          <span className={s.tipName}>Bet Count</span>
          <b className={s.tipValue}>{format(toChartNumber(entry.value))}</b>
        </div>
      ))}
    </div>
  );
}

/* The overlay is rendered here, not by the page, so it redraws the data this component already
   fetched — a second instance inside the dialog would mean a second polling useQuery. The trigger
   sits in the card head, which is the page's markup, so the open flag arrives as a prop. */
interface ProductDistributionChartProps {
  /** Renders the full-screen overlay beside the inline plot. */
  expanded?: boolean;
  /** Closes it. Fired by the dialog's close control, its scrim and Escape. */
  onCollapse?: () => void;
}

export function ProductDistributionChart({
  expanded = false,
  onCollapse,
}: ProductDistributionChartProps) {
  const formatLocale = useFormatLocale();
  const { getDateRangeForQuery } = useDashboardStore();
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();

  const dateRange = getDateRangeForQuery();

  const { data: kpisData, loading: kpisLoading } = useQuery(DASHBOARD_KPIS_QUERY, {
    variables: { dateRange },
    pollInterval: 60000,
    errorPolicy: 'all',
  });

  const loading = kpisLoading;

  const revenueData = useMemo(() => {
    if (!kpisData?.overviewKPIs) return [];

    const kpis = kpisData.overviewKPIs;
    return [
      {
        name: 'Sports',
        ggr: convertFromWhitelabelCurrency(kpis.sportsGGR || 0),
        bets: kpis.sportsBets || 0,
      },
      {
        name: 'Casino',
        ggr: convertFromWhitelabelCurrency(kpis.casinoGGR || 0),
        bets: kpis.casinoBets || 0,
      },
      {
        name: 'Matka',
        ggr: convertFromWhitelabelCurrency(kpis.matkaGGR || 0),
        bets: kpis.matkaBets || 0,
      },
    ];
  }, [kpisData, convertFromWhitelabelCurrency]);

  // Note: pieData computed but not used in current implementation
  // const pieData = useMemo(() => {
  //   return revenueData.map((item) => ({
  //     name: item.name,
  //     value: item.ggr,
  //   }));
  // }, [revenueData]);

  if (loading && !kpisData) {
    return (
      <div className={s.plot} aria-busy="true">
        <LoadingState label="Loading product distribution" height={220} />
        <div className={s.foot}>
          {['Sports', 'Casino', 'Matka'].map((name) => (
            <span key={name} className={s.footItem}>
              <span className={s.footName}>{name}:</span> <Skeleton width={56} height={10} />
            </span>
          ))}
        </div>
      </div>
    );
  }

  /* One helper, two call sites: the inline plot and the dialog's copy. The dialog portals to
     document.body, outside this section's subtree, so its chart must still sit inside the same
     .plot wrapper — every bar, axis and tick colour in charts.module.css is a :global()
     rule scoped to that class, and a copy rendered outside it would lose all of them. */
  const renderPlot = (height: number) => (
    <div className={s.plot}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={revenueData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fontWeight: 500 }} />
          <YAxis tick={{ fontSize: 11, fontWeight: 500 }} />
          <Tooltip
            cursor={{ className: s.cursorBar }}
            content={
              <ProductTip format={(value) => value.toLocaleString(formatLocale)} />
            }
          />
          <Legend wrapperStyle={{ paddingTop: '10px' }} content={<ChartLegend entries={LEGEND} />} />
          <Bar dataKey={BET_COUNT.key} name={BET_COUNT.name} radius={[6, 6, 0, 0]}>
            {revenueData.map((_, index) => (
              <Cell key={index} className={PRODUCT_BARS[index % PRODUCT_BARS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* GGR Values Section */}
      <div className={s.foot}>
        {revenueData.map((item, index) => (
          <span key={index} className={s.footItem}>
            <span className={s.footName}>{item.name}:</span> {formatAmount(item.ggr)}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <>
      {renderPlot(220)}
      {expanded && onCollapse ? (
        <ChartDialog title="Product Distribution" onClose={onCollapse}>
          {renderPlot(600)}
        </ChartDialog>
      ) : null}
    </>
  );
}
