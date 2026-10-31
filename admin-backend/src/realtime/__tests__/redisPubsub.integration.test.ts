import 'dotenv/config'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import mqemitter from 'mqemitter-redis'
import { getRedisEmitter, closeRedisEmitter } from '../redisPubsub.js'

const publisher=getRedisEmitter()
const subscriber:any=mqemitter({connectionString:process.env.REDIS_URL||'redis://localhost:6379'})
subscriber.state.on('error',()=>{})
const prefix='ISOLATED_LOCAL_TRANSPORT_'+randomUUID()
const emit=(topic:string,payload:unknown)=>new Promise<void>((resolve,reject)=>publisher.emit({topic,payload},(err?:Error)=>err?reject(err):resolve()))
const on=(topic:string,listener:any)=>new Promise<void>(resolve=>subscriber.on(topic,listener,resolve))
const off=(topic:string,listener:any)=>new Promise<void>(resolve=>subscriber.removeListener(topic,listener,resolve))
test.after(async()=>{await new Promise<void>(resolve=>subscriber.close(resolve));await closeRedisEmitter()})

test('Redis connection errors have a state-event handler rather than a message-topic subscription',()=>{
  assert.ok(publisher.state.listenerCount('error')>0,'Redis emits operational failures through emitter.state')
  assert.doesNotThrow(()=>publisher.state.emit('error',new Error('Isolated synthetic pubsub error probe')))
  assert.equal(publisher._topics.error,undefined,'Operational errors must not create a Redis topic named error')
})

test('two actual Redis connections deliver 20 unique messages only on the requested isolated topic',{timeout:10000},async()=>{
  const topic=prefix+'_fanout',received:number[]=[]
  let complete!:()=>void
  const done=new Promise<void>(resolve=>{complete=resolve})
  const listener=(message:any,ack:()=>void)=>{received.push(message.payload.sequence);ack();if(received.length===20)complete()}
  await on(topic,listener)
  await emit(prefix+'_unrelated',{sequence:999})
  await Promise.all(Array.from({length:20},(_,sequence)=>emit(topic,{sequence})))
  await done
  assert.deepEqual([...received].sort((a,b)=>a-b),Array.from({length:20},(_,i)=>i))
  await off(topic,listener)
})

test('unsubscribing releases the isolated topic and stops delivery',{timeout:10000},async()=>{
  const topic=prefix+'_closed',barrier=prefix+'_barrier'
  let received=0,complete!:()=>void
  const done=new Promise<void>(resolve=>{complete=resolve})
  const listener=(_message:any,ack:()=>void)=>{received++;ack()}
  const barrierListener=(_message:any,ack:()=>void)=>{ack();complete()}
  await on(topic,listener);await off(topic,listener)
  await on(barrier,barrierListener)
  await emit(topic,{ignored:true});await emit(barrier,{complete:true});await done
  assert.equal(received,0)
  assert.equal(subscriber._topics[topic],undefined)
  await off(barrier,barrierListener)
})
