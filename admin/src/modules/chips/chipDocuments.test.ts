/**
 * The chips documents against the GraphQL contract of spec §7, copied here as SDL: each must validate (field
 * names, argument names and types, the agents namespaces), and every account selection must carry every
 * figure, so no screen reads a field it never asked for.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { buildSchema, getOperationAST, validate, type DocumentNode, type FieldNode, type SelectionSetNode } from 'graphql'
import {
  CHIP_ACCOUNT_QUERY,
  CHIP_DOWNLINE_QUERY,
  CHIP_POOL_QUERY,
  CHIP_QUERY_NAMES,
  CHIP_STATEMENT_QUERY,
  DEPOSIT_CHIPS_MUTATION,
  MY_CHIP_ACCOUNT_QUERY,
  SET_CREDIT_REFERENCE_MUTATION,
  WITHDRAW_CHIPS_MUTATION,
} from '@/lib/graphql/chips'

const CONTRACT = buildSchema(/* GraphQL */ `
  type Query { agents: AgentsQuery }
  type Mutation { agents: AgentsMutation }

  enum ChipAccountType { AGENT PLAYER }
  enum ChipMovementKind { OPENING DEPOSIT WITHDRAW CREDIT_REFERENCE }

  type ChipAccount {
    accountType: ChipAccountType!
    id: ID!
    username: String!
    name: String
    status: String
    parentAgentId: ID
    playerType: String
    currency: String!
    creditReference: Float!
    balance: Float!
    exposure: Float!
    available: Float!
    downlineBalance: Float!
    refPnl: Float!
    downlineCount: Int!
  }

  type ChipPool { currency: String!, creditLimit: Float!, used: Float!, available: Float! }

  type ChipTotals {
    creditReference: Float!
    balance: Float!
    exposure: Float!
    available: Float!
    downlineBalance: Float!
    refPnl: Float!
  }

  type ChipDownline {
    parent: ChipAccount
    pool: ChipPool
    items: [ChipAccount!]!
    total: Int!
    totals: ChipTotals!
  }

  type ChipStatementRow {
    id: ID!
    createdAt: String!
    kind: ChipMovementKind!
    amount: Float!
    balanceBefore: Float!
    balanceAfter: Float!
    creditReferenceBefore: Float
    creditReferenceAfter: Float
    counterpartyType: String
    counterpartyId: ID
    counterpartyName: String
    remark: String
    createdBy: String
  }

  type ChipStatementPage { rows: [ChipStatementRow!]!, total: Int! }

  input ChipTransferInput { accountType: ChipAccountType!, accountId: ID!, amount: Float!, remark: String }
  input CreditReferenceInput { accountType: ChipAccountType!, accountId: ID!, creditReference: Float!, remark: String }

  type ChipTransferResult {
    account: ChipAccount!
    parent: ChipAccount
    pool: ChipPool
    transferId: ID!
  }

  type AgentsQuery {
    chipAccount(accountType: ChipAccountType!, accountId: ID!): ChipAccount
    myChipAccount: ChipAccount
    chipDownline(parentAgentId: ID, query: String, accountType: ChipAccountType, offset: Int, limit: Int): ChipDownline!
    chipStatement(accountType: ChipAccountType!, accountId: ID!, from: String, to: String, offset: Int, limit: Int): ChipStatementPage!
    chipPool: ChipPool
  }

  type AgentsMutation {
    depositChips(input: ChipTransferInput!): ChipTransferResult!
    withdrawChips(input: ChipTransferInput!): ChipTransferResult!
    setCreditReference(input: CreditReferenceInput!): ChipAccount!
  }
`)

const DOCUMENTS: Record<string, DocumentNode> = {
  ChipAccount: CHIP_ACCOUNT_QUERY,
  MyChipAccount: MY_CHIP_ACCOUNT_QUERY,
  ChipDownline: CHIP_DOWNLINE_QUERY,
  ChipStatement: CHIP_STATEMENT_QUERY,
  ChipPool: CHIP_POOL_QUERY,
  DepositChips: DEPOSIT_CHIPS_MUTATION,
  WithdrawChips: WITHDRAW_CHIPS_MUTATION,
  SetCreditReference: SET_CREDIT_REFERENCE_MUTATION,
}

const ACCOUNT_FIELDS = [
  'accountType', 'id', 'username', 'name', 'status', 'parentAgentId', 'playerType', 'currency',
  'creditReference', 'balance', 'exposure', 'available', 'downlineBalance', 'refPnl', 'downlineCount',
]

function fieldsOf(selectionSet: SelectionSetNode | undefined): string[] {
  return (selectionSet?.selections ?? []).filter((node): node is FieldNode => node.kind === 'Field').map((node) => node.name.value)
}

function child(selectionSet: SelectionSetNode | undefined, name: string): FieldNode {
  const node = selectionSet?.selections.find((item): item is FieldNode => item.kind === 'Field' && item.name.value === name)
  assert.ok(node, `selects ${name}`)
  return node
}

describe('chips documents follow the spec §7 contract', () => {
  test('every document validates against the contract, under the agents namespace', () => {
    for (const [name, document] of Object.entries(DOCUMENTS)) {
      const errors = validate(CONTRACT, document)
      assert.deepEqual(errors.map((error) => error.message), [], `${name} is valid`)
      const operation = getOperationAST(document)
      assert.equal(operation?.name?.value, name, `${name} keeps its operation name`)
      assert.deepEqual(fieldsOf(operation?.selectionSet), ['agents'], `${name} sits under agents`)
    }
  })

  test('the refresh list names exactly the read operations', () => {
    const reads = Object.entries(DOCUMENTS)
      .filter(([, document]) => getOperationAST(document)?.operation === 'query')
      .map(([name]) => name)
    assert.deepEqual([...CHIP_QUERY_NAMES].sort(), reads.sort())
  })

  test('every account selection carries every figure', () => {
    const agents = (document: DocumentNode) => child(getOperationAST(document)?.selectionSet, 'agents').selectionSet
    const accountSelections: Array<[string, SelectionSetNode | undefined]> = [
      ['chipAccount', child(agents(CHIP_ACCOUNT_QUERY), 'chipAccount').selectionSet],
      ['myChipAccount', child(agents(MY_CHIP_ACCOUNT_QUERY), 'myChipAccount').selectionSet],
      ['chipDownline.parent', child(child(agents(CHIP_DOWNLINE_QUERY), 'chipDownline').selectionSet, 'parent').selectionSet],
      ['chipDownline.items', child(child(agents(CHIP_DOWNLINE_QUERY), 'chipDownline').selectionSet, 'items').selectionSet],
      ['depositChips.account', child(child(agents(DEPOSIT_CHIPS_MUTATION), 'depositChips').selectionSet, 'account').selectionSet],
      ['depositChips.parent', child(child(agents(DEPOSIT_CHIPS_MUTATION), 'depositChips').selectionSet, 'parent').selectionSet],
      ['withdrawChips.account', child(child(agents(WITHDRAW_CHIPS_MUTATION), 'withdrawChips').selectionSet, 'account').selectionSet],
      ['withdrawChips.parent', child(child(agents(WITHDRAW_CHIPS_MUTATION), 'withdrawChips').selectionSet, 'parent').selectionSet],
      ['setCreditReference', child(agents(SET_CREDIT_REFERENCE_MUTATION), 'setCreditReference').selectionSet],
    ]
    for (const [path, selectionSet] of accountSelections) {
      assert.deepEqual(fieldsOf(selectionSet).sort(), [...ACCOUNT_FIELDS].sort(), `${path} selects every ChipAccount field`)
    }
  })
})
