// The menu labels/order follow the user's market-selection screenshot.
// Form variants share canonical numbers; live rates, sessions and limits come from the API.
export const gameTypes = [
  { id: 'single', label: 'Single Digit', short: 'Single', digits: 1, icon: 'die-one', accent: '#e96d32', description: '0–9 · Select digits', group: 'Digits' },
  { id: 'single-bulk', base: 'single', label: 'Single Digit Bulk', short: 'Single bulk', digits: 1, bulk: true, icon: 'die-one', accent: '#0863ac', description: 'Individual amount per digit', group: 'Bulk' },
  { id: 'jodi', label: 'Jodi Digits', short: 'Jodi', digits: 2, closeOnly: true, icon: 'die-three', accent: '#42b2c9', description: '00–99 · Select pairs', group: 'Digits' },
  { id: 'jodi-bulk', base: 'jodi', label: 'Jodi Digits Bulk', short: 'Jodi bulk', digits: 2, closeOnly: true, bulk: true, icon: 'die-three', accent: '#d938ac', description: 'Individual amount per pair', group: 'Bulk' },
  { id: 'single-patti', label: 'Single Pana', short: 'SP', digits: 3, icon: 'card', accent: '#1bb777', description: '120 single Pana combinations', group: 'Pana' },
  { id: 'single-patti-bulk', base: 'single-patti', label: 'Single Pana Bulk', short: 'SP bulk', digits: 3, bulk: true, icon: 'card', accent: '#42b2c9', description: 'Individual amount per Pana', group: 'Bulk' },
  { id: 'double-patti', label: 'Double Pana', short: 'DP', digits: 3, icon: 'cards', accent: '#8b268e', description: '90 double Pana combinations', group: 'Pana' },
  { id: 'double-patti-bulk', base: 'double-patti', label: 'Double Pana Bulk', short: 'DP bulk', digits: 3, bulk: true, icon: 'cards', accent: '#6333cb', description: 'Individual amount per Pana', group: 'Bulk' },
  { id: 'triple-patti', label: 'Triple Pana', short: 'TP', digits: 3, icon: 'cards', accent: '#41a944', description: '10 triple Pana combinations', group: 'Pana' },
  { id: 'sp-motor', base: 'single-patti', label: 'SP Motor', short: 'SP Motor', digits: 3, motor: true, icon: 'motor', accent: '#e96d32', description: 'Generate SP from chosen digits', group: 'Motor' },
  { id: 'dp-motor', base: 'double-patti', label: 'DP Motor', short: 'DP Motor', digits: 3, motor: true, icon: 'wheel', accent: '#269d33', description: 'Generate DP from chosen digits', group: 'Motor' },
  { id: 'sp-dp-tp', label: 'SP, DP, TP', short: 'SP / DP / TP', digits: 3, combined: true, icon: 'motor', accent: '#039cc9', description: 'All three Pana types together', group: 'Pana' },
  { id: 'half-sangam', label: 'Half Sangam Digits', short: 'Half Sangam', combination: true, closeOnly: true, icon: 'wheel', accent: '#02a8bd', description: 'Combine a single digit & Pana', group: 'Sangam' },
  { id: 'full-sangam', label: 'Full Sangam Digits', short: 'Full Sangam', combination: true, closeOnly: true, icon: 'wheel', accent: '#0863ac', description: 'Combine open & close Pana', group: 'Sangam' },
  { id: 'ab', label: 'AB Digits', short: 'AB', digits: 2, closeOnly: true, icon: 'die-three', accent: '#0863ac', description: '00-99 / Match both result digits', group: 'Digits' },
  { id: 'a', label: 'A Digit', short: 'A', digits: 1, closeOnly: true, icon: 'die-one', accent: '#e96d32', description: '0-9 / Match the first result digit', group: 'Digits' },
  { id: 'b', label: 'B Digit', short: 'B', digits: 1, closeOnly: true, icon: 'die-one', accent: '#1bb777', description: '0-9 / Match the second result digit', group: 'Digits' },
];

export function getGameNumbers(gameId) {
  const game = gameTypes.find(item => item.id === gameId);
  if (game?.base) return getGameNumbers(game.base);
  if (gameId === 'sp-dp-tp') return ['single-patti', 'double-patti', 'triple-patti'].flatMap(getGameNumbers);
  if (gameId === 'ab') return getGameNumbers('jodi');
  if (gameId === 'a' || gameId === 'b') return getGameNumbers('single');
  if (gameId === 'single') return Array.from({ length: 10 }, (_, i) => String(i));
  if (gameId === 'jodi') return Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0'));
  if (gameId === 'triple-patti') return Array.from({ length: 10 }, (_, i) => String(i).repeat(3));
  if (!['single-patti', 'double-patti'].includes(gameId)) return [];
  const digits = '1234567890';
  const numbers = [];
  for (let a = 0; a < 10; a++) {
    for (let b = a; b < 10; b++) {
      for (let c = b; c < 10; c++) {
        const distinct = new Set([a, b, c]).size;
        if (distinct === (gameId === 'single-patti' ? 3 : 2)) numbers.push(`${digits[a]}${digits[b]}${digits[c]}`);
      }
    }
  }
  return numbers;
}

export function generateMotorNumbers(gameId, digits) {
  const game = gameTypes.find(item => item.id === gameId);
  if (!game?.motor) return [];
  const selected = new Set(digits);
  return getGameNumbers(game.base).filter(number => [...number].every(digit => selected.has(digit)));
}


export function getMarketHistory(market) {
  return [...(market.history || [])].sort((a, b) => b.date.localeCompare(a.date)).map(row => ({ date: row.date, open: row.openResult || '***', jodi: market.kind === 'STARLINE' ? row.openDigit || '*' : row.jodi || `${row.openDigit ?? '*'}${row.closeDigit ?? '*'}`, close: row.closeResult || '***' }));
}
