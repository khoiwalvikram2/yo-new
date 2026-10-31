import clsx from 'clsx';
import type { LegendEntry } from './chartLegendModel';
import { KEY_CLASS } from './chartSlotClasses';
import s from './charts.module.css';

export interface ChartLegendProps {
  entries: readonly LegendEntry[];
}

/**
 * An overview chart's legend: the mockup's .legend row of .lg entries (M:903-911), one 8px swatch and label
 * per entry, in the order the chart declares its series, each swatch on its own series' slot. Drawn as
 * recharts <Legend content={...} />, which clones it with recharts' own props, including a payload sorted
 * by name; only `entries` is read (chartLegendModel.ts says why).
 */
export function ChartLegend({ entries }: ChartLegendProps) {
  return (
    <ul className={s.legend}>
      {entries.map((entry) => (
        <li key={entry.key} className={s.lg}>
          <i className={clsx(s.lgKey, KEY_CLASS[entry.slot])} aria-hidden="true" />
          <span className={s.lgText}>{entry.label}</span>
        </li>
      ))}
    </ul>
  );
}
