import { gql } from '@apollo/client'

export const VIP_TIERS_QUERY = gql`
  query VIPTiers {
    vipTiers {
      id
      tenant
      name
      level
      minMonthlyDeposit
      depositPolicy { enabled methods min max daily monthly }
      color
      benefits
      perks {
        name
        description
        icon
      }
      status
      createdAt
      updatedAt
    }
  }
`

export const VIP_TIER_QUERY = gql`
  query VIPTier($id: ID!) {
    vipTier(id: $id) {
      id
      name
      level
      minMonthlyDeposit
      depositPolicy { enabled methods min max daily monthly }
      color
      benefits
      perks { name description icon }
      status
      createdAt
      updatedAt
    }
  }
`

export const VIP_MEMBERS_QUERY = gql`
  query VIPMembers($tierId: ID, $status: String, $query: String) {
    vipMembers(tierId: $tierId, status: $status, query: $query) {
      id
      tenant
      userId
      userName
      userEmail
      tierId
      tierName
      tierLevel
      currentPoints
      lifetimePoints
      nextTierId
      nextTierName
      pointsToNextTier
      joinedAt
      lastActivityAt
      status
      stats {
        totalDeposits
        totalWithdrawals
        totalBets
        totalWins
        netGGR
        avgBetSize
        sessionsCount
        currency
      }
    }
  }
`

export const VIP_MEMBER_QUERY = gql`
  query VIPMember($id: ID!) {
    vipMember(id: $id) {
      id
      tenant
      userId
      userName
      userEmail
      tierId
      tierName
      tierLevel
      currentPoints
      lifetimePoints
      nextTierId
      nextTierName
      pointsToNextTier
      joinedAt
      lastActivityAt
      status
      stats {
        totalDeposits
        totalWithdrawals
        totalBets
        totalWins
        netGGR
        avgBetSize
        sessionsCount
        currency
      }
    }
  }
`

export const VIP_STATS_QUERY = gql`
  query VIPStats {
    vipStats {
      totalMembers
      activeMembers
      newMembersToday
      totalPointsAwarded
      tierDistribution {
        tierId
        tierName
        tierLevel
        memberCount
        percentage
      }
      topMembers {
        id
        userId
        userName
        userEmail
        tierName
        tierLevel
        currentPoints
        lifetimePoints
        joinedAt
        status
      }
    }
  }
`

export const VIP_NEAR_NEXT_QUERY = gql`
  query VIPNearNextTier($threshold: Float, $limit: Int) {
    vipNearNextTier(threshold: $threshold, limit: $limit) {
      id
      userId
      userName
      userEmail
      tierName
      tierLevel
      currentPoints
      pointsToNextTier
      nextTierId
      nextTierName
      lastActivityAt
      status
    }
  }
`

export const VIP_SCHEDULES_QUERY = gql`
  query VIPSchedules {
    vipTierSchedules {
      id
      tierId
      toStatus
      effectiveAt
      createdAt
    }
  }
`

export const VIP_AUDIT_QUERY = gql`
  query VIPAudit($limit: Int) {
    vipTierAudit(limit: $limit) {
      id
      action
      tierId
      message
      at
      actor
    }
  }
`

export const VIP_VALIDATE_QUERY = gql`
  query VIPValidate {
    vipTierValidate {
      code
      message
      tierId
    }
  }
`

export const VIP_VERSIONS_QUERY = gql`
  query VIPVersions($tierId: ID!) {
    vipTierVersions(tierId: $tierId) {
      id
      tierId
      createdAt
      reason
    }
  }
`

export const CREATE_VIP_TIER_MUTATION = gql`
  mutation CreateVIPTier($input: VIPTierInput!) {
    createVIPTier(input: $input) {
      success
      message
      tier {
        id
        name
        level
        minMonthlyDeposit
        depositPolicy { enabled methods min max daily monthly }
        color
        benefits
        perks {
          name
          description
          icon
        }
        status
      }
    }
  }
`

export const UPDATE_VIP_TIER_MUTATION = gql`
  mutation UpdateVIPTier($id: ID!, $input: VIPTierInput!) {
    updateVIPTier(id: $id, input: $input) {
      success
      message
      tier {
        id
        name
        level
        minMonthlyDeposit
        depositPolicy { enabled methods min max daily monthly }
        color
        benefits
        perks {
          name
          description
          icon
        }
        status
      }
    }
  }
`

export const SET_VIP_TIER_STATUS_MUTATION = gql`
  mutation SetVIPTierStatus($id: ID!, $status: String!) {
    setVIPTierStatus(id: $id, status: $status) {
      success
      message
      tier { id status }
    }
  }
`

export const SCHEDULE_VIP_TIER_STATUS_MUTATION = gql`
  mutation ScheduleVIPTierStatus($tierId: ID!, $toStatus: String!, $effectiveAt: String!) {
    scheduleVIPTierStatus(tierId: $tierId, toStatus: $toStatus, effectiveAt: $effectiveAt) {
      id
      tierId
      toStatus
      effectiveAt
      createdAt
    }
  }
`

export const PUBLISH_SCHEDULED_VIP_TIER_MUTATION = gql`
  mutation PublishScheduledVIPTier($id: ID!) {
    publishScheduledVIPTier(id: $id) {
      id
      status
    }
  }
`

export const REVERT_VIP_TIER_VERSION_MUTATION = gql`
  mutation RevertVIPTierVersion($id: ID!) {
    revertVIPTierVersion(id: $id) {
      id
      name
      level
      status
    }
  }
`

export const DELETE_VIP_TIER_MUTATION = gql`
  mutation DeleteVIPTier($id: ID!) {
    deleteVIPTier(id: $id) {
      success
      message
    }
  }
`

export const CREATE_VIP_MEMBER_MUTATION = gql`
  mutation CreateVIPMember($input: CreateVIPMemberInput!) {
    createVIPMember(input: $input) {
      success
      message
      member {
        id
        userId
        userName
        tierName
        currentPoints
        status
      }
    }
  }
`

export const UPDATE_VIP_MEMBER_MUTATION = gql`
  mutation UpdateVIPMember($input: UpdateVIPMemberInput!) {
    updateVIPMember(input: $input) {
      success
      message
      member {
        id
        userId
        userName
        tierName
        currentPoints
        status
      }
    }
  }
`

export const ADD_VIP_POINTS_MUTATION = gql`
  mutation AddVIPPoints($input: AddVIPPointsInput!) {
    addVIPPoints(input: $input) {
      success
      message
      transaction {
        id
        points
        description
        balanceBefore
        balanceAfter
        createdAt
      }
      member {
        id
        currentPoints
        tierName
      }
    }
  }
`

export const REMOVE_VIP_POINTS_MUTATION = gql`
  mutation RemoveVIPPoints($input: RemoveVIPPointsInput!) {
    removeVIPPoints(input: $input) {
      success
      message
      transaction {
        id
        points
        description
        balanceBefore
        balanceAfter
        createdAt
      }
      member {
        id
        currentPoints
        tierName
      }
    }
  }
`

export const IMPORT_VIP_TIERS_MUTATION = gql`
  mutation ImportVIPTiers($json: String!) {
    importVIPTiers(json: $json)
  }
`

export const EXPORT_VIP_TIERS_MUTATION = gql`
  mutation ExportVIPTiers {
    exportVIPTiers
  }
`

