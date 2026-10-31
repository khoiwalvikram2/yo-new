import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scanDocuments } from './graphqlDocScan.js'

test('ignores backticks in comments and quoted source examples', () => {
  const source = '/** The `query` variable. Example: `query Fake { missing }`. */\n' +
    '// `mutation Comment { fake }`\n' + 'const note = "Example `query Quoted { fake }`";\n' +
    'const real = gql`query Actual { users { id } }`'
  assert.deepEqual(scanDocuments(source), [{ body: 'query Actual { users { id } }', resolved: true }])
})
test('resolves nested same-file field templates and both tagged and bare operations', () => {
  const source = 'const BASE = `id`; const FIELDS = `${BASE} name`;\n' +
    'const tagged = gql`query Tagged { users { ${FIELDS} } }`;\n' +
    'const bare: string = /* GraphQL */ `mutation Bare { create { ${FIELDS} } }`'
  assert.deepEqual(scanDocuments(source), [
    { body: 'query Tagged { users { id name } }', resolved: true },
    { body: 'mutation Bare { create { id name } }', resolved: true },
  ])
})
test('does not hide incomplete operations or unresolved interpolation', () => {
  assert.deepEqual(scanDocuments('const bad = gql`query`; const partial = `query Missing { ${EXTERNAL} }`'), [
    { body: 'query', resolved: true }, { body: 'query Missing {  }', resolved: false },
  ])
})
test('includes explicit anonymous queries but not ordinary CSS or JSON templates', () => {
  const source = 'const css = `{ color: red }`; const json = `{ "name": "query" }`;\n' +
    'const anon = gql`{ vipTiers { id name status } }`;\n' +
    'const marked = /* GraphQL */ `{ users { id } }`'
  assert.deepEqual(scanDocuments(source), [
    { body: '{ vipTiers { id name status } }', resolved: true }, { body: '{ users { id } }', resolved: true },
  ])
})
test('resolves whole-operation literals and reports malformed tagged contents', () => {
  assert.deepEqual(scanDocuments('const DOC = `query Users { users { id } }`; const ref = gql`${DOC}`; const bad = gql`not GraphQL`'), [
    { body: 'query Users { users { id } }', resolved: true }, { body: 'query Users { users { id } }', resolved: true },
    { body: 'not GraphQL', resolved: true },
  ])
})
