/**
 * The overview charts' series declarations and legends (task 410). recharts 3.10 sorts its default legend by
 * name, which put GGR first on Revenue Trends and gave it Turnover's swatch; these pin the declared order and
 * the slot each entry carries, so a legend drawn from them cannot drift from its series.
 */
import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  HUE_RAMP,
  PRODUCT_DISTRIBUTION_SERIES,
  PRODUCT_REVENUE_SERIES,
  REVENUE_SERIES,
  categoryLegend,
  categorySlot,
  seriesLegend,
} from './chartLegendModel';

/** What recharts' default legend would have listed: the names sorted (lodash sortBy on 'value'). */
const sortedByName = (names: string[]) => [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

describe('series declarations', () => {
  test('Revenue Trends: Turnover, GGR, NGR on the indigo ramp in order (the mockup legend, M:1777-1780)', () => {
    assert.deepStrictEqual(REVENUE_SERIES, [
      { key: 'turnover', name: 'Turnover', slot: 's1' },
      { key: 'ggr', name: 'GGR', slot: 's2' },
      { key: 'ngr', name: 'NGR', slot: 's3' },
    ]);
  });

  test('Product Revenue: Sports, Casino, Matka on the indigo ramp in order, keyed by their data keys', () => {
    assert.deepStrictEqual(PRODUCT_REVENUE_SERIES, [
      { key: 'Sports', name: 'Sports', slot: 's1' },
      { key: 'Casino', name: 'Casino', slot: 's2' },
      { key: 'Matka', name: 'Matka', slot: 's3' },
    ]);
  });

  test('Product Distribution: one Bet Count series on the first hue', () => {
    assert.deepStrictEqual(PRODUCT_DISTRIBUTION_SERIES, [{ key: 'bets', name: 'Bet Count', slot: 'hInd' }]);
  });
});

describe('seriesLegend', () => {
  test('keeps the declared order where recharts would have sorted by name', () => {
    const legend = seriesLegend(REVENUE_SERIES);
    assert.deepStrictEqual(
      legend.map((entry) => entry.label),
      ['Turnover', 'GGR', 'NGR'],
    );
    // the order recharts 3.10 drew, and the reason this legend exists
    assert.deepStrictEqual(sortedByName(['Turnover', 'GGR', 'NGR']), ['GGR', 'NGR', 'Turnover']);
  });

  test('each entry takes its own series key and slot, never a position', () => {
    for (const series of [REVENUE_SERIES, PRODUCT_REVENUE_SERIES, PRODUCT_DISTRIBUTION_SERIES]) {
      const legend = seriesLegend(series);
      assert.equal(legend.length, series.length);
      for (const entry of legend) {
        const own = series.find((item) => item.key === entry.key);
        assert.ok(own, `${entry.key} is a declared series`);
        assert.equal(entry.slot, own.slot, `${entry.label} wears its own series' slot`);
        assert.equal(entry.label, own.name);
      }
    }
    assert.deepStrictEqual(
      seriesLegend(PRODUCT_REVENUE_SERIES).map(({ label, slot }) => [label, slot]),
      [
        ['Sports', 's1'],
        ['Casino', 's2'],
        ['Matka', 's3'],
      ],
    );
  });

  test('a series list given in another order keeps that order and each series keeps its slot', () => {
    const reversed = [...REVENUE_SERIES].reverse();
    assert.deepStrictEqual(
      seriesLegend(reversed).map(({ key, slot }) => [key, slot]),
      [
        ['ngr', 's3'],
        ['ggr', 's2'],
        ['turnover', 's1'],
      ],
    );
    assert.deepStrictEqual(seriesLegend([]), []);
  });
});

describe('categorySlot and categoryLegend', () => {
  test('the hue ramp is the mockup four-step order and cycles after the fourth row', () => {
    assert.deepStrictEqual(HUE_RAMP, ['hInd', 'hRed', 'hGrn', 'hVio']);
    assert.deepStrictEqual(
      [0, 1, 2, 3, 4, 5, 8].map(categorySlot),
      ['hInd', 'hRed', 'hGrn', 'hVio', 'hInd', 'hRed', 'hInd'],
    );
    // never undefined, whatever index arrives
    assert.equal(categorySlot(-1), 'hVio');
    assert.equal(categorySlot(2.7), 'hGrn');
  });

  test('lists the rows in data order, each on the slot of its own slice, with a custom label', () => {
    const rows = [
      { name: 'New Players', value: 40 },
      { name: 'Active Players', value: 1200 },
      { name: 'First Time Depositors', value: 15 },
      { name: 'Inactive Players', value: 300 },
    ];
    const legend = categoryLegend(rows, (row) => `${row.name}: ${row.value.toLocaleString('en-US')}`);
    assert.deepStrictEqual(legend, [
      { key: 'New Players', label: 'New Players: 40', slot: 'hInd' },
      { key: 'Active Players', label: 'Active Players: 1,200', slot: 'hRed' },
      { key: 'First Time Depositors', label: 'First Time Depositors: 15', slot: 'hGrn' },
      { key: 'Inactive Players', label: 'Inactive Players: 300', slot: 'hVio' },
    ]);
    // recharts would have listed Active Players first, on New Players' hue
    assert.equal(sortedByName(rows.map((row) => row.name))[0], 'Active Players');
    legend.forEach((entry, index) => assert.equal(entry.slot, categorySlot(index)));
  });

  test('labels default to the row name', () => {
    assert.deepStrictEqual(categoryLegend([{ name: 'Sports' }, { name: 'Casino' }]), [
      { key: 'Sports', label: 'Sports', slot: 'hInd' },
      { key: 'Casino', label: 'Casino', slot: 'hRed' },
    ]);
  });
});
