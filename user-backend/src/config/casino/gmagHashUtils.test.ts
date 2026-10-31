import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { computeGmagHash, verifyGmagHash } from './gmagHashUtils.js'

const secret = 'isolated-test-signing-key'
function officialHash(body: Record<string, unknown>) {
  const plain = Object.keys(body).sort().filter(key => key !== 'hash').map(key => {
    const value = body[key]
    return `${key}=${value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)}`
  }).join('&') + secret
  return createHash('md5').update(plain).digest('hex')
}
function callback(transType = 'win', amount: number | string = 1): Record<string, any> {
  return { requestId:'fixture-request', brandId:123, playerId:'1_0000', playerSessionId:'fixture-session', gameCode:'fixture-game', trans:[{seq:1, transId:'fixture-win', referenceId:'fixture-bet', roundId:'fixture-round', transType, amount, transTime:'2026-10-26T00:00:00Z'}] }
}

test('accepts exact amounts with official insertion-order and sorted-key serializers', () => {
  for (const amount of [0,1,1.25,9999.99,'1.25']) {
    const body=callback('win',amount)
    assert.equal(verifyGmagHash(body,officialHash(body),secret,JSON.stringify(body)),true)
    assert.equal(verifyGmagHash(body,computeGmagHash(body,secret),secret),true)
  }
})

for (const kind of ['bet','win','cancel','transIn','transOut']) {
  for (const amount of [0,1.25,9999.99]) {
    test(`rejects a signed ${kind} amount of 1 changed to ${amount}`, () => {
      const original=callback(kind,1), modified=callback(kind,amount)
      assert.equal(verifyGmagHash(modified,officialHash(original),secret,JSON.stringify(modified)),false)
      assert.equal(verifyGmagHash(modified,computeGmagHash(original,secret),secret),false)
    })
  }
}

test('rejects a batch whose signed amounts were replaced', () => {
  const body=callback()
  body.trans.push({...body.trans[0],transId:'second',transType:'bet'})
  const hash=officialHash(body)
  body.trans[0].amount=500;body.trans[1].amount=800
  assert.equal(verifyGmagHash(body,hash,secret,JSON.stringify(body)),false)
})

test('rejects duplicate trans keys that sign one array but process the other', () => {
  const body=callback('win',1), modified=callback('win',9999)
  const raw=JSON.stringify(body).replace(/}$/,`,"trans":${JSON.stringify(modified.trans)}}`)
  assert.equal(verifyGmagHash(JSON.parse(raw),officialHash(body),secret,raw),false)
})

test('rejects duplicate top-level payout amounts', () => {
  const body={brandId:123,requestId:'fixture-pay',playerId:'1_0000',amount:1,transId:'fixture-pay',transTime:'2026-10-26T00:00:00Z',type:'bonus'}
  const raw=JSON.stringify(body).replace(/}$/,',"amount":9999}')
  assert.equal(verifyGmagHash(JSON.parse(raw),officialHash(body),secret,raw),false)
})

test('raw JSON must represent the object being processed', () => {
  const body=callback('win',1), modified=callback('win',9999)
  assert.equal(verifyGmagHash(modified,officialHash(body),secret,JSON.stringify(body)),false)
})

test('rejects modified identity and transaction references', () => {
  const body=callback(), hash=officialHash(body)
  for (const field of ['playerId','playerSessionId','gameCode','requestId']) {
    assert.equal(verifyGmagHash({...body,[field]:'changed'},hash,secret),false)
  }
  for (const field of ['roundId','transId','referenceId','transType']) {
    assert.equal(verifyGmagHash({...body,trans:[{...body.trans[0],[field]:'changed'}]},hash,secret),false)
  }
})

test('hash matching accepts uppercase hex but refuses missing, malformed and wrong-key hashes', () => {
  const body=callback(), hash=officialHash(body)
  assert.equal(verifyGmagHash(body,hash.toUpperCase(),secret),true)
  for (const bad of ['',hash.slice(1),hash+'0','not-a-hash']) assert.equal(verifyGmagHash(body,bad,secret),false)
  assert.equal(verifyGmagHash(body,hash,secret+'wrong'),false)
})

test('raw nested JSON whitespace can be signed without changing its values', () => {
  const body=callback(), nested=JSON.stringify(body.trans,null,2)
  const raw=JSON.stringify({...body,trans:undefined}).replace(/}$/,`,"trans":${nested}}`)
  const plain=Object.keys(body).sort().map(key=>`${key}=${key==='trans'?nested:String(body[key])}`).join('&')+secret
  const hash=createHash('md5').update(plain).digest('hex')
  assert.equal(verifyGmagHash(JSON.parse(raw),hash,secret,raw),true)
})

test('raw values containing escaped quotes, brackets and nested names stay bound to their own top-level keys', () => {
  const body={...callback(),metadata:{playerId:'nested',text:'" } ], \\ end',empty:[],object:{}}}
  assert.equal(verifyGmagHash(body,officialHash(body),secret,JSON.stringify(body)),true)
})

test('duplicate keys inside a transaction are rejected even when the final parsed value has a matching hash', () => {
  const body=callback(),raw=JSON.stringify(body).replace('"amount":1','"amount":999,"amount":1')
  assert.equal(verifyGmagHash(JSON.parse(raw),officialHash(body),secret,raw),false)
})

test('escaped key names cannot conceal duplicate amounts', () => {
  const body=callback(),raw=JSON.stringify(body).replace('"amount":1','"amount":1,"\\u0061mount":1')
  assert.equal(verifyGmagHash(JSON.parse(raw),officialHash(body),secret,raw),false)
})

test('Unicode strings retain compatibility with the signed parsed body', () => {
  const body={...callback(),detailUrl:'https://isolated.invalid/\u0939\u093f\u0928\u094d\u0926\u0940'}
  const raw=JSON.stringify(body).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'))
  assert.equal(verifyGmagHash(body,officialHash(body),secret,raw),true)
})
