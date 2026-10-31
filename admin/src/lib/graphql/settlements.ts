import { gql } from '@apollo/client';

export const SETTLEMENT_DASHBOARD_QUERY = gql`
  query SettlementDashboard($fromDate: String, $toDate: String) {
    settlementDashboard(fromDate: $fromDate, toDate: $toDate) {
      pendingSharingSettlements
      pendingSharingToAgents
      pendingSharingFromAgents
      pendingCreditSettlements
      pendingCommissionPayouts
      pendingDirectCreditAdjustments
      totalSettledThisMonth
      totalSettledLast30Days
      totalCommissionPaidThisMonth
      periodFrom
      periodTo
      totalSettledInPeriod
      totalPaidToAgentsInPeriod
      totalCollectedFromAgentsInPeriod
      totalCommissionPaidInPeriod
      domainBreakdown {
        domain
        settlementBalance
      }
      monthlyTrend {
        month
        totalSettled
        commissionPaid
      }
    }
  }
`;

export const PENDING_SETTLEMENTS_QUERY = gql`
  query PendingSettlements($schemeType: AgentScheme) {
    pendingSettlements(schemeType: $schemeType) {
      agentId
      agent {
        id
        username
        schemeType
        settlementBalanceByDomain {
          domain
          settlementBalance
        }
        ratesByDomain {
          domain
          rate
        }
      }
      schemeType
      pendingAmount
      settlementDirection
      periodFrom
      periodTo
      settlementType
      lastSettlementDate
      settlementBreakdownByDomain {
        domain
        amount
        percentage
        shareRate
        agentShare
        cutAmount
        cutPercentage
      }
    }
  }
`;

export const AGENT_SETTLEMENTS_QUERY = gql`
  query AgentSettlementTransactions($agentId: ID, $limit: Int, $offset: Int, $fromDate: String, $toDate: String) {
    agentSettlementTransactions(agentId: $agentId, limit: $limit, offset: $offset, fromDate: $fromDate, toDate: $toDate) {
      id
      tenant
      agentId
      agent {
        id
        username
        schemeType
      }
      settlementType
      amount
      direction
      previousBalance
      newBalance
      notes
      settledBy
      createdAt
    }
  }
`;

export const MY_COMMISSION_SETTLEMENT_HISTORY_QUERY = gql`
  query MyCommissionSettlementHistory($limit: Int, $offset: Int, $fromDate: String, $toDate: String) {
    myCommissionSettlementHistory(limit: $limit, offset: $offset, fromDate: $fromDate, toDate: $toDate) {
      items {
        id
        tenant
        agentId
        agent { id username schemeType }
        amount
        periodFrom
        periodTo
        notes
        paidBy
        createdAt
      }
      total
    }
  }
`;

export const DOWNLINE_COMMISSION_SETTLEMENT_HISTORY_QUERY = gql`
  query DownlineCommissionSettlementHistory($subAgentId: ID, $limit: Int, $offset: Int, $fromDate: String, $toDate: String) {
    downlineCommissionSettlementHistory(subAgentId: $subAgentId, limit: $limit, offset: $offset, fromDate: $fromDate, toDate: $toDate) {
      items {
        id
        tenant
        agentId
        agent { id username schemeType }
        amount
        periodFrom
        periodTo
        notes
        paidBy
        createdAt
      }
      total
    }
  }
`;

export const SUB_AGENT_COMMISSION_SUMMARIES_QUERY = gql`
  query SubAgentCommissionSummaries($agentId: ID, $periodFrom: String, $periodTo: String, $lastPaidBefore: String) {
    subAgentCommissionSummaries(agentId: $agentId, periodFrom: $periodFrom, periodTo: $periodTo, lastPaidBefore: $lastPaidBefore) {
      agentId
      username
      pendingCommission
      totalPaid
      lastPaidAt
      sportsGGR
      casinoGGR
      matkaGGR
      sportsCommission
      casinoCommission
      matkaCommission
      sportsCommissionRate
      casinoCommissionRate
      matkaCommissionRate
      currency
      tallyEnabled
      tallyDomains
      effectiveCalculatedTotal
      effectiveSportsCommission
      effectiveCasinoCommission
      effectiveMatkaCommission
    }
  }
`;

export const WHITELABEL_COMMISSION_SUMMARIES_QUERY = gql`
  query WhitelabelCommissionSummaries($periodFrom: String!, $periodTo: String!) {
    whitelabelCommissionSummaries(periodFrom: $periodFrom, periodTo: $periodTo) {
      agentId
      username
      pendingCommission
      totalPaid
      lastPaidAt
      sportsGGR
      casinoGGR
      matkaGGR
      sportsCommission
      casinoCommission
      matkaCommission
      sportsCommissionRate
      casinoCommissionRate
      matkaCommissionRate
      currency
      tallyEnabled
      tallyDomains
      effectiveCalculatedTotal
      effectiveSportsCommission
      effectiveCasinoCommission
      effectiveMatkaCommission
    }
  }
`;

export const CURRENT_COMMISSION_CYCLE_QUERY = gql`
  query CurrentCommissionCycle {
    currentCommissionCycle {
      from
      to
      status
      fromDate
      toDate
      previousFromDate
      previousToDate
    }
  }
`;

export const COMMISSION_CYCLES_FOR_AGENT_QUERY = gql`
  query CommissionCyclesForAgent($agentId: ID!) {
    commissionCyclesForAgent(agentId: $agentId) {
      from
      to
      status
      paidAmount
      payableAmount
      calculatedTotal
      adjustmentAmount
      zeroCommission
      carriedLoss
      carryApplied
      lossThisCycle
      fromDate
      toDate
    }
  }
`;

export const COMMISSION_CYCLE_READINESS_QUERY = gql`
  query CommissionCycleReadiness($agentId: ID!, $cycleFrom: String!, $cycleTo: String!) {
    commissionCycleReadiness(agentId: $agentId, cycleFrom: $cycleFrom, cycleTo: $cycleTo) {
      ready
      reasons
      calculatedTotal
      postedTotal
      paidInCycle
      payableAmount
      currency
      openBets
      unresolvedAdjustments
      previousCycleOpenBets
      carriedLoss
      carryApplied
    }
  }
`;

export const COMMISSION_ADJUSTMENTS_QUERY = gql`
  query CommissionAdjustments($agentId: ID!, $limit: Int) {
    commissionAdjustments(agentId: $agentId, limit: $limit) {
      id
      agentId
      amount
      sourceCycleFrom
      sourceCycleTo
      targetCycleFrom
      targetCycleTo
      reason
      status
      createdAt
      appliedAt
    }
  }
`;

export const CREATE_COMMISSION_ADJUSTMENT_MUTATION = gql`
  mutation CreateCommissionAdjustment($input: CreateCommissionAdjustmentInput!) {
    createCommissionAdjustment(input: $input) {
      success
      message
      adjustment {
        id
        status
      }
    }
  }
`;

export const APPLY_COMMISSION_ADJUSTMENT_MUTATION = gql`
  mutation ApplyCommissionAdjustment($input: ApplyCommissionAdjustmentInput!) {
    applyCommissionAdjustment(input: $input) {
      success
      message
      adjustment {
        id
        status
        targetCycleFrom
        targetCycleTo
        appliedAt
      }
    }
  }
`;

export const CANCEL_COMMISSION_ADJUSTMENT_MUTATION = gql`
  mutation CancelCommissionAdjustment($adjustmentId: ID!, $reason: String) {
    cancelCommissionAdjustment(adjustmentId: $adjustmentId, reason: $reason) {
      success
      message
      adjustment {
        id
        status
      }
    }
  }
`;

export const COMMISSION_PAYOUTS_QUERY = gql`
  query CommissionPayouts($agentId: ID, $limit: Int, $offset: Int, $fromDate: String, $toDate: String) {
    commissionPayouts(agentId: $agentId, limit: $limit, offset: $offset, fromDate: $fromDate, toDate: $toDate) {
      id
      tenant
      agentId
      agent {
        id
        username
        schemeType
      }
      amount
      periodFrom
      periodTo
      turnover
      notes
      paidBy
      createdAt
    }
  }
`;

export const PLAYER_CREDIT_ADJUSTMENTS_QUERY = gql`
  query PlayerCreditAdjustments($playerId: ID, $limit: Int, $offset: Int, $fromDate: String, $toDate: String) {
    playerCreditAdjustments(playerId: $playerId, limit: $limit, offset: $offset, fromDate: $fromDate, toDate: $toDate) {
      id
      tenant
      playerId
      player {
        id
        name
        username
      }
      adjustmentType
      amount
      previousLimit
      newLimit
      previousUsed
      newUsed
      notes
      adjustedBy
      balanceBefore
      balanceAfter
      createdAt
    }
  }
`;

export const SETTLE_AGENT_MUTATION = gql`
  mutation SettleAgent($input: SettleAgentInput!) {
    settleAgent(input: $input) {
      success
      message
      settlement {
        id
        agentId
        agent {
          id
          username
          schemeType
        }
        settlementType
        amount
        direction
        previousBalance
        newBalance
        notes
        createdAt
      }
    }
  }
`;

export const PAY_COMMISSION_MUTATION = gql`
  mutation PayCommission($input: PayCommissionInput!) {
    payCommission(input: $input) {
      success
      message
      payout {
        id
        agentId
        agent {
          id
          username
          schemeType
        }
        amount
        periodFrom
        periodTo
        notes
        createdAt
      }
    }
  }
`;

export const ADJUST_PLAYER_CREDIT_MUTATION = gql`
  mutation AdjustPlayerCredit($input: AdjustPlayerCreditInput!) {
    adjustPlayerCredit(input: $input) {
      success
      message
      adjustment {
        id
        playerId
        player {
          id
          name
          username
        }
        adjustmentType
        amount
        previousLimit
        newLimit
        previousUsed
        newUsed
        notes
        balanceBefore
        balanceAfter
        createdAt
      }
    }
  }
`;

export const BULK_SETTLE_AGENTS_MUTATION = gql`
  mutation BulkSettleAgents($agentIds: [ID!]!) {
    bulkSettleAgents(agentIds: $agentIds) {
      success
      message
      settledCount
      failedCount
      settlements {
        id
        agentId
        amount
        direction
        createdAt
      }
    }
  }
`;

export const ENHANCED_PENDING_SETTLEMENTS_QUERY = gql`
  query EnhancedPendingSettlements($schemeType: AgentScheme) {
    enhancedPendingSettlements(schemeType: $schemeType) {
      agentId
      agent {
        id
        username
        schemeType
      }
      schemeType
      pendingAmount
      settlementDirection
      periodFrom
      periodTo
      settledThisPeriod
      totalShareForPeriod
      totalSettledToAgent
      settlementType
      lastSettlementDate
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
`;

export const SUB_AGENTS_PENDING_SETTLEMENTS_QUERY = gql`
  query SubAgentsPendingSettlements($schemeType: AgentScheme) {
    subAgentsPendingSettlements(schemeType: $schemeType) {
      agentId
      agent {
        id
        username
        schemeType
      }
      schemeType
      settledThisPeriod
      pendingAmount
      settlementDirection
      periodFrom
      periodTo
      totalShareForPeriod
      settlementType
      totalSettledToAgent
      lastSettlementDate
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
`;

export const SETTLEMENT_DETAILS_QUERY = gql`
  query SettlementDetails($settlementId: ID!) {
    settlementDetails(settlementId: $settlementId) {
      id
      agentId
      agent {
        id
        username
        schemeType
      }
      periodFrom
      periodTo
      totalAmount
      direction
      status
      currency
      notes
      postedBy
      postedAt
      createdAt
      directPlayersContribution
      subAgentsContribution
      directPlayersCount
      subAgentsCount
      domainBreakdown {
        domain
        amount
        percentage
        shareRate
        agentShare
        cutAmount
        cutPercentage
      }
      playerContributions {
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
      subAgentContributions {
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
`;

export const AGENT_SETTLEMENT_CONTRIBUTIONS_QUERY = gql`
  query AgentSettlementContributions($agentId: ID!, $periodFrom: String!, $periodTo: String!) {
    agentSettlementContributions(agentId: $agentId, periodFrom: $periodFrom, periodTo: $periodTo) {
      directPlayers {
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
      totals {
        directPL
        subAgentPL
        directShare
        subAgentShare
        directPlayersCount
        subAgentsCount
      }
    }
  }
`;

// Admin settlement history - all agents in tenant
export const ALL_SETTLEMENT_HISTORY_QUERY = gql`
  query AllSettlementHistory($limit: Int, $offset: Int, $fromDate: String, $toDate: String) {
    allSettlementHistory(limit: $limit, offset: $offset, fromDate: $fromDate, toDate: $toDate) {
      id
      agentId
      agent {
        id
        username
        schemeType
      }
      periodFrom
      periodTo
      totalAmount
      direction
      status
      currency
      notes
      postedBy
      postedAt
      createdAt
    }
  }
`;


export const AGENT_SETTLEMENTS_PAGE_QUERY = gql`
  query AgentSettlementTransactionsPage($agentId: ID, $limit: Int, $offset: Int, $fromDate: String, $toDate: String) {
    agentSettlementTransactionsPage(agentId: $agentId, limit: $limit, offset: $offset, fromDate: $fromDate, toDate: $toDate) {
      total totalAmount toAgent fromAgent toCount fromCount
      items {
      id
      tenant
      agentId
      agent {
        id
        username
        schemeType
      }
      settlementType
      amount
      direction
      previousBalance
      newBalance
      notes
      settledBy
      createdAt
      }
    }
  }
`;

export const COMMISSION_PAYOUTS_PAGE_QUERY = gql`
  query CommissionPayoutsPage($agentId: ID, $limit: Int, $offset: Int, $fromDate: String, $toDate: String) {
    commissionPayoutsPage(agentId: $agentId, limit: $limit, offset: $offset, fromDate: $fromDate, toDate: $toDate) {
      total
      items {
      id
      tenant
      agentId
      agent {
        id
        username
        schemeType
      }
      amount
      periodFrom
      periodTo
      turnover
      notes
      paidBy
      createdAt
      }
    }
  }
`;

export const COMMISSION_ADJUSTMENTS_PAGE_QUERY = gql`
  query CommissionAdjustmentsPage($agentId: ID!, $limit: Int, $offset: Int) {
    commissionAdjustmentsPage(agentId: $agentId, limit: $limit, offset: $offset) {
      total
      items {
      id
      agentId
      amount
      sourceCycleFrom
      sourceCycleTo
      targetCycleFrom
      targetCycleTo
      reason
      status
      createdAt
      appliedAt
      }
    }
  }
`;
