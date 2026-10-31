import { gql } from '@apollo/client';

// Sports Reporting Queries
export const SPORTS_KPIS_QUERY = gql`
  query SportsKPIs($filter: SportsReportingFilter) {
    sportsKPIs(filter: $filter) {
      totalStakes
      totalPayouts
      totalExposure
      grossGamingRevenue
      netRevenue
      holdPercentage
      betCount
      playerCount
      activePlayerCount
    }
  }
`;

export const SPORTS_TRENDS_QUERY = gql`
  query SportsTrends($filter: SportsReportingFilter) {
    sportsTrends(filter: $filter) {
      date
      stakes
      payouts
      ggr
      betCount
      playerCount
    }
  }
`;

export const SPORTS_BREAKDOWN_QUERY = gql`
  query SportsBreakdown($filter: SportsReportingFilter, $dimension: String!) {
    sportsBreakdown(filter: $filter, dimension: $dimension) {
      id
      name
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      playerCount
    }
  }
`;

export const TOP_SPORTS_EVENTS_QUERY = gql`
  query TopSportsEvents($filter: SportsReportingFilter, $limit: Int) {
    topSportsEvents(filter: $filter, limit: $limit) {
      eventId
      eventName
      leagueName
      sportName
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
    }
  }
`;

// Casino Reporting Queries
export const CASINO_KPIS_QUERY = gql`
  query CasinoKPIs($filter: CasinoReportingFilter) {
    casinoKPIs(filter: $filter) {
      totalStakes
      totalPayouts
      grossGamingRevenue
      netRevenue
      holdPercentage
      betCount
      playerCount
      activePlayerCount
    }
  }
`;

export const CASINO_TRENDS_QUERY = gql`
  query CasinoTrends($filter: CasinoReportingFilter) {
    casinoTrends(filter: $filter) {
      date
      stakes
      payouts
      ggr
      betCount
      playerCount
    }
  }
`;

// Matka Reporting Queries
export const MATKA_KPIS_QUERY = gql`
  query MatkaKPIs($filter: MatkaReportingFilter) {
    matkaKPIs(filter: $filter) {
      totalStakes
      totalPayouts
      totalExposure
      grossGamingRevenue
      netRevenue
      holdPercentage
      betCount
      playerCount
      activePlayerCount
    }
  }
`;

export const MATKA_TRENDS_QUERY = gql`
  query MatkaTrends($filter: MatkaReportingFilter) {
    matkaTrends(filter: $filter) {
      date
      stakes
      payouts
      ggr
      betCount
      playerCount
    }
  }
`;

// Agent Reporting Queries
export const AGENT_KPIS_QUERY = gql`
  query AgentKPIs($filter: AgentReportingFilter) {
    agentKPIs(filter: $filter) {
      totalTurnover
      totalGGR
      commissionEarned
      shareEarned
      downlineTurnover
      downlineGGR
      playerCount
      activePlayerCount
      betCount
      agentCount
    }
  }
`;

export const AGENT_PERFORMANCE_QUERY = gql`
  query AgentPerformance($filter: AgentReportingFilter, $limit: Int) {
    agentPerformance(filter: $filter, limit: $limit) {
      agents {
        agentId
        agentName
        schemeType
        totalTurnover
        totalGGR
        commissionEarned
        shareEarned
        downlineTurnover
        downlineGGR
        playerCount
        betCount
        level
        userCutPercent
        agentCutPercent
        domainBreakdown {
          domain
          turnover
          ggr
          cut
          cutPercent
          userCutPercent
          agentCutPercent
        }
      }
      totals {
        totalTurnover
        totalGGR
        commissionEarned
        shareEarned
        agentCount
        playerCount
        betCount
      }
    }
  }
`;

export const AGENT_TRENDS_QUERY = gql`
  query AgentTrends($filter: AgentReportingFilter) {
    agentTrends(filter: $filter) {
      date
      turnover
      ggr
      commission
      share
      playerCount
    }
  }
`;

// Saved Reports Queries
export const SAVED_REPORTS_QUERY = gql`
  query SavedReports {
    savedReports {
      id
      name
      description
      reportType
      filtersJson
      isPinned
      createdAt
      updatedAt
    }
  }
`;

// Mutations
export const CREATE_SAVED_REPORT_MUTATION = gql`
  mutation CreateSavedReport($input: SavedReportInput!) {
    createSavedReport(input: $input) {
      id
      name
      description
      reportType
      filtersJson
      isPinned
      createdAt
      updatedAt
    }
  }
`;

export const UPDATE_SAVED_REPORT_MUTATION = gql`
  mutation UpdateSavedReport($id: ID!, $input: SavedReportInput!) {
    updateSavedReport(id: $id, input: $input) {
      id
      name
      description
      reportType
      filtersJson
      isPinned
      createdAt
      updatedAt
    }
  }
`;

export const DELETE_SAVED_REPORT_MUTATION = gql`
  mutation DeleteSavedReport($id: ID!) {
    deleteSavedReport(id: $id) {
      success
      message
    }
  }
`;

export const CREATE_EXPORT_JOB_MUTATION = gql`
  mutation CreateExportJob($input: ExportJobInput!) {
    createExportJob(input: $input) {
      id
      reportType
      exportFormat
      status
      fileUrl
      errorMessage
      scheduledAt
      completedAt
      createdAt
    }
  }
`;

export const REFRESH_SNAPSHOTS_MUTATION = gql`
  mutation RefreshSnapshots($domain: ReportingDomain, $dateFrom: String, $dateTo: String) {
    refreshReportingSnapshots(domain: $domain, dateFrom: $dateFrom, dateTo: $dateTo) {
      success
      message
    }
  }
`;

// Sports Drill-Down Queries
export const SPORTS_LEAGUE_BREAKDOWN_QUERY = gql`
  query SportsLeagueBreakdown($filter: SportsDrillDownFilter!) {
    sportsLeagueBreakdown(filter: $filter) {
      leagueId
      leagueName
      sportId
      sportName
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      playerCount
      eventCount
    }
  }
`;

export const SPORTS_EVENT_BREAKDOWN_QUERY = gql`
  query SportsEventBreakdown($filter: SportsDrillDownFilter!) {
    sportsEventBreakdown(filter: $filter) {
      eventId
      eventName
      leagueId
      leagueName
      sportId
      sportName
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      playerCount
      startTime
    }
  }
`;

export const SPORTS_MARKET_BREAKDOWN_QUERY = gql`
  query SportsMarketBreakdown($filter: SportsDrillDownFilter!) {
    sportsMarketBreakdown(filter: $filter) {
      marketId
      marketName
      eventId
      eventName
      leagueId
      leagueName
      sportId
      sportName
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      playerCount
    }
  }
`;

export const SPORTS_AGENT_BREAKDOWN_QUERY = gql`
  query SportsAgentBreakdown($filter: SportsDrillDownFilter!) {
    sportsAgentBreakdown(filter: $filter) {
      agentId
      agentName
      totalStakes
      totalPayouts
      grossGamingRevenue
      netGgr
      betCount
      playerCount
      commission
    }
  }
`;

export const SPORTS_PLAYER_BREAKDOWN_QUERY = gql`
  query SportsPlayerBreakdown($filter: SportsDrillDownFilter!) {
    sportsPlayerBreakdown(filter: $filter) {
      playerId
      playerUsername
      playerPhone
      directAgentId
      directAgentName
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      avgStake
      winRate
    }
  }
`;

// Casino Drill-Down Queries
export const CASINO_PROVIDER_BREAKDOWN_QUERY = gql`
  query CasinoProviderBreakdown($filter: CasinoDrillDownFilter!) {
    casinoProviderBreakdown(filter: $filter) {
      providerId
      providerName
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      playerCount
      gameCount
    }
  }
`;

export const CASINO_VENDOR_BREAKDOWN_QUERY = gql`
  query CasinoVendorBreakdown($filter: CasinoDrillDownFilter!) {
    casinoVendorBreakdown(filter: $filter) {
      vendorId
      vendorName
      providerId
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      playerCount
      gameCount
    }
  }
`;

export const CASINO_GAME_BREAKDOWN_QUERY = gql`
  query CasinoGameBreakdown($filter: CasinoDrillDownFilter!) {
    casinoGameBreakdown(filter: $filter) {
      gameId
      gameName
      vendorId
      vendorName
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      playerCount
      rtp
    }
  }
`;

export const CASINO_AGENT_BREAKDOWN_QUERY = gql`
  query CasinoAgentBreakdown($filter: CasinoDrillDownFilter!) {
    casinoAgentBreakdown(filter: $filter) {
      agentId
      agentName
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      playerCount
      commission
    }
  }
`;

export const CASINO_PLAYER_BREAKDOWN_QUERY = gql`
  query CasinoPlayerBreakdown($filter: CasinoDrillDownFilter!) {
    casinoPlayerBreakdown(filter: $filter) {
      playerId
      playerUsername
      playerPhone
      directAgentId
      directAgentName
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      avgStake
      winRate
    }
  }
`;

// Matka Drill-Down Queries
export const MATKA_TYPE_BREAKDOWN_QUERY = gql`
  query MatkaTypeBreakdown($filter: MatkaDrillDownFilter!) {
    matkaTypeBreakdown(filter: $filter) {
      matkaType
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      playerCount
      marketCount
    }
  }
`;

export const MATKA_MARKET_BREAKDOWN_QUERY = gql`
  query MatkaMarketBreakdown($filter: MatkaDrillDownFilter!) {
    matkaMarketBreakdown(filter: $filter) {
      matkaId
      marketName
      matkaType
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      playerCount
      sessionCount
    }
  }
`;

export const MATKA_SESSION_BREAKDOWN_QUERY = gql`
  query MatkaSessionBreakdown($filter: MatkaDrillDownFilter!) {
    matkaSessionBreakdown(filter: $filter) {
      marketSession
      matkaId
      marketName
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      playerCount
    }
  }
`;

export const MATKA_AGENT_BREAKDOWN_QUERY = gql`
  query MatkaAgentBreakdown($filter: MatkaDrillDownFilter!) {
    matkaAgentBreakdown(filter: $filter) {
      agentId
      agentName
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      playerCount
      commission
    }
  }
`;

export const MATKA_PLAYER_BREAKDOWN_QUERY = gql`
  query MatkaPlayerBreakdown($filter: MatkaDrillDownFilter!) {
    matkaPlayerBreakdown(filter: $filter) {
      playerId
      playerUsername
      playerPhone
      directAgentId
      directAgentName
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      avgStake
      winRate
    }
  }
`;

// Agent Drill-Down Queries
export const AGENT_PLAYER_BREAKDOWN_QUERY = gql`
  query AgentPlayerBreakdown($filter: AgentDrillDownFilter!) {
    agentPlayerBreakdown(filter: $filter) {
      playerId
      playerUsername
      totalStakes
      totalPayouts
      grossGamingRevenue
      betCount
      avgStake
      winRate
    }
  }
`;


// Daily snapshot pipeline health (reporting.snapshot-health)
export const SNAPSHOT_HEALTH_SUMMARY_QUERY = gql`
  query SnapshotHealthSummary {
    snapshotHealthSummary {
      nextRunAtIso
      snapshotTimezone
      runAtLocalTime
      healthCheckCron
      dailyLookbackDays
      backfillLookbackDays
      errorsLast24h
      backfillGapWarningsLast24h
      missingDaysCount
      lastSchedulePublishAt
      lastScheduleFailureAt
      lastScheduleFailureMessage
      lastJobCompleteAt
      lastDailyScheduleRunAt
      lastDailyScheduleRunStatus
      lastHealthBackfillRunAt
      lastHealthBackfillRunStatus
    }
  }
`;

export const SNAPSHOT_MISSING_DAYS_QUERY = gql`
  query SnapshotMissingDays(
    $lookbackDays: Int
    $tenant: String
    $whitelabelId: String
    $currency: String
  ) {
    snapshotMissingDays(
      lookbackDays: $lookbackDays
      tenant: $tenant
      whitelabelId: $whitelabelId
      currency: $currency
    ) {
      tenant
      whitelabelId
      currency
      reportingDay
      timezone
    }
  }
`;

export const SNAPSHOT_STALE_DAYS_QUERY = gql`
  query SnapshotStaleDays($lookbackDays: Int, $tenant: String, $whitelabelId: String) {
    snapshotStaleDays(lookbackDays: $lookbackDays, tenant: $tenant, whitelabelId: $whitelabelId) {
      tenant
      whitelabelId
      currency
      reportingDay
      timezone
      staleBetCount
      snapshotCreatedAt
      latestSettledAt
    }
  }
`;

export const SNAPSHOT_RUNS_QUERY = gql`
  query SnapshotRuns($limit: Int, $offset: Int, $trigger: String) {
    snapshotRuns(limit: $limit, offset: $offset, trigger: $trigger) {
      id
      trigger
      status
      startedAt
      finishedAt
      summaryJson
      errorMessage
    }
  }
`;

export const SNAPSHOT_EVENTS_QUERY = gql`
  query SnapshotEvents(
    $limit: Int
    $offset: Int
    $runId: ID
    $tenant: String
    $whitelabelId: String
    $errorsOnly: Boolean
    $eventType: String
  ) {
    snapshotEvents(
      limit: $limit
      offset: $offset
      runId: $runId
      tenant: $tenant
      whitelabelId: $whitelabelId
      errorsOnly: $errorsOnly
      eventType: $eventType
    ) {
      id
      runId
      occurredAt
      level
      eventType
      tenant
      whitelabelId
      currency
      reportingDay
      snapshotDateUtc
      reportingDayLabel
      timezoneNote
      domain
      pgBossJobId
      singletonKey
      message
      detailJson
    }
  }
`;

const SNAPSHOT_RUN_NODE = `
  id
  trigger
  status
  startedAt
  finishedAt
  summaryJson
  errorMessage
`;

const SNAPSHOT_EVENT_NODE = `
  id
  runId
  occurredAt
  level
  eventType
  tenant
  whitelabelId
  currency
  reportingDay
  snapshotDateUtc
  reportingDayLabel
  timezoneNote
  domain
  pgBossJobId
  singletonKey
  message
  detailJson
`;

export const SNAPSHOT_RUNS_CONNECTION_QUERY = gql`
  query SnapshotRunsConnection($first: Int!, $after: String, $trigger: String) {
    snapshotRunsConnection(first: $first, after: $after, trigger: $trigger) {
      nodes {
        ${SNAPSHOT_RUN_NODE}
      }
      pageInfo {
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }
    }
  }
`;

export const SNAPSHOT_EVENTS_CONNECTION_QUERY = gql`
  query SnapshotEventsConnection(
    $first: Int!
    $after: String
    $runId: ID
    $tenant: String
    $whitelabelId: String
    $errorsOnly: Boolean
    $eventType: String
  ) {
    snapshotEventsConnection(
      first: $first
      after: $after
      runId: $runId
      tenant: $tenant
      whitelabelId: $whitelabelId
      errorsOnly: $errorsOnly
      eventType: $eventType
    ) {
      nodes {
        ${SNAPSHOT_EVENT_NODE}
      }
      pageInfo {
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }
    }
  }
`;

export const SNAPSHOT_PG_BOSS_OVERVIEW_QUERY = gql`
  query SnapshotPgBossOverview {
    snapshotPgBossOverview {
      jobCounts {
        name
        state
        count
      }
      schedules {
        name
        cron
        timezone
      }
      readError
    }
  }
`;

export const ENQUEUE_SNAPSHOT_FOR_REPORTING_DAY_MUTATION = gql`
  mutation EnqueueSnapshotForReportingDay(
    $tenant: String
    $whitelabelId: String
    $reportingDay: String!
    $currency: String!
  ) {
    enqueueSnapshotForReportingDay(
      tenant: $tenant
      whitelabelId: $whitelabelId
      reportingDay: $reportingDay
      currency: $currency
    ) {
      success
      message
    }
  }
`;

export const ENQUEUE_SNAPSHOT_BACKFILL_RANGE_MUTATION = gql`
  mutation EnqueueSnapshotBackfillRange(
    $tenant: String
    $whitelabelId: String
    $dateFrom: String!
    $dateTo: String!
    $currency: String!
  ) {
    enqueueSnapshotBackfillRange(
      tenant: $tenant
      whitelabelId: $whitelabelId
      dateFrom: $dateFrom
      dateTo: $dateTo
      currency: $currency
    ) {
      success
      message
    }
  }
`;

export const REGENERATE_STALE_SNAPSHOT_MUTATION = gql`
  mutation RegenerateStaleSnapshot(
    $tenant: String!
    $whitelabelId: String!
    $reportingDay: String!
    $currency: String!
  ) {
    regenerateStaleSnapshot(
      tenant: $tenant
      whitelabelId: $whitelabelId
      reportingDay: $reportingDay
      currency: $currency
    ) {
      success
      message
    }
  }
`;

