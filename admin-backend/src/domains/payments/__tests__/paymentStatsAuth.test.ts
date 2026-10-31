import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { db } from '@src/db/client.js'
import { AgentsRepo } from '@src/repos/agents/AgentsRepo.js'
import { depositsQueryResolvers } from '@src/domains/deposits/resolvers/queries.js'
import { paymentsQueryResolvers } from '../resolvers/queries.js'
afterEach(()=>mock.restoreAll())
describe('full-dataset payment statistics access',()=>{
  it('refuses denied and anonymous callers before an aggregate read',async()=>{
    mock.method(db,'select',()=>{throw new Error('No SQL for a denied read')})
    for(const read of [depositsQueryResolvers.adminDepositRequestStats,paymentsQueryResolvers.adminWithdrawalRequestStats,paymentsQueryResolvers.adminPayoutAccountStats]){
      await assert.rejects(read(null,{},{}),/Unauthorized/)
      await assert.rejects(read(null,{},{user:{type:'admin'},permissions:[]}),/Forbidden/)
    }
  })
  it('keeps Commission agents excluded from deposit and withdrawal card data',async()=>{
    mock.method(AgentsRepo.prototype,'findById',async()=>({schemeType:'COMMISSION'}) as any)
    mock.method(db,'select',()=>{throw new Error('No SQL for a Commission payment read')})
    const ctx={user:{type:'agent',agentId:'a'},permissions:[{domain:'all',actions:['*']}]}
    await assert.rejects(depositsQueryResolvers.adminDepositRequestStats(null,{},ctx),/Commission agents/)
    await assert.rejects(paymentsQueryResolvers.adminWithdrawalRequestStats(null,{},ctx),/Commission agents/)
  })
})
