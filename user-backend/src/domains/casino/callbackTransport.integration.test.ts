import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { createSign, createVerify, generateKeyPairSync, randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, types, t, eq } from '../../../../tmp/domain-visibility-integration-fixtures.js'

const guard=isolateDatabase()
const providerKeys=generateKeyPairSync('rsa',{modulusLength:2048})
const responseKeys=generateKeyPairSync('rsa',{modulusLength:2048})
Object.assign(process.env,{
  CASINO_BASE_URL:'https://isolated.invalid',CASINO_PARTNER_ID:'isolated',CASINO_REDIRECT_URL:'https://isolated.invalid',
  CASINO_SECRET:providerKeys.publicKey.export({type:'spki',format:'pem'}),
  CASINO_PRIVATE_KEY:responseKeys.privateKey.export({type:'pkcs1',format:'pem'}),
  GMAG_BRAND_ID:'123',GMAG_SECRET_KEY:'isolated-callback-test-key',
})
const {db,pool}=await import('../../db/client.js')
const {registerCasinoCallbackRoutes}=await import('./casinoCallbackRoutes.js')
const {registerGmagCallbackRoutes}=await import('./gmagCallbackRoutes.js')
const {computeGmagHash}=await import('../../config/casino/gmagHashUtils.js')
const credits=new Set(['WHITELABEL_CREDIT','AGENT_CREDIT'])
const app=Fastify({logger:false})
await registerCasinoCallbackRoutes(app)
await registerGmagCallbackRoutes(app)
await app.ready()
test.before(()=>guard(pool))
test.after(async()=>{await app.close();await pool.end()})
test.afterEach(()=>mock.restoreAll())

async function setup(tx:any,provider:string,type='REGULAR') {
  const f=await fixture(tx)
  const owner=type.includes('AGENT')?await f.agent(type==='AGENT_CREDIT'?'CREDIT':type.startsWith('SHARING')?'SHARING':'COMMISSION'):undefined
  const player=await f.player(type,owner)
  if(credits.has(type))await tx.update(t.wallets).set({cash:'0'}).where(eq(t.wallets.userId,player.id))
  const [api]=await tx.insert(t.casinoApiProviders).values({key:provider,name:'Isolated HTTP QA'}).onConflictDoUpdate({target:t.casinoApiProviders.key,set:{name:'Isolated HTTP QA'}}).returning()
  const code=randomUUID(),[vendor]=await tx.insert(t.casinoVendors).values({name:'HTTP QA vendor',slug:code}).returning()
  await tx.insert(t.casinoGames).values({apiProviderId:api.id,vendorId:vendor.id,mainCategory:'casino',externalId:code,slug:code,name:'HTTP QA game'})
  const token=randomUUID()
  await tx.insert(t.userCasinoSessions).values({tenant:f.tenant,userId:player.id,token,providerKey:provider,walletType:'cash',expiresAt:new Date(Date.now()+3600000)})
  routeDbToTransaction(mock,db,tx)
  const state=async()=>({wallet:(await tx.select().from(t.wallets).where(eq(t.wallets.userId,player.id)))[0],player:(await tx.select().from(t.users).where(eq(t.users.id,player.id)))[0]})
  return {...f,player,code,token,state}
}

async function http(provider:string,url:string,body:Record<string,any>,signedBody=body,raw?:string) {
  const payload=raw??JSON.stringify(body)
  let headers:Record<string,string>={'content-type':'application/json'}
  if(provider==='gapcasino') {
    const sign=createSign('RSA-SHA256');sign.update(JSON.stringify(signedBody))
    headers.Signature=sign.sign(providerKeys.privateKey,'base64')
  } else url+='?hash='+computeGmagHash(signedBody,process.env.GMAG_SECRET_KEY!)
  const response=await app.inject({method:'POST',url,headers,payload})
  assert.equal(response.statusCode,200,response.body)
  const result=response.json()
  if(provider==='gapcasino'&&response.headers.signature) {
    const verify=createVerify('RSA-SHA256');verify.update(response.body)
    assert.equal(verify.verify(responseKeys.publicKey,String(response.headers.signature),'base64'),true,'Response bytes must match their RSA signature')
  }
  return result
}

function transaction(f:any,provider:string,kind:string,id:string,amount:unknown) {
  if(provider==='gapcasino')return {url:kind==='bet'?'/gap/betRequest':kind==='win'?'/gap/resultRequest':'/gap/rollbackRequest',body:{userId:f.player.id,token:f.token,gameId:f.code,transactionId:id,roundId:'round-'+id,reqId:kind+'-'+id,...(kind==='cancel'?{}:{[kind==='bet'?'debitAmount':'creditAmount']:amount})}}
  return {url:'/gmag/transaction',body:{brandId:123,requestId:kind+'-'+id,playerId:`${f.player.id}_0000`,playerSessionId:f.token,gameCode:f.code,trans:[{seq:1,transId:kind==='bet'?id:kind+'-'+id,referenceId:id,roundId:'round-'+id,transType:kind,amount,transTime:'2026-10-26T00:00:00Z',endRound:kind==='win'?1:0}]}}
}
function okay(provider:string,result:any) { assert.equal(provider==='gapcasino'?result.status:result.error,provider==='gapcasino'?'OP_SUCCESS':'0',JSON.stringify(result)) }

for(const provider of ['gapcasino','gmagcasino'])for(const type of types) {
  test(`${provider}/${type}: signed HTTP callbacks conserve fractional amounts and reject duplicate effects`,async()=>{
    await rollback(db,async tx=>{
      const f=await setup(tx,provider,type)
      const send=async(kind:string,id:string,amount:number)=>{const request=transaction(f,provider,kind,id,amount);return http(provider,request.url,request.body)}
      for(const [id,amount] of [['a',113.25],['b',227.5],['c',349.75]] as const)okay(provider,await send('bet',id,amount))
      const held=await f.state()
      if(credits.has(type))assert.equal(Number(held.player.creditUsed),690.5)
      else assert.equal(Number(held.wallet.cash),9309.5)
      await send('bet','a',113.25)
      const replay=await f.state()
      assert.equal(replay.wallet.cash,held.wallet.cash);assert.equal(replay.player.creditUsed,held.player.creditUsed)
      okay(provider,await send('win','a',271.5));okay(provider,await send('win','b',0));okay(provider,await send('cancel','c',349.75))
      const settled=await f.state()
      await send('win','a',271.5);await send('cancel','c',349.75)
      const after=await f.state()
      assert.equal(after.wallet.cash,settled.wallet.cash);assert.equal(after.player.settlementBalance,settled.player.settlementBalance)
      if(credits.has(type)) {
        assert.equal(Number(after.wallet.cash),0);assert.equal(Number(after.player.creditUsed),0)
        assert.equal(Number(after.player.settlementBalance),-69.25);assert.equal(Number(after.player.creditAvailable),9930.75)
      } else assert.equal(Number(after.wallet.cash),9930.75)
      const bets=await tx.select().from(t.casinoBets).where(eq(t.casinoBets.tenant,f.tenant))
      assert.deepEqual(bets.map((b:any)=>b.status).sort(),['lost','void','won'])
      assert.equal(bets.filter((b:any)=>b.status!=='void').reduce((sum:number,b:any)=>sum+Number(b.stake)-Number(b.payout??b.winAmount),0),69.25)
    })
  })
}

for(const provider of ['gapcasino','gmagcasino']) {
  test(`${provider}: changed signed debit and payout amounts are refused before any wallet update`,async()=>{
    await rollback(db,async tx=>{
      const f=await setup(tx,provider)
      const original=transaction(f,provider,'bet','original',1),modified=transaction(f,provider,'bet','original',9999)
      const before=await f.state(), result=await http(provider,modified.url,modified.body,original.body)
      assert.equal(provider==='gapcasino'?result.status:result.error,provider==='gapcasino'?'OP_INVALID_SIGNATURE':'P_02')
      assert.equal((await f.state()).wallet.cash,before.wallet.cash)
      okay(provider,await http(provider,original.url,original.body))
      const win=transaction(f,provider,'win','original',1),badWin=transaction(f,provider,'win','original',9999)
      const held=await f.state(), rejected=await http(provider,badWin.url,badWin.body,win.body)
      assert.equal(provider==='gapcasino'?rejected.status:rejected.error,provider==='gapcasino'?'OP_INVALID_SIGNATURE':'P_02')
      assert.equal((await f.state()).wallet.cash,held.wallet.cash)
    })
  })
  for(const bad of ['1junk','','Infinity','0x10']) {
    test(`${provider}: malformed numeric amount ${JSON.stringify(bad)} cannot debit or credit`,async()=>{
      await rollback(db,async tx=>{
        const f=await setup(tx,provider),before=await f.state()
        for(const kind of ['bet','win']) {
          const request=transaction(f,provider,kind,'invalid-number',bad)
          const response=await http(provider,request.url,request.body)
          assert.equal(provider==='gapcasino'?response.status:response.error,provider==='gapcasino'?'OP_INVALID_PARAMS':'P_01')
          assert.equal((await f.state()).wallet.cash,before.wallet.cash)
        }
      })
    })
  }
}

test('GMAG duplicate JSON transaction keys cannot authorize a different wallet debit',async()=>{
  await rollback(db,async tx=>{
    const f=await setup(tx,'gmagcasino'),original=transaction(f,'gmagcasino','bet','duplicate-key',1),modified=transaction(f,'gmagcasino','bet','duplicate-key',9999)
    const raw=JSON.stringify(original.body).replace(/}$/,`,"trans":${JSON.stringify((modified.body as any).trans)}}`)
    const result=await http('gmagcasino',original.url,JSON.parse(raw),original.body,raw)
    assert.equal(result.error,'P_02');assert.equal(Number((await f.state()).wallet.cash),10000)
  })
})

for(const bad of ['1junk','','Infinity','0x10']) {
  test(`GMAG payUp refuses malformed bonus amount ${JSON.stringify(bad)}`,async()=>{
    await rollback(db,async tx=>{
      const f=await setup(tx,'gmagcasino')
      const result=await http('gmagcasino','/gmag/payUp',{brandId:123,requestId:'invalid-payup',playerId:`${f.player.id}_0000`,transId:'invalid-payup',amount:bad,transTime:'2026-10-26T00:00:00Z',type:'bonus',currency:'INR'})
      assert.equal(result.error,'P_01');assert.equal(Number((await f.state()).wallet.cash),10000)
    })
  })
}
