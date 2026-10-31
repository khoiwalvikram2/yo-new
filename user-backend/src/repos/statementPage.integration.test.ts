import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { isolateDatabase, rollback, routeDbToTransaction, t, eq } from '../../../tmp/domain-visibility-integration-fixtures.js'
import { seedStatements } from '../../../tmp/statements-qa-fixtures.js'
const guard=isolateDatabase()
const {db,pool}=await import('../db/client.js')
const {getStatementPage}=await import('./statementPageRepo.js')
test.before(()=>guard(pool));test.after(()=>pool.end());test.afterEach(()=>mock.restoreAll())
async function scenario(fn:(f:any,read:(domain:any,extra?:any)=>Promise<any>,tx:any)=>Promise<void>){
  await rollback(db,async tx=>{
    const f=await seedStatements(tx);routeDbToTransaction(mock,db,tx)
    mock.method(pool,'query',(...args:any[])=> (tx as any).session.client.query(...args))
    const read=(domain:any,extra:any={})=>getStatementPage(f.player.id,f.tenant,{domain,startDate:new Date(f.now.getTime()-86400000).toISOString(),endDate:new Date(f.now.getTime()+86400000).toISOString(),pageSize:100,...extra})
    await fn(f,read,tx);mock.restoreAll()
  })
}
test('wallet excludes all three betting domains while retaining correctly signed deposits/withdrawals',async()=>scenario(async(_f,read)=>{
  const page=await read('WALLET');assert.equal(page.meta.total,2);assert.equal(page.data.length,2)
  assert.deepEqual(page.walletTypes,['Manual Deposit','Manual Withdrawal']);assert.deepEqual(page.data.map((row:any)=>row.amount).sort((a:number,b:number)=>a-b),[-100,1000])
}))
test('Matka statements expose market, selection, session, multiplier and separate gross payout from net P/L',async()=>scenario(async(f,read)=>{
  const page=await read('MATKA');assert.equal(page.meta.total,4)
  const won=page.data.find((row:any)=>row.status==='won'),lost=page.data.find((row:any)=>row.status==='lost'),active=page.data.find((row:any)=>row.status==='active'),voided=page.data.find((row:any)=>row.status==='void')
  assert.equal(won.payout,100000);assert.equal(won.pl,99900);assert.equal(lost.payout,0);assert.equal(lost.pl,-100)
  assert.equal(active.payout,null);assert.equal(active.pl,null);assert.equal(voided.payout,100);assert.equal(voided.pl,0)
  assert.equal(won.marketId.marketName,f.market.name);assert.equal(won.selectionName,'222');assert.equal(won.eventResult,'222');assert.equal(won.runDate,'2026-10-25');assert.equal(won.session,'open');assert.equal(won.payoutMultiplier,1000)
}))
test('Casino status/filter/hydration agree for active, break-even wins, losses, void and cancelled rounds',async()=>scenario(async(_f,read)=>{
  for(const [filter,status,pl] of [['Pending','active',null],['Win','won',0],['Lose','lost',-100],['Void','void',0],['Cancelled','cancelled',0]]){
    const page=await read('CASINO',{status:filter});assert.equal(page.meta.total,1);assert.equal(page.data[0].status,status);assert.equal(page.data[0].pl,pl)
  }
}))
test('Sports void/cancelled results ignore stale negative P/L, while matched/win/loss remain accurate',async()=>scenario(async(_f,read)=>{
  for(const [filter,status,pl] of [['Matched','matched',0],['Win','won',100],['Lose','lost',-100],['Void','void',0],['Cancelled','cancelled',0]]){
    const page=await read('SPORTS',{status:filter});assert.equal(page.meta.total,1);assert.equal(page.data[0].status,status);assert.equal(page.data[0].pl,pl)
  }
}))
test('Matka paging/search/status/session filters and tenant/user scope cannot leak or truncate rows',async()=>scenario(async(f,read,tx)=>{
  assert.equal((await read('MATKA',{status:'Lose'})).data[0].pl,-100)
  assert.equal((await read('MATKA',{search:'333'})).meta.total,1)
  assert.equal((await read('MATKA',{type:'close'})).meta.total,0)
  const page=await read('MATKA',{page:99,pageSize:3});assert.equal(page.meta.page,2);assert.equal(page.data.length,1);assert.equal(page.meta.total,4)
  const raw={domain:'MATKA' as const,startDate:'2020-01-01T00:00:00Z',endDate:'2099-01-01T00:00:00Z'}
  assert.equal((await getStatementPage(f.player.id,f.tenant+'-foreign',raw)).meta.total,0)
  assert.equal((await getStatementPage(f.player.id+10000000,f.tenant,raw)).meta.total,0)
  assert.equal((await read('MATKA',{search:"' OR 1=1 --"})).meta.total,0)
  const [before]=await tx.select().from(t.wallets).where(eq(t.wallets.id,f.wallet.id));assert.equal(Number(before.cash),10000)
}))
