import { useCallback, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import clsx from 'clsx';
import { IconArrowUp, IconArrowDown } from '@tabler/icons-react';
import { ChartDialog, ExpandButton } from './ChartDialog';
import { toChartNumber } from '@/lib/chartValue';
import dash from '../dashboard.module.css';
import s from './charts.module.css';

/* This chart is rendered straight into the page's .pair grid rather than inside a shared Card, so
   unlike the Financial charts it still has to carry a card of its own — otherwise the title would
   have nowhere to live. It is the mockup's card, taken from the round-1 transcription
   (dashboard.module.css .card + .cardHead, M:853-866), not the old heavy one. If OverviewPage
   later wraps this component in Card, delete the <section>/<div className={dash.cardHead}>
   wrapper here and return the body alone.

   The three figures used to sit in cards inside that card. The mockup has no card-in-card, so they
   take its snapshot row instead (M:1077-1081). A growth figure's colour states the sign of a
   delta, which is a state and not a decoration, so the tile takes the semantic pair rather than
   the decorative ramp — and the value keeps the row's own ink, as it did before. */

interface GrowthMetricsChartProps {
  kpis: {
    revenueGrowth: number;
    playerGrowth: number;
    depositGrowth: number;
  };
}

type TipEntry = { value?: unknown; dataKey?: string | number };

/** The mockup's .tip (M:942-958). */
function GrowthTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TipEntry[];
  label?: unknown;
}) {
  if (!active || !payload?.length) return null;
  const heading = label == null ? '' : String(label);
  return (
    <div className={s.tip}>
      {heading ? <p className={s.tipLabel}>{heading}</p> : null}
      {payload.map((entry, i) => {
        const value = toChartNumber(entry.value);
        return (
          <div className={s.tipRow} key={String(entry.dataKey ?? i)}>
            <i className={clsx(s.tipDot, value >= 0 ? s.kPos : s.kNeg)} aria-hidden="true" />
            <span className={s.tipName}>Growth</span>
            <b className={s.tipValue}>{`${value >= 0 ? '+' : ''}${value.toFixed(2)}%`}</b>
          </div>
        );
      })}
    </div>
  );
}

export const GrowthMetricsChart: React.FC<GrowthMetricsChartProps> = ({ kpis }) => {
  /* This chart carries its own card, so unlike the three Financial charts it owns the trigger,
     the flag and the dialog outright — the page is not involved. */
  const [expanded, setExpanded] = useState(false);
  const expand = useCallback(() => setExpanded(true), []);
  const collapse = useCallback(() => setExpanded(false), []);

  const growthData = [
    { name: 'Revenue Growth', value: kpis.revenueGrowth },
    { name: 'Player Growth', value: kpis.playerGrowth },
    { name: 'Deposit Growth', value: kpis.depositGrowth },
  ];

  /* Two helpers, each with two call sites: the card and the dialog's copy. The dialog repeats the
     figures as well as the plot, as every other chart dialog on the page shows everything its card
     shows (the figures used to sit outside this helper, so the expanded view had them only one at a
     time, in the tooltip). The dialog portals to document.body, outside this card's subtree, so its
     chart must still sit inside the same .plot wrapper — every bar, axis and tick colour in
     charts.module.css is a :global() rule scoped to that class. The rows need no such care:
     .snapRow, .metrics and the tile pair are plain class rules, so they style the same in the
     portal. */
  const renderPlot = (height: number) => (
    <div className={s.plot}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={growthData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fontWeight: 500 }}
            angle={-15}
            textAnchor="end"
            height={80}
          />
          <YAxis
            tick={{ fontSize: 11, fontWeight: 500 }}
            label={{
              value: 'Growth %',
              angle: -90,
              position: 'insideLeft',
            }}
          />
          <Tooltip cursor={{ className: s.cursorBar }} content={<GrowthTip />} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            {growthData.map((entry, index) => (
              <Cell key={`cell-${index}`} className={entry.value >= 0 ? s.barPos : s.barNeg} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );

  const renderMetrics = () => (
    <div className={s.metrics}>
      {growthData.map((metric, index) => (
        <div key={index} className={dash.snapRow}>
          <span
            className={clsx(dash.snapTile, metric.value >= 0 ? s.tilePos : s.tileNeg)}
            aria-hidden="true"
          >
            {metric.value >= 0
              ? <IconArrowUp size={16} stroke={1.75} />
              : <IconArrowDown size={16} stroke={1.75} />}
          </span>
          <span className={dash.snapLabel}>{metric.name}</span>
          <span className={dash.snapValue}>
            {metric.value >= 0 ? '+' : ''}{metric.value.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <section className={dash.card} aria-labelledby="ov-growth-metrics">
      <div className={dash.cardHead} data-ui-radius="panel-head">
        <div className={dash.cardHeadLeft}>
          <h2 className={dash.cardTitle} id="ov-growth-metrics">Growth Metrics</h2>
        </div>
        {/* the head's tool slot (M:857-859) — the 30px control the Time Analysis charts use */}
        <div className={dash.cardTools}>
          <ExpandButton aria-label="Expand Growth Metrics" onClick={expand} />
        </div>
      </div>
      <div className={s.body}>
        {renderMetrics()}

        {renderPlot(250)}
      </div>
      {expanded ? (
        <ChartDialog title="Growth Metrics" onClose={collapse}>
          {/* 490, not the 600 the plot-only dialog used: with the rows above it this fits the kit
              Dialog's bounded, scrollable body on the W0 viewport baseline. */}
          {renderMetrics()}
          {renderPlot(490)}
        </ChartDialog>
      ) : null}
    </section>
  );
};
