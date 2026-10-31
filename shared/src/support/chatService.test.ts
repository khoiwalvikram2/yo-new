import test from 'node:test'
import assert from 'node:assert/strict'
import { chatDefaults, withinDeskHours, settingsSchema, sendSchema } from './chatService.js'

test('support hours use the tenant timezone and exclude the exact closing minute',()=>{
  const s={...chatDefaults,days:[1]}
  assert.equal(withinDeskHours(s,new Date('2026-10-26T03:29:00Z')),false)
  assert.equal(withinDeskHours(s,new Date('2026-10-26T03:30:00Z')),true)
  assert.equal(withinDeskHours(s,new Date('2026-10-26T15:30:00Z')),false)
})
test('an overnight shift remains open on the morning after an enabled weekday',()=>{
  const s={...chatDefaults,days:[6],openMinute:1320,closeMinute:360}
  assert.equal(withinDeskHours(s,new Date('2026-10-24T17:00:00Z')),true)
  assert.equal(withinDeskHours(s,new Date('2026-10-24T23:30:00Z')),true)
  assert.equal(withinDeskHours(s,new Date('2026-10-25T01:00:00Z')),false)
})
test('all-day seven-day support includes Sunday',()=>{
  assert.equal(withinDeskHours({...chatDefaults,days:[1,2,3,4,5,6,7],openMinute:0,closeMinute:1440},new Date('2026-10-25T12:00:00Z')),true)
})
test('settings reject invalid timezone, empty schedule and equal hours',()=>{
  for(const patch of [{timezone:'Not/AZone'},{days:[]},{openMinute:540,closeMinute:540},{closeMinute:1500}])assert.equal(settingsSchema.safeParse({...chatDefaults,...patch}).success,false)
})
test('message validation accepts screenshot-only messages and rejects empty or excessive content',()=>{
  const id='12345678-1234-4234-8234-123456789abc'
  assert.equal(sendSchema.safeParse({clientMessageId:id,body:'   '}).success,false)
  assert.equal(sendSchema.safeParse({clientMessageId:id,attachmentIds:[id]}).success,true)
  assert.equal(sendSchema.safeParse({clientMessageId:id,body:'a'.repeat(4001)}).success,false)
})
