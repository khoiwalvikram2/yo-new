// Weekly layout from the supplied UI kit, populated exclusively by API results.
export const chartDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const chartNames = { panel: 'Panel Chart', jodi: 'Jodi Chart' };
const iso = value => value.toISOString().slice(0, 10);
export function getWeeklyChart(market) {
  const monday = new Date(`${market.runDate}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7 - 49);
  const history = new Map((market.history || []).map(row => [row.date, row]));
  return Array.from({ length: 8 }, (_, week) => {
    const start = new Date(monday); start.setUTCDate(start.getUTCDate() + week * 7);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
    return { start: iso(start), end: iso(end), days: chartDays.map((_, day) => {
      const value = new Date(start); value.setUTCDate(value.getUTCDate() + day);
      const date = iso(value), row = date <= market.runDate ? history.get(date) : null;
      return { date, open: row?.openResult || '***', close: row?.closeResult || '***',
        jodi: market.kind === 'STARLINE' ? row?.openDigit || '*' : row?.jodi || (row?.openDigit != null ? `${row.openDigit}*` : '**'), published: Boolean(row?.complete) };
    }) };
  });
}
