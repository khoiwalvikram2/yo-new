import { gql } from '@apollo/client'

export const BONUS_KPIS_QUERY = gql`
  query BonusKPIsForAwards($filter: BonusReportingFilter) {
    bonusKPIs(filter: $filter) {
      totalIssued
      totalRedeemed
      totalExpired
      totalCancelled
      outstandingLiability
      totalWagering
      totalRevenue
      awardCount
      redemptionCount
      playerCount
      roi
    }
  }
`

export const BONUS_AWARDS_PAGE_STATS_QUERY = gql`
  query BonusAwardsPageStats($filters: BonusAwardsPageFilters) {
    bonusAwardsPageStats(filters: $filters) {
      total
      pending
      active
      completed
      expired
      cancelled
      totalBonusPaid
      bonusWalletTotal
      wageringRemaining
      bonusUses
      bonusToCashTransferred
    }
  }
`

export const BONUS_AWARDS_PAGE_QUERY = gql`
  query BonusAwardsPage($filters: BonusAwardsPageFilters, $offset: Int, $limit: Int) {
    bonusAwardsPage(filters: $filters, offset: $offset, limit: $limit) {
      total
      items {
        id
        campaignId
        campaignName
        userId
        userName
        userPhone
        domain
        type
        amount
        currency
        wageringReq
        currentWagering
        status
        awardedAt
        expiresAt
        completedAt
        triggerAmount
        firstDepositRequired
        firstDepositUnlocked
        distributionType
        statusUpdatedAt
        statusUpdatedByName
        statusUpdatedByPhone
        statusUpdatedByRemark
      }
    }
  }
`

export type BonusAwardsPageFiltersInput = {
  dateFrom?: string
  dateTo?: string
  status?: string[]
  domain?: string
  playerSearch?: string
  campaignId?: number
  agentUsername?: string
}

export const SET_BONUS_AWARD_STATUS_MUTATION = gql`
  mutation SetBonusAwardStatus($awardId: ID!, $status: BonusAwardStatus!, $remark: String!) {
    setBonusAwardStatus(awardId: $awardId, status: $status, remark: $remark) {
      success
      message
      newStatus
    }
  }
`

export const ACTIVATE_BONUS_AWARD_ADMIN_MUTATION = gql`
  mutation ActivateBonusAwardAdmin($awardId: ID!, $remark: String!) {
    activateBonusAwardAdmin(awardId: $awardId, remark: $remark) {
      success
      message
      code
    }
  }
`

export const SWITCH_BONUS_AWARD_ADMIN_MUTATION = gql`
  mutation SwitchBonusAwardAdmin($awardId: ID!, $remark: String!) {
    switchBonusAwardAdmin(awardId: $awardId, remark: $remark) {
      success
      message
      code
    }
  }
`

export const FORFEIT_BONUS_AWARD_ADMIN_MUTATION = gql`
  mutation ForfeitBonusAwardAdmin($awardId: ID!, $remark: String!) {
    forfeitBonusAwardAdmin(awardId: $awardId, remark: $remark) {
      success
      message
      code
    }
  }
`
