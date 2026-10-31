import { formatAmount, formatWholeAmount } from '@/lib/currency';
// Formatting only. Markets, balances, entries and chart results come from APIs.
export const money = (value, decimals = true) => decimals ? formatAmount(Number(value || 0)) : formatWholeAmount(Number(value || 0));
export const displayDate = date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '—';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
