/* The arithmetic behind the dashboard's "Exposure by market" card, kept free of React so it can be
   tested on its own: fold a long list into its top rows plus one "Others" row, and give every row
   it shows an integer share of the card total that adds up to exactly 100. */

/** One row of Query.exposureByMarket.markets, as the server sends it. */
export interface ExposureMarket {
  key: string;
  product: string;
  label: string;
  amount: number;
}

/** A market as foldMarkets returns it: the server's row as it came, or the one folded row. */
export interface FoldedMarket extends ExposureMarket {
  /** Set only on the folded row: how many markets it stands for (always 2 or more). */
  foldedCount?: number;
}

/** A row the card draws. */
export interface ExposureRow {
  key: string;
  /** 'sports' or 'matka' from the server, or OTHERS_PRODUCT for the folded row. */
  product: string;
  /** The market's name, or OTHERS_LABEL for the folded row, whose count is in foldedCount. */
  label: string;
  /** How many markets the row folds: 0 for a market's own row, 2 or more for the Others row. It is
      kept apart from the label so the card can print "(n)" where the label's ellipsis cannot cut
      it off. */
  foldedCount: number;
  amount: number;
  /** The exact share of the card total, 0-100. The bar is drawn at this width. */
  share: number;
  /** The share as a whole percent, by largest remainder, so the column adds up to exactly 100. */
  percent: number;
  /** What the Share cell prints: `${percent}%`, or '<1%' for a share that is not zero but rounds to 0. */
  percentLabel: string;
}

/* Up to this many markets are shown as they are. One more, and the card keeps the top
   MAX_ROWS - 1 and folds the rest into a single "Others" row, so it never grows past MAX_ROWS rows
   and never spends a row on an "Others (1)" that could have been the market itself. */
export const MAX_ROWS = 6;

export const OTHERS_KEY = 'others';
export const OTHERS_PRODUCT = 'others';
export const OTHERS_LABEL = 'Others';

/** The folded row's full name, "Others (n)"; any other row's name as it is. */
export function fullLabel(row: Pick<ExposureRow, 'label' | 'foldedCount'>): string {
  return row.foldedCount > 0 ? `${row.label} (${row.foldedCount})` : row.label;
}

/**
 * Folds `markets` to at most MAX_ROWS rows. Keeps the server's order (amount largest first, then
 * label), so "the first five" are the five largest. A row with no positive, finite amount is dropped
 * first: the server already omits zero rows, and a negative or NaN amount would break the share
 * arithmetic below rather than mean anything.
 */
export function foldMarkets(markets: readonly ExposureMarket[]): FoldedMarket[] {
  const open = markets.filter(m => Number.isFinite(m.amount) && m.amount > 0);
  if (open.length <= MAX_ROWS) return open;

  const kept = open.slice(0, MAX_ROWS - 1);
  const folded = open.slice(MAX_ROWS - 1);
  return [
    ...kept,
    {
      key: OTHERS_KEY,
      product: OTHERS_PRODUCT,
      label: OTHERS_LABEL,
      foldedCount: folded.length,
      amount: folded.reduce((sum, m) => sum + m.amount, 0),
    },
  ];
}

/**
 * Whole percents of the total for each amount, adding up to exactly 100 (largest remainder method):
 * every row takes the floor of its exact percent, and the points still missing go one each to the
 * rows with the largest fractional parts. Equal fractions go to the earlier row, which in this card
 * is the larger amount. All zeros when the total is not positive.
 */
export function largestRemainderPercents(amounts: readonly number[]): number[] {
  const total = amounts.reduce((sum, a) => sum + a, 0);
  if (!(total > 0)) return amounts.map(() => 0);

  const exact = amounts.map(a => (a / total) * 100);
  const percents = exact.map(e => Math.floor(e));
  let missing = 100 - percents.reduce((sum, p) => sum + p, 0);
  const byRemainder = exact
    .map((e, index) => ({ index, remainder: e - percents[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder) {
    if (missing <= 0) break;
    percents[index] += 1;
    missing -= 1;
  }
  return percents;
}

/** The rows the card draws: folded, each with its exact share and its whole percent. */
export function buildExposureRows(markets: readonly ExposureMarket[]): ExposureRow[] {
  const rows = foldMarkets(markets);
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const percents = largestRemainderPercents(rows.map(r => r.amount));
  return rows.map((r, index) => {
    const share = total > 0 ? (r.amount / total) * 100 : 0;
    const percent = percents[index];
    return {
      key: r.key,
      product: r.product,
      label: r.label,
      foldedCount: r.foldedCount ?? 0,
      amount: r.amount,
      share,
      percent,
      percentLabel: percent === 0 && share > 0 ? '<1%' : `${percent}%`,
    };
  });
}
