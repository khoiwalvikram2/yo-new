import { gql } from '@apollo/client'

export const AGENT_LOGIN_MUTATION = gql`
  mutation AgentLogin($input: AgentLoginInput!) {
    agents {
      agentLogin(input: $input) {
        token
        agent {
          id
          tenantId
          username
          phone
          schemeType
          allowedDomains
          status
          parentAgentId
          levelIndex
          tallyEnabled
          tallyDomains
          createdAt
        }
        permissions {
          domain
          actions
        }
        tenant
        isReadOnly
      }
    }
  }
`

export const AGENT_ME_QUERY = gql`
  query AgentMe {
    agents {
      agentMe {
        id
        tenantId
        username
        phone
        schemeType
        allowedDomains
        status
        parentAgentId
        levelIndex
        tallyEnabled
        tallyDomains
        createdAt
      }
    }
  }
`

export const AGENTS_PAGE_QUERY = gql`
  query AgentsPage(
    $query: String
    $schemeType: AgentScheme
    $status: String
    $parentAgentId: ID
    $directOnly: Boolean
    $offset: Int
    $limit: Int
  ) {
    agents {
      agentsPage(
        query: $query
        schemeType: $schemeType
        status: $status
        parentAgentId: $parentAgentId
        directOnly: $directOnly
        offset: $offset
        limit: $limit
        includeStats: false
      ) {
        items {
          id
          tenantId
          username
          phone
          schemeType
          allowedDomains
          status
          parentAgentId
          parentAgent {
            id
            username
          }
          levelIndex
          tallyEnabled
          tallyDomains
          commissionRates {
            domain
            rate
          }
          sharingRates {
            domain
            rate
          }
          # A CREDIT agent's credit reference. Its chips are read beside the list, for the CREDIT tab only
          # (routes/agents/components/agentChips.ts); the credit-limit and settlement-balance columns are retired.
          creditLimit
          createdAt
        }
        total
      }
    }
  }
`

export const AGENTS_STATS_QUERY = gql`
  query AgentsStats(
    $query: String
    $schemeType: AgentScheme
    $status: String
    $parentAgentId: ID
    $directOnly: Boolean
    $offset: Int
    $limit: Int
  ) {
    agents {
      agentsPage(
        query: $query
        schemeType: $schemeType
        status: $status
        parentAgentId: $parentAgentId
        directOnly: $directOnly
        offset: $offset
        limit: $limit
        includeStats: true
      ) {
        itemsWithStats {
          agent {
            id
          }
          stats {
            activePlayers
            lastLogin
            daysSinceLastBet
            totalDeposits
            totalWithdrawals
            ggr
            totalExposure
            profitLoss
            plTrend
            betCount
            pendingSettlement
            totalSettled
            lastSettlementDate
            turnover
            commissionEarned
            commissionTrend
          }
        }
      }
    }
  }
`

export const AGENTS_FOR_SELECTOR_QUERY = gql`
  query AgentsForSelector($schemeType: AgentScheme, $parentAgentId: ID) {
    agents {
      agentsPage(
        schemeType: $schemeType
        parentAgentId: $parentAgentId
        limit: 1000
        offset: 0
        includeStats: false
      ) {
        items {
          id
          username
        }
      }
    }
  }
`

export const AGENT_DASHBOARD_STATS_QUERY = gql`
  query AgentDashboardStats($agentId: ID!, $dateFrom: String, $dateTo: String) {
    agents {
      agentDashboardStats(agentId: $agentId, dateFrom: $dateFrom, dateTo: $dateTo) {
        totalPlayers
        activePlayers24h
        newPlayersToday
        pendingDeposits
        pendingDepositsAmount
        pendingWithdrawals
        pendingWithdrawalsAmount
        totalDeposits
        totalWithdrawals
        directDeposits
        directWithdrawals
        manualDeposits
        manualWithdrawals
        ggr
        profitLoss
      }
    }
  }
`

export const COMMISSION_SUMMARY_QUERY = gql`
  query CommissionSummary($agentId: ID!, $periodFrom: String!, $periodTo: String!) {
    agents {
      commissionSummary(agentId: $agentId, periodFrom: $periodFrom, periodTo: $periodTo) {
        totalEarned
        calculatedTotal
        pending
        paid
        sportsCommission
        casinoCommission
        matkaCommission
        currency
        sportsGGR
        casinoGGR
        matkaGGR
        directSportsGGR
        directCasinoGGR
        directMatkaGGR
        sportsCommissionRate
        casinoCommissionRate
        matkaCommissionRate
        netSportsCommission
        netCasinoCommission
        netMatkaCommission
        effectiveCalculatedTotal
        effectiveSportsCommission
        effectiveCasinoCommission
        effectiveMatkaCommission
        tallyApplied {
          enabled
          domains
        }
        grossSportsCommission
        grossCasinoCommission
        grossMatkaCommission
        grossEffectiveSportsCommission
        grossEffectiveCasinoCommission
        grossEffectiveMatkaCommission
        grossEffectiveCalculatedTotal
        netEffectiveSportsCommission
        netEffectiveCasinoCommission
        netEffectiveMatkaCommission
        netEffectiveCalculatedTotal
        carriedLoss
        carryApplied
        lossThisCycle
      }
    }
  }
`

export const SETTLEMENT_SUMMARY_QUERY = gql`
  query SettlementSummary($agentId: ID!, $periodFrom: String!, $periodTo: String!) {
    agents {
      settlementSummary(agentId: $agentId, periodFrom: $periodFrom, periodTo: $periodTo) {
        netPL
        sharePercentage
        settlementDue
        settlementDirection
        lastSettlementDate
        lastSettlementAmount
        currency
        sportsPL
        casinoPL
        matkaPL
        sportsShare
        casinoShare
        matkaShare
        settlementBreakdownByDomain {
          domain
          amount
          percentage
          shareRate
          agentShare
          cutAmount
          cutPercentage
        }
        directPlayersContribution
        subAgentsContribution
        directPlayersCount
        subAgentsCount
        topPlayers {
          playerId
          playerName
          playerUsername
          pl
          share
          domainBreakdown {
            domain
            pl
            share
            cutAmount
          }
          contributionPercentage
          isDirectPlayer
          subAgentId
          subAgentName
        }
        subAgents {
          subAgentId
          subAgentName
          subAgentUsername
          totalPL
          totalShare
          playerCount
          domainBreakdown {
            domain
            pl
            share
            cutAmount
          }
          contributionPercentage
          players {
            playerId
            playerName
            playerUsername
            pl
            share
            domainBreakdown {
              domain
              pl
              share
              cutAmount
            }
            contributionPercentage
            isDirectPlayer
            subAgentId
            subAgentName
          }
        }
      }
    }
  }
`

export const AGENT_LEDGERS_QUERY = gql`
  query AgentLedgers($agentId: ID!, $periodFrom: String!, $periodTo: String!) {
    agents {
      agentLedgers(agentId: $agentId, periodFrom: $periodFrom, periodTo: $periodTo) {
        id
        agentId
        domain
        periodFrom
        periodTo
        lineType
        amount
        currency
        refKey
        createdAt
      }
    }
  }
`

export const AGENT_SETTLEMENTS_QUERY = gql`
  query AgentSettlements($agentId: ID!, $periodFrom: String!, $periodTo: String!) {
    agents {
      agentSettlements(agentId: $agentId, periodFrom: $periodFrom, periodTo: $periodTo) {
        id
        agentId
        periodFrom
        periodTo
        totalAmount
        direction
        currency
        status
        postedAt
        postedBy
        createdAt
        notes
      }
    }
  }
`

export const DOWNLINE_SETTLEMENT_HISTORY_QUERY = gql`
  query DownlineSettlementHistory($periodFrom: String!, $periodTo: String!) {
    agents {
      downlineSettlementHistory(periodFrom: $periodFrom, periodTo: $periodTo) {
        id
        agentId
        periodFrom
        periodTo
        totalAmount
        direction
        currency
        status
        postedAt
        postedBy
        createdAt
        notes
        agent {
          id
          username
          schemeType
        }
      }
    }
  }
`

export const UPDATE_AGENT_STATUS_MUTATION = gql`
  mutation UpdateAgentStatus($agentId: ID!, $status: String!) {
    agents {
      updateAgentStatus(agentId: $agentId, status: $status) {
        id
        status
      }
    }
  }
`

export const UPDATE_AGENT_MUTATION = gql`
  mutation UpdateAgent($input: UpdateAgentInput!) {
    agents {
      updateAgent(input: $input) {
        id
        username
        schemeType
        allowedDomains
        status
        parentAgentId
        levelIndex
        tallyEnabled
        tallyDomains
      }
    }
  }
`

export const COMMISSION_HISTORY_QUERY = gql`
  query CommissionHistory(
    $agentId: ID!
    $periodFrom: String!
    $periodTo: String!
    $currency: String
    $domain: AgentDomain
    $playerId: ID
    $limit: Int
    $offset: Int
  ) {
    agents {
      commissionHistory(
        agentId: $agentId
        periodFrom: $periodFrom
        periodTo: $periodTo
        currency: $currency
        domain: $domain
        playerId: $playerId
        limit: $limit
        offset: $offset
      ) {
        entries {
          id
          date
          playerId
          playerName
          domain
          betAmount
          ggr
          commissionRate
          commissionEarned
          currency
          status
          eventName
          marketName
          selectionName
          side
          odds
          liability
          gameName
          vendorName
          payout
          winAmount
          matkaType
          bidType
          betNumbers
          payoutMultiplier
          potentialWin
          actualWin
          marketSession
        }
        total
      }
    }
  }
`

export const COMMISSION_REPORT_QUERY = gql`
  query CommissionReport(
    $agentId: ID!
    $periodFrom: String!
    $periodTo: String!
    $currency: String
    $domain: AgentDomain
    $limit: Int
    $offset: Int
  ) {
    agents {
      commissionReport(
        agentId: $agentId
        periodFrom: $periodFrom
        periodTo: $periodTo
        currency: $currency
        domain: $domain
        limit: $limit
        offset: $offset
      ) {
        summary {
          totalEarned
          pending
          paid
          sportsCommission
          casinoCommission
          matkaCommission
          currency
        }
        history {
          entries {
            id
            date
            playerId
            playerName
            domain
            betAmount
            ggr
            commissionRate
            commissionEarned
            currency
          }
          total
        }
      }
    }
  }
`

/** Minimal agent tree for direct-child book view (direct children only). */
export const AGENT_TREE_FOR_VIEW_QUERY = gql`
  query AgentTreeForView($rootId: ID!) {
    agents {
      agentTree(rootId: $rootId) {
        id
      }
    }
  }
`

/** Self + all descendant agent IDs for roll-up in books. */
export const AGENT_DESCENDANT_IDS_QUERY = gql`
  query AgentDescendantIds($agentId: ID!) {
    agents {
      agentDescendantIds(agentId: $agentId)
    }
  }
`

/** Root agent IDs (no parent) for whitelabel – used for direct-child book view. */
export const AGENT_ROOT_IDS_QUERY = gql`
  query AgentRootIds {
    agents {
      agentRootIds
    }
  }
`

/** Root agents with basic info for whitelabel book view. */
export const AGENT_ROOT_AGENTS_QUERY = gql`
  query AgentRootAgents {
    agents {
      agentRootAgents {
        id
        username
        schemeType
        rate
      }
    }
  }
`

export const AGENT_REFERRAL_LINK_QUERY = gql`
  query AgentReferralLink($agentId: ID!) {
    agentReferralLink(agentId: $agentId) {
      id
      code
      agentId
      qrCodeUrl
      isActive
      createdAt
      totalClicks
      totalSignups
      conversionRate
    }
  }
`

export const DIRECT_PLAYER_COMMISSION_SUMMARIES_QUERY = gql`
  query DirectPlayerCommissionSummaries($agentId: ID, $periodFrom: String!, $periodTo: String!) {
    agents {
      directPlayerCommissionSummaries(agentId: $agentId, periodFrom: $periodFrom, periodTo: $periodTo) {
        playerId
        playerName
        subAgentId
        subAgentUsername
        subAgentSportsRate
        subAgentCasinoRate
        subAgentMatkaRate
        sportsGGR
        casinoGGR
        matkaGGR
        sportsCommission
        casinoCommission
        matkaCommission
        totalGGR
        totalCommission
      }
    }
  }
`

export const ADMIN_RESET_AGENT_PASSWORD_MUTATION = gql`
  mutation AdminResetAgentPassword($agentId: ID!, $newPassword: String!, $adminPassword: String!) {
    agents {
      adminResetAgentPassword(agentId: $agentId, newPassword: $newPassword, adminPassword: $adminPassword) {
        success
        message
      }
    }
  }
`

export const GENERATE_AGENT_REFERRAL_LINK_MUTATION = gql`
  mutation GenerateAgentReferralLink($agentId: ID!, $code: String) {
    generateReferralLink(agentId: $agentId, code: $code) {
      success
      message
      link {
        id
        code
        agentId
        qrCodeUrl
        isActive
        createdAt
      }
    }
  }
`
