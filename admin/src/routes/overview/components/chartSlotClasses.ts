import type { ChartSlot } from './chartLegendModel';
import s from './charts.module.css';

/* A colour slot's classes in charts.module.css (task 410). A series, its gradient and its legend swatch read
   the same slot through these maps, so the three cannot drift apart. */

/**
 * On a series layer or a <Cell>: .s1-.s3 stroke an area curve or fill a bar (M:919-924), .hInd-.hVio fill
 * a bar or a pie slice (M:931-934).
 */
export const SERIES_CLASS: Readonly<Record<ChartSlot, string>> = {
  s1: s.s1,
  s2: s.s2,
  s3: s.s3,
  hInd: s.hInd,
  hRed: s.hRed,
  hGrn: s.hGrn,
  hVio: s.hVio,
};

/** On an area's <linearGradient>: one colour per gradient (M:926-937); only the indigo ramp has one. */
export const GRADIENT_CLASS: Readonly<Partial<Record<ChartSlot, string>>> = {
  s1: s.gr1,
  s2: s.gr2,
  s3: s.gr3,
};

/** The swatch tying a legend entry to its series (M:908-910), the same one the tooltip rows use (M:954-956). */
export const KEY_CLASS: Readonly<Record<ChartSlot, string>> = {
  s1: s.k1,
  s2: s.k2,
  s3: s.k3,
  hInd: s.kInd,
  hRed: s.kRed,
  hGrn: s.kGrn,
  hVio: s.kVio,
};
