/** SQL projection regression: temporary CTEs shadow the source tables for this SELECT only.
 * No fixture inserts, schema changes, bets or financial writes are performed.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { pool } from '@src/db/client.js'
import { getPlayerTransactionsPage } from '../playerTransactionsPageRepo.js'

const tenant = process.env.BET_PAGINATION_TEST_TENANT
describe('complete player transaction projection', { skip: !tenant }, () => {
  const original = pool.query.bind(pool)
  const fixtures = `
    wallets AS (SELECT (jsonb_populate_record(null::public.wallets,
      jsonb_build_object('id',n,'tenant',$1::text,'user_id',CASE WHEN n=1 THEN 7 ELSE 8 END,'currency','INR'))).* FROM generate_series(1,2)n),
    ledger_entries AS (SELECT (jsonb_populate_record(null::public.ledger_entries,
      jsonb_build_object('id',n,'tenant',$1::text,'wallet_id',CASE WHEN n<=2000 THEN 1 ELSE 2 END,'type','credit',
      'amount',100,'balance_before',0,'balance_after',100,'created_at','2026-10-01T12:00:00Z',
      'meta',jsonb_build_object('type','deposit','method','UPI','reference',CASE WHEN n=1501 THEN 'needle-only' ELSE 'deposit' END,
        'originalAmount',CASE WHEN n=2 THEN 'invalid old metadata' ELSE '100' END)))).* FROM generate_series(1,2001)n),
    deposit_requests AS (SELECT (jsonb_populate_record(null::public.deposit_requests,
      jsonb_build_object('id',n,'tenant',$1::text,'user_id',7,'amount',100,'currency','INR','method','UPI',
      'status',CASE WHEN n=1 THEN 'APPROVED' ELSE 'PENDING' END,'wallet_txn_id',CASE WHEN n=1 THEN 1 END,
      'created_at','2026-10-01T12:00:00Z'))).* FROM generate_series(1,11)n),
    withdrawal_requests AS (SELECT (jsonb_populate_record(null::public.withdrawal_requests,
      jsonb_build_object('id',1,'tenant',$1::text,'user_id',7,'amount',200,'currency','INR','status','PENDING',
      'created_at','2026-10-01T12:00:00Z'))).*),
    agent_credit_ledger AS (SELECT (jsonb_populate_record(null::public.agent_credit_ledger,
      jsonb_build_object('id','00000000-0000-4000-8000-'||lpad(n::text,12,'0'),'tenant_id',$1::text,
      'to_entity_type','player','to_entity_id','7','from_entity_type','agent','from_entity_id','fixture-agent',
      'transaction_type',CASE WHEN n=2 THEN 'USAGE' ELSE 'ADJUSTMENT' END,'amount',500,'currency','INR',
      'created_at','2026-10-01T12:00:00Z'))).* FROM generate_series(1,3)n),
  `
  before(() => {
    ;(pool as any).options.options += ' -c default_transaction_read_only=on'
    ;(pool as any).query = (query: any, ...rest: any[]) => {
      const text = typeof query === 'string' ? query : query.text
      if (/WITH ledger_base AS/.test(text)) {
        const replacement = text.replace('WITH ledger_base AS', `WITH ${fixtures} ledger_base AS`)
        return (original as any)(typeof query === 'string' ? replacement : { ...query, text: replacement }, ...rest)
      }
      return (original as any)(query, ...rest)
    }
  })
  after(async () => { (pool as any).query = original; await pool.end() })

  it('returns every record once, with a stable total and correct last/beyond pages', async () => {
    const ids: string[] = []
    for (let offset=0; offset<2500; offset+=500) {
      const page = await getPlayerTransactionsPage(tenant!,7,{limit:500,offset},true)
      assert.equal(page.total,2013)
      assert.equal(page.items.length,Math.min(500,Math.max(0,2013-offset)))
      assert.equal(page.hasMore,offset+500<2013)
      ids.push(...page.items.map((r:any)=>r.id))
    }
    assert.equal(new Set(ids).size,2013)
    assert.ok(ids.includes('ledger_1'))
    assert.ok(!ids.includes('deposit_1'))
    assert.ok(ids.includes('deposit_2') && ids.includes('deposit_11'), 'same-amount/time requests must remain distinct')
    assert.ok(!ids.includes('ledger_2001'), 'another player wallet must remain excluded')
    const beyond=await getPlayerTransactionsPage(tenant!,7,{limit:20,offset:3000},true)
    assert.equal(beyond.total,2013);assert.equal(beyond.items.length,0)
  })
  it('filters the complete union before paging, including records beyond the old 1000 cap',async()=>{
    const page=await getPlayerTransactionsPage(tenant!,7,{search:'needle-only',limit:20,offset:0},true)
    assert.equal(page.total,1);assert.equal(page.items[0].id,'ledger_1501')
    const pending=await getPlayerTransactionsPage(tenant!,7,{status:'pending',limit:20},true)
    assert.equal(pending.total,11)
    assert.equal((await getPlayerTransactionsPage(tenant!,7,{type:'deposit',status:'completed',limit:20},true)).total,2000)
    assert.equal((await getPlayerTransactionsPage(tenant!,7,{amountMin:200,limit:20},true)).total,3)
    assert.equal((await getPlayerTransactionsPage(tenant!,7,{dateFrom:'2030-01-01',limit:20},true)).total,0)
  })
  it('honors credit permission and excludes credit exposure movements',async()=>{
    assert.equal((await getPlayerTransactionsPage(tenant!,7,{limit:20},false)).total,2011)
    const page=await getPlayerTransactionsPage(tenant!,7,{type:'adjustment',limit:20},true)
    assert.equal(page.total,2)
    assert.ok(page.items.every((r:any)=>JSON.parse(r.metadata).transactionType==='ADJUSTMENT'))
  })
})
