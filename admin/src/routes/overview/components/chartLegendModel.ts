/* The /overview charts' series and legends (task 410). React-free and CSS-free: chartSlotClasses.ts maps a
   slot to its class in charts.module.css, ChartLegend.tsx draws the entries.

   WHY THE LEGEND IS DRAWN FROM HERE
   recharts 3.10 sorts its default legend payload by name (Legend itemSorter 'value') and numbers each entry
   legend-item-N after sorting. The overview used to colour legend swatches by that number, so a chart whose
   series names were not already alphabetical labelled the wrong series: Revenue Trends declares Turnover,
   GGR, NGR and showed GGR, NGR, Turnover with GGR wearing Turnover's colour. Each chart now declares its
   series once here (data key, name, colour slot), draws its series from that declaration and its legend
   from the same one, so the legend lists the series in declared order and every swatch takes its own
   series' slot, never a position. */

/**
 * A colour slot: the indigo ramp, one measure in three steps (M:919-924), or the decorative hue ramp in the
 * mockup's own four-step order, for categories (M:931-934, M:938-941). Neither carries a meaning.
 */
export type ChartSlot = 's1' | 's2' | 's3' | 'hInd' | 'hRed' | 'hGrn' | 'hVio';

/** One plotted series. */
export interface ChartSeries {
  /** The recharts dataKey. */
  key: string;
  /** The series name recharts shows in its tooltip, and the legend's label. */
  name: string;
  /** The series' colour: its stroke, fill, gradient and legend swatch all take this one slot. */
  slot: ChartSlot;
}

/** One legend entry: a swatch on `slot` and the `label` beside it. */
export interface LegendEntry {
  key: string;
  label: string;
  slot: ChartSlot;
}

/** Revenue Trends: three areas on the indigo ramp in order, as the mockup's own legend reads (M:1777-1780). */
export const REVENUE_SERIES: readonly ChartSeries[] = [
  { key: 'turnover', name: 'Turnover', slot: 's1' },
  { key: 'ggr', name: 'GGR', slot: 's2' },
  { key: 'ngr', name: 'NGR', slot: 's3' },
];

/** Product Revenue: three stacked segments, parts of one total, so the indigo ramp in order (M:919-924). */
export const PRODUCT_REVENUE_SERIES: readonly ChartSeries[] = [
  { key: 'Sports', name: 'Sports', slot: 's1' },
  { key: 'Casino', name: 'Casino', slot: 's2' },
  { key: 'Matka', name: 'Matka', slot: 's3' },
];

/**
 * Product Distribution: a single series whose bars take the hue ramp one category each (Sports, Casino,
 * Matka). Its one legend entry keeps the swatch it has always shown, the ramp's first step.
 */
export const PRODUCT_DISTRIBUTION_SERIES: readonly ChartSeries[] = [
  { key: 'bets', name: 'Bet Count', slot: 'hInd' },
];

/** The decorative hue ramp in the mockup's order (M:938-941). */
export const HUE_RAMP: readonly ChartSlot[] = ['hInd', 'hRed', 'hGrn', 'hVio'];

/** A categorical bar or slice takes the hue ramp by its own data row, cycling after the fourth. */
export function categorySlot(rowIndex: number): ChartSlot {
  const size = HUE_RAMP.length;
  return HUE_RAMP[((Math.trunc(rowIndex) % size) + size) % size];
}

/** A series chart's legend: one entry per declared series, in declared order, each on its own slot. */
export function seriesLegend(series: readonly ChartSeries[]): LegendEntry[] {
  return series.map(({ key, name, slot }) => ({ key, label: name, slot }));
}

/**
 * A categorical chart's legend (one slice per data row): the rows in data order, each on the slot its own
 * slice takes (categorySlot of the same row) and labelled by `label`, the row's name by default.
 */
export function categoryLegend<Row extends { name: string }>(
  rows: readonly Row[],
  label: (row: Row) => string = (row) => row.name,
): LegendEntry[] {
  return rows.map((row, index) => ({ key: row.name, label: label(row), slot: categorySlot(index) }));
}
