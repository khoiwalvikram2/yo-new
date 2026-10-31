/**
 * The four /overview charts that carry a legend (task 410). recharts 3.10 sorts its default legend by name and
 * numbers legend-item-N after sorting, so the old position-based swatch CSS put Turnover's colour on GGR,
 * Sports' on Casino and New Players' hue on Active Players. Each chart now draws ChartLegend from its own
 * series declaration. These mount each chart for real (recharts drawing SVG into jsdom at a fixed size, since
 * ResponsiveContainer measures 0 there) and check, against literal expectations, that the legend lists the
 * series in declared order and that every swatch wears the same slot as its area, bar segment or slice.
 */
import { beforeEach, describe, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DASHBOARD_KPIS_QUERY, DASHBOARD_TRENDS_QUERY } from '../graphql';
import { RevenueChart } from './RevenueChart';
import { ProductRevenueTrendsChart } from './ProductRevenueTrendsChart';
import { PlayerSegmentationChart } from './PlayerSegmentationChart';
import { ProductDistributionChart } from './ProductDistributionChart';
import s from './charts.module.css';

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  dateRange: { dateFrom: '2026-10-01', dateTo: '2026-10-07' },
}));

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>();
  return { ...actual, useQuery: mocks.useQuery };
});

vi.mock('@/state/dashboardStore', () => ({
  useDashboardStore: () => ({ getDateRangeForQuery: () => mocks.dateRange }),
}));

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => `AMT:${value}`,
    convertFromWhitelabelCurrency: (value: number) => value,
  }),
}));

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({ formatDate: (value: string) => `D:${value}` }),
}));

vi.mock('@/shared/core/useFormatLocale', () => ({
  useFormatLocale: () => 'en-US',
}));

/* ResponsiveContainer measures its parent, which is 0x0 in jsdom, and then draws nothing. This stand-in hands
   the chart a fixed width and the container's own height, so recharts draws the real series and legend. */
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  const React = await import('react');
  function FixedContainer({
    children,
    height,
  }: {
    children: React.ReactElement<{ width?: number; height?: number }>;
    height?: number | string;
  }) {
    return React.createElement(
      'div',
      { className: 'recharts-responsive-container' },
      React.cloneElement(children, { width: 640, height: Number(height) }),
    );
  }
  return { ...actual, ResponsiveContainer: FixedContainer };
});

const TRENDS = {
  dashboardTrends: [
    { date: '2026-10-01', turnover: 1000, ggr: 300, ngr: 200, sportsGGR: 120, casinoGGR: 90, matkaGGR: 30 },
    { date: '2026-10-02', turnover: 1400, ggr: 380, ngr: 260, sportsGGR: 150, casinoGGR: 110, matkaGGR: 45 },
    { date: '2026-10-03', turnover: 900, ggr: 250, ngr: 170, sportsGGR: 100, casinoGGR: 80, matkaGGR: 25 },
  ],
};

const KPIS = {
  overviewKPIs: {
    sportsGGR: 120,
    casinoGGR: 90,
    matkaGGR: 30,
    sportsBets: 50,
    casinoBets: 40,
    matkaBets: 10,
  },
};

type QueryResult = { data?: unknown; loading: boolean; error?: Error };

function serve(trends: QueryResult, kpis: QueryResult = { data: KPIS, loading: false }) {
  mocks.useQuery.mockImplementation((query: unknown) => (query === DASHBOARD_TRENDS_QUERY ? trends : kpis));
}

const QUERY_OPTIONS = {
  variables: { dateRange: mocks.dateRange },
  pollInterval: 60000,
  errorPolicy: 'all',
};

/** Swatch class → slot name: the .k* swatches the legend and the tip rows share. */
const SWATCH: Record<string, string> = {
  [s.k1]: 'k1',
  [s.k2]: 'k2',
  [s.k3]: 'k3',
  [s.kInd]: 'kInd',
  [s.kRed]: 'kRed',
  [s.kGrn]: 'kGrn',
  [s.kVio]: 'kVio',
};

/** Series class → slot name: the classes that paint an area, a bar segment or a slice. */
const SERIES: Record<string, string> = {
  [s.s1]: 's1',
  [s.s2]: 's2',
  [s.s3]: 's3',
  [s.hInd]: 'hInd',
  [s.hRed]: 'hRed',
  [s.hGrn]: 'hGrn',
  [s.hVio]: 'hVio',
};

const GRADIENT: Record<string, string> = { [s.gr1]: 'gr1', [s.gr2]: 'gr2', [s.gr3]: 'gr3' };

/** The one name a class map knows among an element's classes ('' when none, '+' joined when several). */
function slotOf(element: Element | null, map: Record<string, string>): string {
  if (!element) return '';
  return Array.from(element.classList)
    .filter((name) => name in map)
    .map((name) => map[name])
    .join('+');
}

/** Each legend under `root`, as its [label, swatch slot] pairs in document order. */
function readLegends(root: Element): string[][][] {
  return Array.from(root.getElementsByClassName(s.legend)).map((list) => {
    assert.equal(list.tagName, 'UL', 'the legend is a list');
    return Array.from(list.children).map((item) => {
      assert.equal(item.tagName, 'LI');
      const swatch = item.querySelector('i');
      assert.equal(swatch?.getAttribute('aria-hidden'), 'true', 'the swatch is decoration');
      assert.ok(swatch?.classList.contains(s.lgKey), 'the swatch is the legend key');
      return [item.textContent ?? '', slotOf(swatch, SWATCH)];
    });
  });
}

/** recharts' own legend, the one that sorted by name, must not render alongside ours. */
function assertNoDefaultLegend(root: Element) {
  assert.equal(root.querySelector('.recharts-default-legend'), null);
  assert.equal(root.querySelector('[class*="legend-item-"]'), null);
}

/** The swatch slot for a series slot: the same colour, on the legend's swatch class. */
const SWATCH_FOR: Record<string, string> = {
  s1: 'k1',
  s2: 'k2',
  s3: 'k3',
  hInd: 'kInd',
  hRed: 'kRed',
  hGrn: 'kGrn',
  hVio: 'kVio',
};

beforeEach(() => {
  mocks.useQuery.mockReset();
  /* recharts animates bars and slices in from nothing unless the viewer prefers reduced motion
     (isAnimationActive 'auto'), and jsdom never advances that animation; asking for reduced motion
     draws every bar and slice at once. restoreMocks puts the setup's matchMedia back after each test. */
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
});

describe('RevenueChart legend', () => {
  test('lists Turnover, GGR, NGR in declared order, each swatch on its own area and gradient', () => {
    serve({ data: TRENDS, loading: false });
    const { container } = render(<RevenueChart />);

    assert.deepStrictEqual(mocks.useQuery.mock.calls[0], [DASHBOARD_TRENDS_QUERY, QUERY_OPTIONS]);

    const legends = readLegends(container);
    assert.deepStrictEqual(legends, [
      [
        ['Turnover', 'k1'],
        ['GGR', 'k2'],
        ['NGR', 'k3'],
      ],
    ]);
    assertNoDefaultLegend(container);

    // each area: its gradient fill, its own series class and that gradient's class, in declared order
    const areas = Array.from(container.querySelectorAll('.recharts-area')).map((layer) => {
      const fill = layer.querySelector('.recharts-area-area')?.getAttribute('fill') ?? '';
      const id = /^url\(#(.+)\)$/.exec(fill)?.[1] ?? '';
      return [fill, slotOf(layer, SERIES), slotOf(container.querySelector(`linearGradient#${id}`), GRADIENT)];
    });
    assert.deepStrictEqual(areas, [
      ['url(#colorTurnover)', 's1', 'gr1'],
      ['url(#colorGGR)', 's2', 'gr2'],
      ['url(#colorNGR)', 's3', 'gr3'],
    ]);
    // and the legend swatch of each series is its area's colour
    legends[0].forEach(([, swatch], index) => assert.equal(swatch, SWATCH_FOR[areas[index][1]]));
  });

  test('the expanded dialog carries the same legend', async () => {
    serve({ data: TRENDS, loading: false });
    render(<RevenueChart expanded onCollapse={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: 'Revenue Trends' });
    assert.deepStrictEqual(readLegends(dialog), [
      [
        ['Turnover', 'k1'],
        ['GGR', 'k2'],
        ['NGR', 'k3'],
      ],
    ]);
    assertNoDefaultLegend(dialog);
  });

  test('loading and failure render no plot and no legend', () => {
    serve({ data: undefined, loading: true });
    const { container, unmount } = render(<RevenueChart />);
    assert.equal(screen.getByRole('status').textContent, 'Loading revenue trends');
    assert.equal(container.getElementsByClassName(s.legend).length, 0);
    unmount();

    serve({ data: undefined, loading: false, error: new Error('boom') });
    const failed = render(<RevenueChart />);
    assert.ok(screen.getByText('Failed to load revenue trends: boom'));
    assert.equal(failed.container.getElementsByClassName(s.legend).length, 0);
  });
});

describe('ProductRevenueTrendsChart legend', () => {
  test('lists Sports, Casino, Matka in declared order, each swatch on its own stacked segment', () => {
    serve({ data: TRENDS, loading: false });
    const { container } = render(<ProductRevenueTrendsChart />);

    assert.deepStrictEqual(mocks.useQuery.mock.calls[0], [DASHBOARD_TRENDS_QUERY, QUERY_OPTIONS]);

    const legends = readLegends(container);
    assert.deepStrictEqual(legends, [
      [
        ['Sports', 'k1'],
        ['Casino', 'k2'],
        ['Matka', 'k3'],
      ],
    ]);
    assertNoDefaultLegend(container);

    // recharts stacks the bar layers in declaration order: Sports, Casino, Matka
    const bars = Array.from(container.querySelectorAll('.recharts-bar')).map((layer) => slotOf(layer, SERIES));
    assert.deepStrictEqual(bars, ['s1', 's2', 's3']);
    legends[0].forEach(([, swatch], index) => assert.equal(swatch, SWATCH_FOR[bars[index]]));
  });

  test('the expanded dialog carries the same legend; loading renders none', async () => {
    serve({ data: TRENDS, loading: false });
    const { unmount } = render(<ProductRevenueTrendsChart expanded onCollapse={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: 'Product Revenue' });
    assert.deepStrictEqual(readLegends(dialog), [
      [
        ['Sports', 'k1'],
        ['Casino', 'k2'],
        ['Matka', 'k3'],
      ],
    ]);
    unmount();

    serve({ data: undefined, loading: true });
    const { container } = render(<ProductRevenueTrendsChart />);
    assert.equal(screen.getByRole('status').textContent, 'Loading product revenue');
    assert.equal(container.getElementsByClassName(s.legend).length, 0);
  });
});

describe('PlayerSegmentationChart legend', () => {
  const KPI_PROPS = { ftdCount: 15, activePlayers: 1200, totalPlayers: 1500, newPlayers: 40 };
  const EXPECTED = [
    ['New Players: 40', 'kInd'],
    ['Active Players: 1,200', 'kRed'],
    ['First Time Depositors: 15', 'kGrn'],
    ['Inactive Players: 300', 'kVio'],
  ];

  test('lists the four segments in data order with their counts, each swatch on its own slice', () => {
    const { container } = render(<PlayerSegmentationChart kpis={KPI_PROPS} />);
    const card = screen.getByRole('region', { name: 'Player Segmentation' });

    const legends = readLegends(card);
    assert.deepStrictEqual(legends, [EXPECTED]);
    assertNoDefaultLegend(container);

    // each slice, in data order, with the slot its Cell gave it
    const slices = Array.from(container.querySelectorAll('.recharts-pie-sector')).map((sector) =>
      slotOf(sector.querySelector('.recharts-sector') ?? sector, SERIES),
    );
    assert.deepStrictEqual(slices, ['hInd', 'hRed', 'hGrn', 'hVio']);
    legends[0].forEach(([, swatch], index) => assert.equal(swatch, SWATCH_FOR[slices[index]]));
  });

  test('the expand dialog carries the same legend', async () => {
    render(<PlayerSegmentationChart kpis={KPI_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Player Segmentation' }));
    const dialog = await screen.findByRole('dialog', { name: 'Player Segmentation' });
    assert.deepStrictEqual(readLegends(dialog), [EXPECTED]);
    assert.ok(within(dialog).getByText('Inactive Players: 300'));
  });
});

describe('ProductDistributionChart legend', () => {
  test('keeps its one Bet Count entry on the first bar hue; the bars keep one hue per product', () => {
    serve({ data: TRENDS, loading: false }, { data: KPIS, loading: false });
    const { container } = render(<ProductDistributionChart />);

    assert.deepStrictEqual(mocks.useQuery.mock.calls[0], [DASHBOARD_KPIS_QUERY, QUERY_OPTIONS]);

    const legends = readLegends(container);
    assert.deepStrictEqual(legends, [[['Bet Count', 'kInd']]]);
    assertNoDefaultLegend(container);

    // the series is one Bar whose Cells take a hue per product, in data order
    const cells = Array.from(container.querySelectorAll('.recharts-bar-rectangle')).map((rectangle) =>
      slotOf(rectangle.querySelector('.recharts-rectangle') ?? rectangle, SERIES) ||
      slotOf(rectangle, SERIES),
    );
    assert.deepStrictEqual(cells, ['hInd', 'hRed', 'hGrn']);
    assert.equal(legends[0][0][1], SWATCH_FOR[cells[0]]);

    // the GGR footnote is unchanged
    const foot = container.getElementsByClassName(s.foot)[0];
    assert.equal(foot.textContent, 'Sports: AMT:120Casino: AMT:90Matka: AMT:30');
  });

  test('loading renders no legend', () => {
    serve({ data: undefined, loading: true }, { data: undefined, loading: true });
    const { container } = render(<ProductDistributionChart />);
    assert.equal(screen.getByRole('status').textContent, 'Loading product distribution');
    assert.equal(container.getElementsByClassName(s.legend).length, 0);
  });
});
