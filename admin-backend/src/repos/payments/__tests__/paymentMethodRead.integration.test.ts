import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { getWhitelabelPaymentMethods } = await import('../whitelabelPaymentsRepo.js')
test.before(() => guard(pool)); test.after(() => pool.end()); test.afterEach(() => mock.restoreAll())

test('legacy payment accounts without stored IDs keep stable IDs across separate reads', async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx)
    await tx.insert(t.whitelabelPaymentMethods).values({ tenant:f.tenant, bankDetails:{accountName:'Isolated bank',accountNumber:'0000000000',ifsc:'TEST0000001',bankName:'Test'}, upiDetails:{upiId:'isolated@test'}, enabledMethods:['bank','upi'] })
    routeDbToTransaction(mock, db, tx)
    let tick = 1000; mock.method(Date, 'now', () => tick)
    const first = await getWhitelabelPaymentMethods(f.tenant); tick = 2000
    const second = await getWhitelabelPaymentMethods(f.tenant)
    assert.ok(first?.banks[0].id && first?.upis[0].id)
    assert.equal(first.banks[0].id, second?.banks[0].id)
    assert.equal(first.upis[0].id, second?.upis[0].id)
  })
})

test('legacy accounts with an explicit ID retain it and array accounts retain their status', async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx)
    await tx.insert(t.whitelabelPaymentMethods).values({tenant:f.tenant,bankDetails:{id:'existing-bank',accountName:'Fixture'},upiDetails:[{id:'existing-upi',upiId:'isolated@test',enabled:false}]})
    routeDbToTransaction(mock,db,tx)
    const methods=await getWhitelabelPaymentMethods(f.tenant)
    assert.equal(methods?.banks[0].id,'existing-bank');assert.equal(methods?.upis[0].id,'existing-upi');assert.equal(methods?.upis[0].enabled,false)
  })
})

test('payment method reads remain tenant scoped and an absent configuration stays absent', async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx)
    await tx.insert(t.whitelabelPaymentMethods).values({tenant:f.tenant,bankDetails:[{id:'private-bank',accountName:'Fixture'}]})
    routeDbToTransaction(mock,db,tx)
    assert.equal(await getWhitelabelPaymentMethods(f.tenant+'-foreign'),null)
  })
})
