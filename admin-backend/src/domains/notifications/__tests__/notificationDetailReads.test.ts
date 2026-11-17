import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { NotificationsRepo } from '@src/repos/notifications/notificationsRepo.js'
import { buildNotificationsQueryResolvers } from '../resolvers/queries.js'
import { notificationReadScope } from '../services/notificationReadScope.js'
const id='11111111-1111-4111-8111-111111111111'
const admin={tenant:'a',whitelabel:{id:'a'},user:{type:'admin',roles:['Whitelabel Admin']},permissions:[{domain:'notifications.list',actions:['view']}]}
afterEach(()=>mock.restoreAll())
describe('scoped direct notification reads',()=>{
  it('reads exactly one requested record and reuses task recipient/type filters',async()=>{
    let received:any
    mock.method(NotificationsRepo.prototype,'getNotifications',async filters=>{received=filters;return[{id,createdAt:new Date('2026-10-01T00:00:00Z')}] as any})
    const result=await buildNotificationsQueryResolvers().myNotification(null,{id,category:'task'},admin)
    assert.equal(result?.id,id)
    assert.deepEqual(received,{tenant:'a',whitelabelId:'a',category:'task',allowedTypes:['DEPOSIT','WITHDRAWAL'],id,limit:1,offset:0})
  })
  it('refuses a missing session or recipient identity before the repository is reached',async()=>{
    mock.method(NotificationsRepo.prototype,'getNotifications',async()=>{throw new Error('Repository must not be reached')})
    const read=buildNotificationsQueryResolvers().myNotification
    for(const ctx of [{...admin,user:undefined},{...admin,user:{type:'agent'}},{...admin,user:{type:'user'}}])await assert.rejects(read(null,{id},ctx),/Unauthorized|Forbidden/)
    await assert.rejects(read(null,{id,category:'task'},{tenant:'a',whitelabel:{id:'a'}}),/Unauthorized/)
    assert.equal(await read(null,{id:'invalid'},admin),null)
  })
  it('opens the caller\'s own notification without notifications.list, which no Whitelabel Admin or agent holds',async()=>{
    const reads:any[]=[]
    mock.method(NotificationsRepo.prototype,'getNotifications',async filters=>{reads.push(filters);return[{id,createdAt:new Date('2026-10-01T00:00:00Z')}] as any})
    const read=buildNotificationsQueryResolvers().myNotification
    assert.equal((await read(null,{id},{...admin,permissions:[]}))?.id,id)
    assert.equal((await read(null,{id},{...admin,user:{type:'agent',agentId:id},permissions:[]}))?.id,id)
    assert.deepEqual(reads,[{tenant:'a',whitelabelId:'a',id,limit:1,offset:0},{tenant:'a',agentId:id,id,limit:1,offset:0}])
  })
  it('keeps user, agent and director recipient scopes distinct',()=>{
    assert.deepEqual(notificationReadScope({...admin,user:{type:'user',userId:3}},'task'),{tenant:'a',userId:3,category:'task'})
    assert.deepEqual(notificationReadScope({...admin,user:{type:'agent',agentId:id}},'task'),{tenant:'a',agentId:id,category:'task'})
    assert.deepEqual(notificationReadScope({...admin,user:{type:'admin',roles:['Super Admin']},directorMode:'whitelabel',directorWhitelabelId:'b'},'task'),{tenant:'b',whitelabelId:'b',category:'task',allowedTypes:['DEPOSIT','WITHDRAWAL']})
  })
})
