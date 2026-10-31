const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-source.cjs');
const load = loader({ '@/lib/currency': { formatAmount: value => Number(value).toFixed(2), formatWholeAmount: value => String(Math.round(value)) } });
const { asKitMarket, asKitEntry, matkaChartRange } = load('src/features/matka/model.ts');
const { getGameNumbers, generateMotorNumbers } = load('src/features/matka/kit/market-data.js');
const { getWeeklyChart } = load('src/features/matka/kit/chart-data.js');
const { money } = load('src/features/matka/kit/data.js');
function market(kind = 'WORLI') {
  return { id: 'qa', code: 'qa', name: 'QA Market', kind, timezone: 'Asia/Kolkata', runDate: '2026-10-25', status: 'Open',
    result: { openResult: '267', openDigit: '5', closeResult: '279', closeDigit: '8', jodi: '58' },
    sessions: ['OPEN','CLOSE'].map(side => ({side, enabled:true,accepting:true,lockAt:'2026-10-25T10:00:00Z',resultAt:'2026-10-25T10:15:00Z'})),
    rates: ['SINGLE','JODI','SINGLE_PANNA','DOUBLE_PANNA','TRIPLE_PANNA','HALF_SANGAM','FULL_SANGAM'].map(bidType=>({bidType,label:bidType,payoutMultiplier:9})) };
}
test('Matka kit offers all fourteen configured Worli forms and combination availability follows Open', () => {
  const raw=market(), kit=asKitMarket(raw); assert.equal(kit.games.length,14); assert.equal(kit.result,'267 – 58 – 279');
  raw.sessions[0].accepting=false;const locked=asKitMarket(raw);
  assert.equal(locked.accepts(locked.games.find(game=>game.id==='jodi'),'Close'),false);
  assert.equal(locked.accepts(locked.games.find(game=>game.id==='single'),'Close'),true);
});
test('missing rates leave the full Worli catalogue visible and prevent every entry', () => {
  const raw = market(); raw.rates = [];
  const kit = asKitMarket(raw);
  assert.equal(kit.games.length, 14);
  for (const game of kit.games) {
    assert.equal(game.rateConfigured, false);
    assert.equal(game.rateDisplay, 'Payout rate pending');
    assert.equal(kit.accepts(game, 'Open'), false);
    assert.equal(kit.accepts(game, 'Close'), false);
  }
});
test('partial rates enable only their own forms and require all three rates for combined Pana', () => {
  const raw = market(); raw.rates = raw.rates.filter(rate => rate.bidType === 'SINGLE_PANNA');
  const kit = asKitMarket(raw);
  assert.equal(kit.games.length, 14);
  assert.deepEqual(Array.from(kit.games.filter(game => game.rateConfigured), game => game.id), ['single-patti', 'single-patti-bulk', 'sp-motor']);
  assert.equal(kit.accepts(kit.games.find(game => game.id === 'sp-motor'), 'Open'), true);
  assert.equal(kit.accepts(kit.games.find(game => game.id === 'sp-dp-tp'), 'Open'), false);
  raw.rates = raw.rates.map(rate => ({ ...rate, payoutMultiplier: 0 }));
  assert.equal(asKitMarket(raw).games.some(game => game.rateConfigured), false);
});
test('each market kind shows only its supported forms even without configured rates', () => {
  for (const [kind, count] of [['WORLI', 14], ['STARLINE', 10], ['JACKPOT', 2], ['SATTA_MATKA', 3]]) {
    const raw = market(kind); raw.rates = [];
    const kit = asKitMarket(raw);
    assert.equal(kit.games.length, count);
    assert.ok(kit.games.every(game => !game.rateConfigured));
  }
  const raw = market('JACKPOT');
  const kit = asKitMarket(raw);
  assert.equal(kit.accepts(kit.games[0], 'Open'), false);
  assert.equal(kit.accepts(kit.games[0], 'Close'), true);
  raw.sessions[1].enabled = false;
  assert.equal(asKitMarket(raw).accepts(kit.games[0], 'Close'), false);
});
test('canonical kit numbers retain leading zeroes and generate valid SP/DP families', () => {
  assert.equal(getGameNumbers('jodi')[0],'00'); assert.equal(getGameNumbers('single-patti').length,120);
  assert.equal(getGameNumbers('double-patti').length,90); assert.equal(getGameNumbers('triple-patti').length,10);
  assert.deepEqual(Array.from(generateMotorNumbers('sp-motor',['2','6','7'])),['267']);
});
test('weekly chart uses only supplied results and leaves all missing dates unpublished', () => {
  const kit=asKitMarket(market(),[{date:'2026-10-25',openResult:'267',closeResult:'279',jodi:'58',complete:true}]);
  const days=getWeeklyChart(kit).flatMap(week=>week.days);assert.equal(days.filter(day=>day.published).length,1);
  assert.equal(days.find(day=>day.date==='2026-10-25').jodi,'58');assert.equal(days.find(day=>day.date==='2026-10-24').jodi,'**');
  assert.equal(matkaChartRange('2026-10-25').from,'2026-08-31');
});
test('history preserves fractional amounts, payout and net profit', () => {
  const entry=asKitEntry({amount:10.25,actualWin:92.25,netProfit:82,status:'won',createdAt:'2026-10-25T04:00:00Z',bidType:'SINGLE',selection:'0',session:'OPEN',runDate:'2026-10-25'},'Asia/Kolkata');
  assert.equal(entry.number,'0');assert.equal(entry.actualWin,92.25);assert.equal(entry.timezoneLabel,'IST');assert.equal(money(10.25),'10.25');
});
