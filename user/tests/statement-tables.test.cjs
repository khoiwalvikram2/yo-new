const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url:'http://localhost/' });
for (const key of ['window','document','navigator','HTMLElement']) Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?dom.window:dom.window[key]});
const React = require('react');
const { render, cleanup } = require('@testing-library/react');
const { loader } = require('./load-source.cjs');
const load = loader({ '@/lib/currency':{formatAmount:(value,currency='INR')=>`${currency} ${value.toFixed(2)}`} });
test.afterEach(cleanup);
test('wallet debit/credit direction comes from the signed movement, including named adjustment types',()=>{
  const Wallet = load('src/components/statements/WalletTable.tsx').default;
  const base={dateISO:'2026-10-25T00:00:00Z',status:'Success'};
  const view=render(React.createElement(Wallet,{rows:[{...base,id:'a',type:'Adjustment',amount:100,direction:'debit'},{...base,id:'b',type:'Credit',amount:100,direction:'credit'},{...base,id:'c',type:'No movement',amount:0,direction:'neutral'}]}));
  const amounts=view.container.querySelectorAll('td.c-amount');assert.ok(amounts[0].classList.contains('is-debit'));assert.equal(amounts[0].textContent,'−INR 100.00');assert.equal(amounts[1].textContent,'+INR 100.00');assert.ok(amounts[2].classList.contains('is-void'));
});
test('casino pending P/L is not a loss and a zero net win does not get a profit colour',()=>{
  const Casino=load('src/components/statements/CasinoTable.tsx').default,base={dateISO:'2026-10-25T00:00:00Z',title:'Game',market:'Vendor',stake:100};
  const view=render(React.createElement(Casino,{rows:[{...base,id:'a',result:'Pending',payout:0},{...base,id:'b',result:'Win',payout:0},{...base,id:'c',result:'Void',payout:0}]}));
  const amounts=view.container.querySelectorAll('td.c-pl');assert.equal(amounts[0].textContent,'—');assert.ok(!amounts[1].classList.contains('is-up'));assert.ok(!amounts[2].classList.contains('is-down'));
});
test('Matka statements distinguish gross payout, net profit, losing stake and awaiting results',()=>{
  const Matka=load('src/components/statements/MatkaTable.tsx').default,base={dateISO:'2026-10-25T00:00:00Z',market:'SRIDEVI NIGHT',runDate:'2026-10-25',session:'open',bidType:'TRIPLE_PANNA',selection:'222',stake:100,multiplier:1000,walletType:'cash',currency:'INR',eventResult:'222'};
  const view=render(React.createElement(Matka,{rows:[{...base,id:'a',result:'Win',payout:100000,pl:99900},{...base,id:'b',result:'Lose',payout:0,pl:-100},{...base,id:'c',result:'Pending',payout:null,pl:null}]}));
  const rows=view.container.querySelectorAll('tbody tr');assert.equal(rows[0].querySelector('.c-return').textContent,'INR 100000.00');assert.equal(rows[0].querySelector('.c-pl').textContent,'+INR 99900.00');assert.equal(rows[1].querySelector('.c-pl').textContent,'INR -100.00');assert.equal(rows[2].querySelector('.c-return').textContent,'—');assert.equal(rows[2].querySelector('.c-pl').textContent,'—');assert.match(rows[0].textContent,/SRIDEVI NIGHT/);
});
