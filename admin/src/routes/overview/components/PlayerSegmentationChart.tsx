import { useCallback, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, type PieLabelRenderProps } from 'recharts';
import clsx from 'clsx';
import { ChartDialog, ExpandButton } from './ChartDialog';
import { ChartLegend } from './ChartLegend';
import { categoryLegend, categorySlot } from './chartLegendModel';
import { SERIES_CLASS } from './chartSlotClasses';
import { useFormatLocale } from '@/shared/core/useFormatLocale';
import { toChartNumber } from '@/lib/chartValue';
import dash from '../dashboard.module.css';
import s from './charts.module.css';

/* This chart is rendered straight into the page's .pair grid rather than inside a SectionCard, so
   unlike the Financial charts it still has to carry a card of its own — otherwise the title would
   have nowhere to live. It is the mockup's card, taken from the round-1 transcription
   (dashboard.module.css .card + .cardHead, M:853-866), not the old heavy one. If OverviewPage
   later wraps this component in SectionCard, delete the <section>/<div className={dash.cardHead}>
   wrapper here and return the body alone. */

interface PlayerSegmentationChartProps {
  kpis: {
    ftdCount: number;
    activePlayers: number;
    totalPlayers: number;
    newPlayers: number;
  };
}

/* The four slices are categories, not steps of one measure, so they take the decorative ramp in
   the mockup's own four-step order (M:931-934, M:938-941). It carries no meaning. A slice and its
   legend entry both take the slot of their own data row (chartLegendModel.categorySlot). */
const SLICE_DOTS = [s.kInd, s.kRed, s.kGrn, s.kVio];

type TipEntry = { name?: string | number; value?: unknown; dataKey?: string | number };

/** The mockup's .tip (M:942-958). */
function SliceTip({
  active,
  payload,
  format,
  names,
}: {
  active?: boolean;
  payload?: TipEntry[];
  format: (value: number) => string;
  names: string[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className={s.tip}>
      {payload.map((entry, i) => {
        const name = entry.name == null ? '' : String(entry.name);
        const index = names.indexOf(name);
        return (
          <div className={s.tipRow} key={String(entry.dataKey ?? i)}>
            <i
              className={clsx(s.tipDot, SLICE_DOTS[(index < 0 ? i : index) % SLICE_DOTS.length])}
              aria-hidden="true"
            />
            <span className={s.tipName}>{name}</span>
            <b className={s.tipValue}>{format(toChartNumber(entry.value))}</b>
          </div>
        );
      })}
    </div>
  );
}

export const PlayerSegmentationChart: React.FC<PlayerSegmentationChartProps> = ({ kpis }) => {
  const formatLocale = useFormatLocale();

  /* This chart carries its own card, so unlike the three Financial charts it owns the trigger,
     the flag and the overlay outright — the page is not involved. onClose is stable because it
     is a dependency of the dialog's Escape effect. */
  const [expanded, setExpanded] = useState(false);
  const expand = useCallback(() => setExpanded(true), []);
  const collapse = useCallback(() => setExpanded(false), []);

  const segmentationData = [
    { name: 'New Players', value: kpis.newPlayers },
    { name: 'Active Players', value: kpis.activePlayers },
    { name: 'First Time Depositors', value: kpis.ftdCount },
    { name: 'Inactive Players', value: Math.max(0, kpis.totalPlayers - kpis.activePlayers) },
  ];

  /* The legend: the four rows in data order, each swatch on its own slice's slot and labelled
     "name: count" as before (task 410). */
  const legendEntries = categoryLegend(
    segmentationData,
    (row) => `${row.name}: ${row.value.toLocaleString(formatLocale)}`,
  );

  const RADIAN = Math.PI / 180;
  /* recharts always supplies midAngle and percent to a label; their types are optional, and
     Number() reads a missing one as NaN, exactly as the arithmetic below did before. */
  const renderCustomizedLabel = ({
    cx,
    cy,
    midAngle,
    innerRadius,
    outerRadius,
    percent,
  }: PieLabelRenderProps) => {
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-Number(midAngle) * RADIAN);
    const y = cy + radius * Math.sin(-Number(midAngle) * RADIAN);

    return (
      <text
        x={x}
        y={y}
        className={s.pieLabel}
        textAnchor={x > cx ? 'start' : 'end'}
        dominantBaseline="central"
      >
        {`${(Number(percent) * 100).toFixed(0)}%`}
      </text>
    );
  };

  /* One helper, two call sites: the inline plot and the dialog's copy. The dialog portals to
     document.body, outside this card's subtree, so its chart must still sit inside the same
     .plot wrapper — every slice and label colour in charts.module.css is a :global()
     rule scoped to that class. The radius grows with the box: a 100px pie adrift in a 600px
     dialog would read as broken rather than expanded. */
  const renderPlot = (height: number, outerRadius: number) => (
    <div className={s.plot}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={segmentationData}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={renderCustomizedLabel}
            outerRadius={outerRadius}
            dataKey="value"
          >
            {/* Keyed by name, not index: the four names are unique and stable, and the slice
                colour now comes from a class rather than a `fill` prop, which left `entry`
                unused — and an unused binding is a compile error here (noUnusedLocals). */}
            {segmentationData.map((entry, index) => (
              <Cell key={entry.name} className={SERIES_CLASS[categorySlot(index)]} />
            ))}
          </Pie>
          <Tooltip
            content={
              <SliceTip
                format={(value) => value.toLocaleString(formatLocale)}
                names={segmentationData.map((entry) => entry.name)}
              />
            }
          />
          <Legend
            verticalAlign="bottom"
            height={36}
            content={<ChartLegend entries={legendEntries} />}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <section className={dash.card} aria-labelledby="ov-player-segmentation">
      <div className={dash.cardHead} data-ui-radius="panel-head">
        <div className={dash.cardHeadLeft}>
          <h2 className={dash.cardTitle} id="ov-player-segmentation">Player Segmentation</h2>
        </div>
        {/* the head's tool slot (M:857-859) — the 30px control the Time Analysis charts use */}
        <div className={dash.cardTools}>
          <ExpandButton aria-label="Expand Player Segmentation" onClick={expand} />
        </div>
      </div>
      <div className={s.body}>{renderPlot(300, 100)}</div>
      {expanded ? (
        <ChartDialog title="Player Segmentation" onClose={collapse}>
          {renderPlot(600, 220)}
        </ChartDialog>
      ) : null}
    </section>
  );
};
