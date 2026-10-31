import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { commonSubscriptionResolvers } from '../resolvers/subscriptions.js'

test.afterEach(()=>mock.restoreAll())

function timers() {
  let tick=()=>{},cleared=0
  const timer={} as ReturnType<typeof setInterval>
  mock.method(globalThis,'setInterval',(callback:()=>void)=>{tick=callback;return timer})
  mock.method(globalThis,'clearInterval',()=>{cleared++})
  return {tick:()=>tick(),cleared:()=>cleared}
}

test('cancelling heartbeat stops its timer and closes the original pubsub iterator once',async()=>{
  const clock=timers()
  let released=0
  const original={return:async function(){assert.equal(this,original);released++;return {done:true,value:undefined}}}
  const iterator=await commonSubscriptionResolvers.heartbeat.subscribe(null,null,{pubsub:{subscribe:async()=>original,publish:async()=>{}}})
  await Promise.all([iterator.return(),iterator.return()])
  assert.equal(clock.cleared(),1)
  assert.equal(released,1,'Disconnect must release the emitter subscription')
})

test('a pubsub iterator without return still stops the heartbeat timer',async()=>{
  const clock=timers()
  const iterator=await commonSubscriptionResolvers.heartbeat.subscribe(null,null,{pubsub:{subscribe:async()=>({}),publish:async()=>{}}})
  assert.equal((await iterator.return()).done,true)
  assert.equal(clock.cleared(),1)
})

test('Mercurius-style Readable subscriptions close through their actual async iterator',async()=>{
  const clock=timers()
  const stream=new Readable({objectMode:true,read(){}})
  stream.push({heartbeat:'fixture'})
  const subscription=await commonSubscriptionResolvers.heartbeat.subscribe(null,null,{pubsub:{subscribe:async()=>stream,publish:async()=>{}}})
  const iterator=subscription[Symbol.asyncIterator]()
  assert.deepEqual((await iterator.next()).value,{heartbeat:'fixture'})
  await iterator.return()
  assert.equal(clock.cleared(),1,'GraphQL closes the async iterator, not a return property added to the stream')
  assert.equal(stream.destroyed,true)
})

for(const mode of ['throw','reject']) {
  test(`heartbeat tolerates a ${mode} from a closed pubsub without an unhandled failure`,async()=>{
    const clock=timers()
    let published=0
    const iterator=await commonSubscriptionResolvers.heartbeat.subscribe(null,null,{pubsub:{subscribe:async()=>({return:async()=>({done:true})}),publish:()=>{published++;if(mode==='throw')throw new Error('closed');return Promise.reject(new Error('closed'))}}})
    clock.tick()
    await new Promise(resolve=>setImmediate(resolve))
    await iterator.return()
    clock.tick()
    await new Promise(resolve=>setImmediate(resolve))
    assert.equal(published,1,'An already queued tick must not publish after cancellation')
  })
}
