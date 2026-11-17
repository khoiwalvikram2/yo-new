import { gql } from '@apollo/client'

/* The CREDIT scheme on Deposit/Withdraw chips (spec docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md
   §7). The documents follow the admin-backend contract field for field: the reads sit under Query.agents
   (AgentsQuery) and the moves under Mutation.agents (AgentsMutation). Each document spells its fields out,
   as every other file here does, so a search for a field name finds every screen that reads it. */

export type ChipAccountType = 'AGENT' | 'PLAYER'
export type ChipMovementKind = 'OPENING' | 'DEPOSIT' | 'WITHDRAW' | 'CREDIT_REFERENCE'

/** A CREDIT-scheme account on chips. Ref P/L > 0: the upline owes this account; < 0: it owes the upline. */
export interface ChipAccount {
  accountType: ChipAccountType
  id: string
  username: string
  name?: string | null
  status?: string | null
  /** The direct parent agent; null when the parent is the whitelabel (admin). */
  parentAgentId?: string | null
  /** PLAYER only: AGENT_CREDIT or WHITELABEL_CREDIT. */
  playerType?: string | null
  currency: string
  creditReference: number
  balance: number
  exposure: number
  available: number
  downlineBalance: number
  refPnl: number
  /** Direct downline accounts (agents + players); 0 for a player. */
  downlineCount: number
}

/** The whitelabel credit pool that feeds the root accounts (admin only). */
export interface ChipPool {
  currency: string
  creditLimit: number
  used: number
  available: number
}

export interface ChipTotals {
  creditReference: number
  balance: number
  exposure: number
  available: number
  downlineBalance: number
  refPnl: number
}

export interface ChipDownline {
  /** The agent whose downline this is; null for the admin's (whitelabel's) downline. */
  parent?: ChipAccount | null
  /** Admin only: the whitelabel pool that feeds root accounts. */
  pool?: ChipPool | null
  items: ChipAccount[]
  total: number
  totals: ChipTotals
}

export interface ChipStatementRow {
  id: string
  createdAt: string
  kind: ChipMovementKind
  /** Signed for this account: + chips in, - chips out. */
  amount: number
  balanceBefore: number
  balanceAfter: number
  creditReferenceBefore?: number | null
  creditReferenceAfter?: number | null
  counterpartyType?: string | null
  counterpartyId?: string | null
  counterpartyName?: string | null
  remark?: string | null
  createdBy?: string | null
}

export interface ChipStatementPage {
  rows: ChipStatementRow[]
  total: number
}

export interface ChipTransferInput {
  accountType: ChipAccountType
  accountId: string
  amount: number
  remark?: string | null
}

export interface CreditReferenceInput {
  accountType: ChipAccountType
  accountId: string
  creditReference: number
  remark?: string | null
}

export interface ChipTransferResult {
  account: ChipAccount
  /** The agent that gave or received the chips; null when it was the whitelabel. */
  parent?: ChipAccount | null
  /** Set when the whitelabel pool was the other side. */
  pool?: ChipPool | null
  transferId: string
}

export interface ChipAccountData { agents?: { chipAccount?: ChipAccount | null } | null }
export interface ChipAccountVariables { accountType: ChipAccountType; accountId: string }
export interface MyChipAccountData { agents?: { myChipAccount?: ChipAccount | null } | null }
export interface ChipDownlineData { agents?: { chipDownline?: ChipDownline | null } | null }
export interface ChipDownlineVariables {
  parentAgentId?: string | null
  query?: string | null
  accountType?: ChipAccountType | null
  offset?: number | null
  limit?: number | null
}
export interface ChipStatementData { agents?: { chipStatement?: ChipStatementPage | null } | null }
export interface ChipStatementVariables {
  accountType: ChipAccountType
  accountId: string
  from?: string | null
  to?: string | null
  offset?: number | null
  limit?: number | null
}
export interface ChipPoolData { agents?: { chipPool?: ChipPool | null } | null }
export interface DepositChipsData { agents?: { depositChips?: ChipTransferResult | null } | null }
export interface WithdrawChipsData { agents?: { withdrawChips?: ChipTransferResult | null } | null }
export interface ChipTransferVariables { input: ChipTransferInput }
export interface SetCreditReferenceData { agents?: { setCreditReference?: ChipAccount | null } | null }
export interface SetCreditReferenceVariables { input: CreditReferenceInput }

/** The operation names of the chips reads, for refreshing whichever of them are on screen after a move. */
export const CHIP_QUERY_NAMES = ['ChipAccount', 'MyChipAccount', 'ChipDownline', 'ChipStatement', 'ChipPool'] as const

export const CHIP_ACCOUNT_QUERY = gql`
  query ChipAccount($accountType: ChipAccountType!, $accountId: ID!) {
    agents {
      chipAccount(accountType: $accountType, accountId: $accountId) {
        accountType
        id
        username
        name
        status
        parentAgentId
        playerType
        currency
        creditReference
        balance
        exposure
        available
        downlineBalance
        refPnl
        downlineCount
      }
    }
  }
`

/** The signed-in CREDIT agent's own account; null for an admin and for agents of other schemes. */
export const MY_CHIP_ACCOUNT_QUERY = gql`
  query MyChipAccount {
    agents {
      myChipAccount {
        accountType
        id
        username
        name
        status
        parentAgentId
        playerType
        currency
        creditReference
        balance
        exposure
        available
        downlineBalance
        refPnl
        downlineCount
      }
    }
  }
`

/** A direct downline: the caller's own without parentAgentId (an admin's also carries the pool), or that agent's. */
export const CHIP_DOWNLINE_QUERY = gql`
  query ChipDownline($parentAgentId: ID, $query: String, $accountType: ChipAccountType, $offset: Int, $limit: Int) {
    agents {
      chipDownline(parentAgentId: $parentAgentId, query: $query, accountType: $accountType, offset: $offset, limit: $limit) {
        parent {
          accountType
          id
          username
          name
          status
          parentAgentId
          playerType
          currency
          creditReference
          balance
          exposure
          available
          downlineBalance
          refPnl
          downlineCount
        }
        pool {
          currency
          creditLimit
          used
          available
        }
        items {
          accountType
          id
          username
          name
          status
          parentAgentId
          playerType
          currency
          creditReference
          balance
          exposure
          available
          downlineBalance
          refPnl
          downlineCount
        }
        total
        totals {
          creditReference
          balance
          exposure
          available
          downlineBalance
          refPnl
        }
      }
    }
  }
`

export const CHIP_STATEMENT_QUERY = gql`
  query ChipStatement($accountType: ChipAccountType!, $accountId: ID!, $from: String, $to: String, $offset: Int, $limit: Int) {
    agents {
      chipStatement(accountType: $accountType, accountId: $accountId, from: $from, to: $to, offset: $offset, limit: $limit) {
        rows {
          id
          createdAt
          kind
          amount
          balanceBefore
          balanceAfter
          creditReferenceBefore
          creditReferenceAfter
          counterpartyType
          counterpartyId
          counterpartyName
          remark
          createdBy
        }
        total
      }
    }
  }
`

/** Admin only: the whitelabel pool that root deposits come from. */
export const CHIP_POOL_QUERY = gql`
  query ChipPool {
    agents {
      chipPool {
        currency
        creditLimit
        used
        available
      }
    }
  }
`

export const DEPOSIT_CHIPS_MUTATION = gql`
  mutation DepositChips($input: ChipTransferInput!) {
    agents {
      depositChips(input: $input) {
        account {
          accountType
          id
          username
          name
          status
          parentAgentId
          playerType
          currency
          creditReference
          balance
          exposure
          available
          downlineBalance
          refPnl
          downlineCount
        }
        parent {
          accountType
          id
          username
          name
          status
          parentAgentId
          playerType
          currency
          creditReference
          balance
          exposure
          available
          downlineBalance
          refPnl
          downlineCount
        }
        pool {
          currency
          creditLimit
          used
          available
        }
        transferId
      }
    }
  }
`

export const WITHDRAW_CHIPS_MUTATION = gql`
  mutation WithdrawChips($input: ChipTransferInput!) {
    agents {
      withdrawChips(input: $input) {
        account {
          accountType
          id
          username
          name
          status
          parentAgentId
          playerType
          currency
          creditReference
          balance
          exposure
          available
          downlineBalance
          refPnl
          downlineCount
        }
        parent {
          accountType
          id
          username
          name
          status
          parentAgentId
          playerType
          currency
          creditReference
          balance
          exposure
          available
          downlineBalance
          refPnl
          downlineCount
        }
        pool {
          currency
          creditLimit
          used
          available
        }
        transferId
      }
    }
  }
`

/** Sets the credit reference (a reference only: it moves no chips and gates nothing). */
export const SET_CREDIT_REFERENCE_MUTATION = gql`
  mutation SetCreditReference($input: CreditReferenceInput!) {
    agents {
      setCreditReference(input: $input) {
        accountType
        id
        username
        name
        status
        parentAgentId
        playerType
        currency
        creditReference
        balance
        exposure
        available
        downlineBalance
        refPnl
        downlineCount
      }
    }
  }
`
