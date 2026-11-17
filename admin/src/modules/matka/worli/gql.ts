import { gql } from '@apollo/client'

export const WORLI_INSTANCES = gql`
  query WorliInstances($date: String, $marketId: ID, $status: [WorliStatus!], $search: String, $hasResult: Boolean, $page: Int, $limit: Int, $sort: String) {
    worliRunningInstances(date: $date, marketId: $marketId, status: $status, search: $search, hasResult: $hasResult, page: $page, limit: $limit, sort: $sort) {
      total
      items {
        id
        marketId
        marketName
        runDate
        side
        status
        scheduledOpenAt
        scheduledLockAt
        scheduledCloseAt
        operatorMessage
        counters { betCount totalStakeMinor exposureTotalMinor worstOutcomeKey worstOutcomePlMinor }
        bidRulesVersionId
      }
    }
  }
`

export const WORLI_INSTANCE = gql`
  query WorliInstance($id: ID!) { worliInstance(id: $id) {
    id marketId marketName runDate side status scheduledOpenAt scheduledLockAt scheduledCloseAt operatorMessage canUnlock
    counters { betCount totalStakeMinor exposureTotalMinor worstOutcomeKey worstOutcomePlMinor }
    bidRulesVersionId
  } }
`

export const WORLI_INSTANCE_UPDATED = gql`
  subscription WorliInstanceUpdated($id: ID!) { worliInstanceUpdated(id: $id) {
    id marketId marketName runDate side status scheduledOpenAt scheduledLockAt scheduledCloseAt operatorMessage canUnlock
    counters { betCount totalStakeMinor exposureTotalMinor worstOutcomeKey worstOutcomePlMinor }
    bidRulesVersionId
  } }
`

export const WORLI_BET_CREATED = gql`
  subscription WorliBetCreated($instanceId: ID!) { worliBetCreated(instanceId: $instanceId) {
    id userId matkaId marketName marketSession bidType betNumbers betAmount payoutMultiplier potentialWin status currency createdAt
  } }
`

export const WORLI_BOOK = gql`
  query WorliBook($instanceId: ID!, $side: WorliSessionSide!) { worliBook(instanceId: $instanceId, side: $side) {
    totalStakeMinor
    groups { bidType items { selection betCount plMinor } }
  } }
`

export const WORLI_BETS = gql`
  query WorliBets($instanceId: ID!, $filters: WorliBetsFilter, $page: Int, $limit: Int) {
    worliBets(instanceId: $instanceId, filters: $filters, page: $page, limit: $limit) {
      total
      items {
        id userId bidType betNumbers betAmount payoutMultiplier potentialWin status currency createdAt
      }
    }
  }
`

export const WORLI_ACTIVITY = gql`
  query WorliActivity($instanceId: ID!) {
    worliActivity(instanceId: $instanceId) { id action reason actorId createdAt }
  }
`

export const PAUSE_WORLI = gql`mutation Pause($id: ID!, $reason: String!) { pauseWorliInstance(id: $id, reason: $reason) { success message } }`
export const RESUME_WORLI = gql`mutation Resume($id: ID!, $reason: String!) { resumeWorliInstance(id: $id, reason: $reason) { success message } }`
export const LOCK_WORLI = gql`mutation Lock($id: ID!, $reason: String!) { lockNowWorliInstance(id: $id, reason: $reason) { success message } }`
export const CLOSE_WORLI = gql`mutation Close($id: ID!, $reason: String!) { closeNowWorliInstance(id: $id, reason: $reason) { success message } }`
export const UNLOCK_WORLI = gql`mutation Unlock($id: ID!, $reason: String!) { unlockWorliInstance(id: $id, reason: $reason) { success message } }`
export const SET_MESSAGE_WORLI = gql`mutation Msg($id: ID!, $message: String!) { setWorliMarketMessage(id: $id, message: $message) { success message } }`
export const ADJUST_SUSPEND_WORLI = gql`mutation Adj($id: ID!, $minutes: Int!, $reason: String!) { adjustWorliSuspendMinutes(id: $id, minutes: $minutes, reason: $reason) { success message } }`
export const VOID_BET = gql`mutation VoidBet($id: ID!, $reason: String!) { voidMatkaBet(id: $id, reason: $reason) { success message } }`

