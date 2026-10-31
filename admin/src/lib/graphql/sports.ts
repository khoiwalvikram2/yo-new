import { gql } from '@apollo/client'

export const LIST_SPORTS = gql`
  query ListSports {
    sports { id key name sort sportCode status updatedAt }
  }
`

export const SEED_SPORTS = gql`
  mutation SeedSports($provider: String!) {
    seedSportsFromProvider(provider: $provider) { inserted updated }
  }
`

export const SET_SPORT_STATUS = gql`
  mutation SetSportStatus($key: String!, $status: SportStatus!) {
    setSportStatus(key: $key, status: $status)
  }
`

export const LIST_LEAGUES = gql`
  query ListLeagues($sportId: ID!) {
    leagues(sportId: $sportId) { id name sportId status updatedAt }
  }
`

export const LIST_EVENTS = gql`
  query ListEvents($leagueId: ID!) {
    events(leagueId: $leagueId) { id name leagueId startTime status updatedAt }
  }
`

/** Declare-result only: leagues that have open bets (matched/unmatched). */
export const LIST_LEAGUES_WITH_OPEN_BETS = gql`
  query ListLeaguesWithOpenBets($sportId: ID!) {
    leaguesWithOpenBets(sportId: $sportId) { id name sportId status updatedAt }
  }
`

/** Declare-result only: events that have open bets. */
export const LIST_EVENTS_WITH_OPEN_BETS = gql`
  query ListEventsWithOpenBets($leagueId: ID!) {
    eventsWithOpenBets(leagueId: $leagueId) { id name leagueId startTime status updatedAt }
  }
`

/** Declare-result only: markets that have open bets. */
export const MARKETS_WITH_OPEN_BETS = gql`
  query MarketsWithOpenBets($eventId: ID!) {
    marketsWithOpenBets(eventId: $eventId) {
      id
      name
      eventId
      type
      status
      updatedAt
    }
  }
`

// Provider-proxied (Manual mode)
export const LIST_PROVIDER_LEAGUES = gql`
  query ProviderLeagues($sportCode: String!) {
    providerLeagues(sportCode: $sportCode) { id name }
  }
`

export const LIST_PROVIDER_EVENTS = gql`
  query ProviderEvents($leagueId: ID!) {
    providerEvents(leagueId: $leagueId) { id name startTime }
  }
`

export const LIST_EXISTING_LEAGUES = gql`
  query ExistingLeagues($sportId: ID!) {
    existingLeagueCodes(sportId: $sportId)
  }
`

export const LIST_EXISTING_EVENTS = gql`
  query ExistingEvents($leagueCode: String!) {
    existingEventCodes(leagueCode: $leagueCode)
  }
`

export const LEAGUE_SETTINGS = gql`
  query LeagueSettings($leagueId: ID!, $tierId: ID) {
    leagueSettings(leagueId: $leagueId, tierId: $tierId) {
      leagueId
      tierId
      exchangeMinStake
      exchangeMaxStake
      bookmakerMinStake
      bookmakerMaxStake
      fancyMinStake
      fancyMaxStake
      exchangeDelay
      bookmakerDelay
      fancyDelay
      exchangeCooldown
      bookmakerCooldown
      fancyCooldown
      exchangeMinOdds
      exchangeMaxOdds
      exchangeCommission
      bookmakerCommission
      fancyCommission
      exchangeExposureDaily
      exchangeExposureWeekly
      exchangeExposureCap
      bookmakerExposureDaily
      bookmakerExposureWeekly
      bookmakerExposureCap
      fancyExposureDaily
      fancyExposureWeekly
      fancyExposureCap
      cashoutActive
      riskLevel
      riskThreshold
      volatilityThreshold
      alertOnBreach
      alertChannel
      alertRateLimit
    }
  }
`

export const EVENT_SETTINGS = gql`
  query EventSettings($eventId: ID!, $tierId: String) {
    eventSettings(eventId: $eventId, tierId: $tierId) {
      eventId
      tierId
      exchangeMinStake
      exchangeMaxStake
      bookmakerMinStake
      bookmakerMaxStake
      fancyMinStake
      fancyMaxStake
      exchangeDelay
      bookmakerDelay
      fancyDelay
      exchangeCooldown
      bookmakerCooldown
      fancyCooldown
      exchangeMinOdds
      exchangeMaxOdds
      exchangeCommission
      bookmakerCommission
      fancyCommission
      exchangeExposureDaily
      exchangeExposureWeekly
      exchangeExposureCap
      bookmakerExposureDaily
      bookmakerExposureWeekly
      bookmakerExposureCap
      fancyExposureDaily
      fancyExposureWeekly
      fancyExposureCap
      cashoutActive
      riskLevel
      riskThreshold
      volatilityThreshold
      alertOnBreach
      alertChannel
      alertRateLimit
    }
  }
`

export const UPSERT_LEAGUE_SETTINGS = gql`
  mutation UpsertLeagueSettings($leagueIds: [ID!]!, $input: UpsertLeagueSettingsInput!) {
    upsertLeagueSettings(leagueIds: $leagueIds, input: $input) { success message }
  }
`

export const UPSERT_EVENT_SETTINGS = gql`
  mutation UpsertEventSettings($eventIds: [ID!]!, $input: UpsertEventSettingsInput!) {
    upsertEventSettings(eventIds: $eventIds, input: $input) { success message }
  }
`

export const SET_LEAGUE_STATUS = gql`
  mutation SetLeagueStatus($id: ID!, $status: SportStatus!) {
    setLeagueStatus(id: $id, status: $status)
  }
`

export const SET_EVENT_STATUS = gql`
  mutation SetEventStatus($id: ID!, $status: SportStatus!) {
    setEventStatus(id: $id, status: $status)
  }
`

export const PERSIST_SELECTIONS = gql`
  mutation PersistSelections($events: [PersistEventSelectionInput!]!) {
    persistSportsSelections(events: $events) {
      success
      message
      leaguesUpserted
      eventsUpserted
      marketsUpserted
      runnersUpserted
      skippedEventsCount
      skippedMarketsCount
      skippedEvents {
        leagueCode
        leagueName
        eventCode
        eventName
        reason
      }
    }
  }
`

export const UPSERT_AUTO_CONFIG = gql`
  mutation UpsertAutoConfig($sportId: ID!, $leagueCodes: [String!], $frequencyHours: Int!, $active: Boolean) {
    upsertAutoSportsConfig(sportId: $sportId, leagueCodes: $leagueCodes, frequencyHours: $frequencyHours, active: $active) {
      success
      message
    }
  }
`

export const RUN_AUTO_NOW = gql`
  mutation RunAutoNow($sportId: ID!, $leagueCodes: [String!]) {
    runAutoSportsIngestion(sportId: $sportId, leagueCodes: $leagueCodes) {
      success
      message
      leaguesUpserted
      eventsUpserted
      marketsUpserted
      runnersUpserted
      skippedEventsCount
      skippedMarketsCount
      skippedEvents {
        leagueCode
        leagueName
        eventCode
        eventName
        reason
      }
    }
  }
`

export const DELETE_AUTO_CONFIG = gql`
  mutation DeleteAutoConfig($sportId: ID!) {
    deleteAutoSportsConfig(sportId: $sportId) { success message }
  }
`

export const LIST_MARKETS = gql`
  query ListMarkets($eventId: ID!) {
    marketsByEvent(eventId: $eventId) {
      id
      name
      eventId
      type
      status
      updatedAt
    }
  }
`

export const SET_MARKET_STATUS = gql`
  mutation SetMarketStatus($id: ID!, $status: SportStatus!) {
    setMarketStatus(id: $id, status: $status) { success message }
  }
`

export const LIST_AUTO_CONFIGS = gql`
  query ListAutoConfigs {
    autoSportsConfigs {
      id sportId leagueCodes frequencyHours active lastRunAt lastRunStatus nextRunAt updatedAt
    }
  }
`

export const LIST_AUTO_FREQUENCIES = gql`
  query ListAutoFrequencies {
    availableAutoFrequencies
  }
`

export const LIST_AUTO_RUNS = gql`
  query ListAutoRuns($sportId: ID!, $limit: Int) {
    autoRuns(sportId: $sportId, limit: $limit) {
      id
      sportId
      startedAt
      finishedAt
      status
      leaguesAdded
      eventsAdded
      marketsAdded
      runnersAdded
      skippedEventsCount
      skippedEvents {
        leagueCode
        leagueName
        eventCode
        eventName
        reason
      }
      errorMessage
    }
  }
`

export const DELETE_AUTO_RUNS = gql`
  mutation DeleteAutoRuns($sportId: ID!) {
    deleteAutoRuns(sportId: $sportId) { success message }
  }
`

export const REORDER_SPORTS = gql`
  mutation ReorderSports($inputs: [ReorderSportsInput!]!) {
    reorderSports(inputs: $inputs) { success message }
  }
`

export const REORDER_LEAGUES = gql`
  mutation ReorderLeagues($inputs: [ReorderLeaguesInput!]!) {
    reorderLeagues(inputs: $inputs) { success message }
  }
`

export const SPORT_SETTINGS = gql`
  query SportSettings($sportId: ID!, $tierId: ID) {
    sportSettings(sportId: $sportId, tierId: $tierId) {
      sportId
      tierId
      exchangeMinStake
      exchangeMaxStake
      bookmakerMinStake
      bookmakerMaxStake
      fancyMinStake
      fancyMaxStake
      exchangeDelay
      bookmakerDelay
      fancyDelay
      exchangeCooldown
      bookmakerCooldown
      fancyCooldown
      exchangeMinOdds
      exchangeMaxOdds
      exchangeCommission
      bookmakerCommission
      fancyCommission
      exchangeExposureDaily
      exchangeExposureWeekly
      exchangeExposureCap
      bookmakerExposureDaily
      bookmakerExposureWeekly
      bookmakerExposureCap
      fancyExposureDaily
      fancyExposureWeekly
      fancyExposureCap
      cashoutActive
      riskLevel
      riskThreshold
      volatilityThreshold
      alertOnBreach
      alertChannel
      alertRateLimit
    }
  }
`

export const SUB_BOOK = gql`
  subscription MarketBook($marketId: ID!) {
    book(marketId: $marketId) {
      marketId
      kind
      at
      seq
      selections {
        selectionId
        selectionName
        items {
          price
          backVol
          layVol
        }
      }
    }
  }
`

export const SUB_FANCY_BOOK = gql`
  subscription FancyBook($marketId: ID!) {
    fancyBook(marketId: $marketId) {
      marketId
      at
      lines {
        id
        name
        back
        lay
        at
      }
    }
  }
`

export const SUB_MARKET_STATE = gql`
  subscription MarketState($marketId: ID!) {
    marketState(marketId: $marketId) {
      id
      state
      updatedAt
    }
  }
`

export const UPSERT_SPORT_SETTINGS = gql`
  mutation UpsertSportSettings($input: UpsertSportSettingsInput!) {
    upsertSportSettings(input: $input) { success message }
  }
`

export const LIST_SPORTS_AUDIT = gql`
  query ListSportsAudit($domain: String, $action: String, $actor: ID, $from: String, $to: String, $limit: Int) {
    audit(domain: $domain, action: $action, actor: $actor, from: $from, to: $to, limit: $limit) {
      id
      domain
      action
      actorId
      actor { name type }
      resourceType
      resourceId
      before
      after
      timestamp
    }
  }
`

export const LIST_RUNNING_EVENTS = gql`
  query RunningEvents($sport: String, $from: String, $to: String) {
    runningEvents(sport: $sport, from: $from, to: $to) {
      id
      sport
      competition
      name
      startTime
      status
      marketCount
      matchedVolume
      totalLiquidity
      betsCount
      inPlay
      updatedAt
      lastBetAt
    }
  }
`

export const LIST_RUNNING_MARKETS = gql`
  query RunningMarkets($state: MarketState, $sport: String, $from: String, $to: String) {
    markets(state: $state, sport: $sport, from: $from, to: $to) {
      id
      tenant
      sport
      competition
      event
      eventId
      name
      state
      kind
      liquidity
      unmatchedOrders
      cutoffAt
      tickSize
      createdBy
      updatedAt
      runners {
        id
        name
        sortOrder
      }
    }
  }
`

export const GET_EVENT_DETAIL = gql`
  query EventDetail($eventId: ID!) {
    eventDetail(eventId: $eventId) {
      event {
        id
        sport
        competition
        name
        startTime
        status
        marketCount
        totalLiquidity
        matchedVolume
        inPlay
        updatedAt
        eventCode
      }
      markets {
        id
        eventId
        name
        kind
        state
        liquidity
        unmatchedOrders
        cutoffAt
        tickSize
        updatedAt
        marketCode
        runners {
          id
          name
          sortOrder
          selectionCode
        }
      }
    }
  }
`

export const SUB_EVENT_LIVE = gql`
  subscription EventLive($eventId: ID!) {
    eventLive(eventId: $eventId) {
      eventId
      at
      markets {
        marketId
        kind
        state
        top {
          selectionId
          selectionName
          back
          lay
        }
        fancy {
          id
          name
          back
          lay
          at
        }
      }
    }
  }
`

export const CREATE_SPORTS_RESULT = gql`
  mutation CreateSportsResult($input: SportsResultInput!) {
    createSportsResult(input: $input) {
      success
      message
    }
  }
`

export const ROLLBACK_SPORTS_RESULT = gql`
  mutation RollbackSportsResult($input: RollbackSportsResultInput!) {
    rollbackSportsResult(input: $input) {
      success
      message
    }
  }
`

export const SPORTS_RESULTS = gql`
  query SportsResults($query: SportsResultsQuery) {
    sportsResults(query: $query) {
      items {
        id
        tenant
        whitelabelId
        isGlobal
        sportId
        leagueId
        eventId
        marketId
        marketType
        runnerId
        selectionName
        result
        declaredBy
        declaredByName
        declaredAt
        rolledBackAt
        rolledBackBy
        rolledBackByName
        rollbackReason
        rollbackTag
        createdAt
        sport {
          id
          key
          name
          sportCode
          status
        }
        league {
          id
          name
          status
        }
        event {
          id
          name
          startTime
          status
        }
        market {
          id
          name
          type
          status
        }
        runner {
          id
          name
          sortPriority
        }
      }
      total
    }
  }
`

export const MARKETS_BY_EVENT = gql`
  query MarketsByEvent($eventId: ID!) {
    marketsByEvent(eventId: $eventId) {
      id
      name
      eventId
      type
      status
      updatedAt
    }
  }
`

export const RUNNERS_BY_MARKET = gql`
  query RunnersByMarket($marketId: ID!) {
    runnersByMarket(marketId: $marketId) {
      id
      name
      selectionCode
      sortPriority
      status
    }
  }
`

export const SEARCH_SPORTS_HIERARCHY = gql`
  query SearchSportsHierarchy($input: SportsSearchInput!) {
    searchSportsHierarchy(input: $input) {
      type
      sportId
      sportName
      leagueId
      leagueName
      eventId
      eventName
    }
  }
`

export const SPORTS_RESULT_STATS = gql`
  query SportsResultStats { sportsResultStats { total today exchange bookmaker fancy rolledBack } }
`

export const LIST_AUTO_RUNS_PAGE = gql`
  query ListAutoRuns($sportId: ID!, $limit: Int, $offset: Int) {
    autoRunsPage(sportId: $sportId, limit: $limit, offset: $offset) {
      total
      items {
      id
      sportId
      startedAt
      finishedAt
      status
      leaguesAdded
      eventsAdded
      marketsAdded
      runnersAdded
      skippedEventsCount
      skippedEvents {
        leagueCode
        leagueName
        eventCode
        eventName
        reason
      }
      errorMessage
      }
    }
  }
`
