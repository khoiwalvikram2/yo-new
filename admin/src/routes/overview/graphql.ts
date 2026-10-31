import { gql } from '@apollo/client';

export const DASHBOARD_KPIS_QUERY = gql`
  query DashboardKPIs($dateRange: DashboardDateRange) {
    overviewKPIs(dateRange: $dateRange) {
      tenant
      turnover
      sportsTurnover
      casinoTurnover
      matkaTurnover
      ggr
      ngr
      liquidity
      exposure
      unmatchedOrders
      upcomingDrawCutoffs
      jackpotStatus
      alerts {
        id
        level
        message
        at
      }
      totalDeposits
      totalWithdrawals
      netDeposits
      sportsGGR
      casinoGGR
      matkaGGR
      activePlayers
      newPlayers
      totalPlayers
      totalBets
      sportsBets
      casinoBets
      matkaBets
      agentCommission
      bonusPayouts
      # Agent stats
    totalSettlement
    liveSettlement
    liveCommission
    totalCommission
    # Advanced metrics
    ftd
    ftdCount
    ltv
    arpu
    arppu
    conversionRate
    retentionRate
    churnRate
    dauMauRatio
    avgSessionDuration
    avgBetSize
    winRate
    riskScore
    complianceScore
    # Growth metrics
    revenueGrowth
    playerGrowth
    depositGrowth
    # Engagement metrics
    totalSessions
    avgSessionsPerUser
    bounceRate
    }
  }
`;

export const DASHBOARD_TRENDS_QUERY = gql`
  query DashboardTrends($dateRange: DashboardDateRange) {
    dashboardTrends(dateRange: $dateRange) {
      date
      turnover
      ggr
      ngr
      deposits
      withdrawals
      netDeposits
      sportsGGR
      casinoGGR
      matkaGGR
      activePlayers
      betCount
    }
  }
`;

/* The rail's "Real-time snapshot" card. What is happening now, not the selected period, so the
   field takes no arguments — in particular no dateRange. Money fields are raw whitelabel-currency
   amounts, converted and formatted on the client like every other figure on the page. */
export const REALTIME_SNAPSHOT_QUERY = gql`
  query DashboardRealtimeSnapshot {
    realtimeSnapshot {
      at
      activePlayers
      activityWindowMins
      activeBets
      depositsLastHour
      withdrawalsLastHour
    }
  }
`;

/* The rail's "Exposure by market" card: the open book now, split by sport plus one matka row. It
   splits the Exposure figure of overviewKPIs (casino excluded, bet-tool bets included), but takes no
   arguments: it is what is open now, not the selected period. Amounts are raw whitelabel-currency
   figures, ordered largest first, with markets that have nothing open already left out. */
export const EXPOSURE_BY_MARKET_QUERY = gql`
  query DashboardExposureByMarket {
    exposureByMarket {
      at
      markets {
        key
        product
        label
        amount
      }
    }
  }
`;

/* The Overview's operations sections (the owner's list, 2026-10-29), which replaced Advanced Analytics.
   Period figures follow the dateRange; pending counts, online, balances, the credit pool and head counts
   are what is true now. showB2C / showCredit say which sections apply to the whitelabel being viewed. */
export const DASHBOARD_OPERATIONS_QUERY = gql`
  query DashboardOperations($dateRange: DashboardDateRange) {
    dashboardOperations(dateRange: $dateRange) {
      showB2C
      showCredit
      directDeposits
      manualDeposits
      directWithdrawals
      manualWithdrawals
      pendingDepositRequests
      pendingDepositAmount
      pendingWithdrawalRequests
      pendingWithdrawalAmount
      pendingPayoutAccounts
      onlineNow
      onlineWindowMins
      loggedInPlayers
      playersWhoBet
      playersWithOpenBet
      betsPlaced
      registeredToday
      inactivePlayers
      suspendedPlayers
      walletBalance
      bonusGiven
      sharingAgentsActive
      commissionAgentsActive
      chipsDepositedByWhitelabel
      chipsDepositedByAgents
      chipsWithdrawnByWhitelabel
      chipsWithdrawnByAgents
      chipsGivenToAgents
      creditLimit
      creditUsed
      creditAvailable
      settlementDue
      settledAmount
      chipsWithPlayers
      directPlayers
      agentPlayers
      creditAgentsActive
      staleSportsBets
      staleSportsEvents
      staleSportsHours
      stuckCasinoRounds
      casinoStuckMinutes
      overdueMatkaBets
      overdueMatkaMarkets
    }
  }
`;

/** The Overview's insight cards: top risk events, big bets and winners, agents near their credit limit. */
export const DASHBOARD_INSIGHTS_QUERY = gql`
  query DashboardInsights($dateRange: DashboardDateRange) {
    dashboardInsights(dateRange: $dateRange) {
      openExposure
      riskEvents {
        key
        product
        label
        detail
        startsAt
        exposure
        bets
        players
      }
      bigBets {
        id
        product
        userId
        username
        agent
        label
        amount
        outcome
        playerPl
        placedAt
      }
      topWinners {
        userId
        username
        agent
        profit
        staked
        bets
      }
      creditAgents
      nearLimitShare
      agentsNearLimit {
        agentId
        username
        creditLimit
        creditUsed
        creditAvailable
        usedShare
        settlementBalance
      }
    }
  }
`;

/** The Players tab's retention and conversion figures. */
export const DASHBOARD_PLAYER_RETENTION_QUERY = gql`
  query DashboardPlayerRetention($dateRange: DashboardDateRange) {
    dashboardPlayerRetention(dateRange: $dateRange) {
      dailyActive
      weeklyActive
      monthlyActive
      activeInPeriod
      activePrevious
      returning
      newPlayers
      newDepositors
      repeatDepositors
      depositors
      lapsing
    }
  }
`;

/** The Financial tab's casino providers P&L and bonus analysis. */
export const DASHBOARD_FINANCIAL_INSIGHTS_QUERY = gql`
  query DashboardFinancialInsights($dateRange: DashboardDateRange) {
    dashboardFinancialInsights(dateRange: $dateRange) {
      casinoProviders {
        vendor
        turnover
        payouts
        ggr
        bets
        players
      }
      casinoTotal {
        vendor
        turnover
        payouts
        ggr
        bets
        players
      }
      bonusGiven
      bonusAwards
      bonusByType {
        type
        amount
        awards
      }
      bonusOutstanding
      bonusOutstandingAwards
      bonusCompleted
      bonusExpired
      bonusStakes
    }
  }
`;

/** The Players tab: funnel, mix, daily sign-ups and first deposits, play by product, top players, period vs previous. */
export const DASHBOARD_PLAYERS_TAB_QUERY = gql`
  query DashboardPlayersTab($dateRange: DashboardDateRange) {
    dashboardPlayersTab(dateRange: $dateRange) {
      funnel { registered depositors bettors30 bettors7 bettorsToday }
      byStatus { key players }
      byType { key players }
      daily { day registrations firstDeposits firstDepositAmount }
      products { product bettors bets stake ggr }
      topStakers { userId username agent bets staked playerPl }
      topDepositors { userId username agent deposits amount }
      current { newPlayers bettors bets turnover depositors deposits depositAmount }
      previous { newPlayers bettors bets turnover depositors deposits depositAmount }
    }
  }
`;

/** The Agents tab: network, commission and settlement, leaderboard, credit agents. */
export const DASHBOARD_AGENTS_TAB_QUERY = gql`
  query DashboardAgentsTab($dateRange: DashboardDateRange) {
    dashboardAgentsTab(dateRange: $dateRange) {
      network { total active suspended sharing commission credit topLevel levels newAgents playersUnderAgents directPlayers }
      commissionTotal
      commissionByDomain { domain amount }
      settlementOwed
      settlementOwing
      agentsWithBalance
      settlementsPosted
      settlementsAmount
      leaderboard { agentId username scheme status subAgents players activePlayers turnover ggr commission }
      creditAgents { agentId username creditLimit creditUsed creditAvailable usedShare }
      creditLimit
      creditUsed
    }
  }
`;

/** The Time tab: weekday × hour heatmap, hourly and weekday profiles, this month's run rate. */
export const DASHBOARD_TIME_TAB_QUERY = gql`
  query DashboardTimeTab($dateRange: DashboardDateRange) {
    dashboardTimeTab(dateRange: $dateRange) {
      windowFrom
      windowTo
      windowDays
      widened
      heatmap { weekday hour bets stake }
      hourly { hour bets stake ggr players }
      weekdays { weekday bets stake ggr players }
      month { month daysElapsed daysInMonth ggr turnover bets previousGgr previousTurnover previousBets }
    }
  }
`;

/** The rows behind a dashboard figure, for its pop-up (DrilldownDialog). */
export const DASHBOARD_DRILLDOWN_QUERY = gql`
  query DashboardDrilldown($kind: String!, $arg: String, $dateRange: DashboardDateRange, $search: String, $limit: Int, $offset: Int) {
    dashboardDrilldown(kind: $kind, arg: $arg, dateRange: $dateRange, search: $search, limit: $limit, offset: $offset) {
      kind
      title
      subtitle
      columns { key label kind }
      rows { id cells playerId agentId }
      total
      page
    }
  }
`;
