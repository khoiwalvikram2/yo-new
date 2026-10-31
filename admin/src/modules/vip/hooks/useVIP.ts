import { useQuery, useMutation } from '@apollo/client'
import {
  VIP_TIERS_QUERY,
  VIP_MEMBERS_QUERY,
  VIP_MEMBER_QUERY,
  VIP_STATS_QUERY,
  VIP_NEAR_NEXT_QUERY,
  VIP_SCHEDULES_QUERY,
  VIP_AUDIT_QUERY,
  VIP_VALIDATE_QUERY,
  VIP_VERSIONS_QUERY,
  CREATE_VIP_TIER_MUTATION,
  UPDATE_VIP_TIER_MUTATION,
  SET_VIP_TIER_STATUS_MUTATION,
  SCHEDULE_VIP_TIER_STATUS_MUTATION,
  PUBLISH_SCHEDULED_VIP_TIER_MUTATION,
  REVERT_VIP_TIER_VERSION_MUTATION,
  DELETE_VIP_TIER_MUTATION,
  CREATE_VIP_MEMBER_MUTATION,
  UPDATE_VIP_MEMBER_MUTATION,
  ADD_VIP_POINTS_MUTATION,
  REMOVE_VIP_POINTS_MUTATION,
  IMPORT_VIP_TIERS_MUTATION,
  EXPORT_VIP_TIERS_MUTATION
} from '../services/vipService'
import type { VIPTier, VIPMember, VIPStats } from '../types'

export function useVIPTiers() {
  return useQuery<{ vipTiers: VIPTier[] }>(VIP_TIERS_QUERY, {
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  })
}

export function useVIPMembers(filters?: { tierId?: string; status?: string; query?: string }) {
  return useQuery<{ vipMembers: VIPMember[] }>(VIP_MEMBERS_QUERY, {
    variables: filters,
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  })
}

export function useVIPMember(id: string) {
  return useQuery<{ vipMember: VIPMember }>(VIP_MEMBER_QUERY, {
    variables: { id },
    errorPolicy: 'all',
    skip: !id,
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  })
}

export function useVIPStats() {
  return useQuery<{ vipStats: VIPStats }>(VIP_STATS_QUERY, {
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  })
}

export function useVIPNearNext(threshold = 0.2, limit = 10) {
  return useQuery<{ vipNearNextTier: VIPMember[] }>(VIP_NEAR_NEXT_QUERY, {
    variables: { threshold, limit },
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  })
}

export function useVIPSchedules() {
  return useQuery(VIP_SCHEDULES_QUERY, { 
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  })
}

export function useVIPAudit(limit = 20) {
  return useQuery(VIP_AUDIT_QUERY, { 
    variables: { limit }, 
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  })
}

export function useVIPValidate() {
  return useQuery(VIP_VALIDATE_QUERY, { 
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  })
}

export function useVIPVersions(tierId: string) {
  return useQuery(VIP_VERSIONS_QUERY, { 
    variables: { tierId }, 
    skip: !tierId, 
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
  })
}

export function useCreateVIPTier() {
  return useMutation(CREATE_VIP_TIER_MUTATION, {
    refetchQueries: [{ query: VIP_TIERS_QUERY }],
    awaitRefetchQueries: true,
  })
}

export function useUpdateVIPTier() {
  return useMutation(UPDATE_VIP_TIER_MUTATION, {
    refetchQueries: [{ query: VIP_TIERS_QUERY }],
    awaitRefetchQueries: true,
  })
}

export function useSetVIPTierStatus() {
  return useMutation(SET_VIP_TIER_STATUS_MUTATION, {
    refetchQueries: [{ query: VIP_TIERS_QUERY }]
  })
}

export function useScheduleVIPTierStatus() {
  return useMutation(SCHEDULE_VIP_TIER_STATUS_MUTATION, {
    refetchQueries: [{ query: VIP_SCHEDULES_QUERY }]
  })
}

export function usePublishScheduledVIPTier() {
  return useMutation(PUBLISH_SCHEDULED_VIP_TIER_MUTATION, {
    refetchQueries: [{ query: VIP_TIERS_QUERY }, { query: VIP_SCHEDULES_QUERY }]
  })
}

export function useRevertVIPTierVersion() {
  return useMutation(REVERT_VIP_TIER_VERSION_MUTATION, {
    refetchQueries: [{ query: VIP_TIERS_QUERY }]
  })
}

export function useDeleteVIPTier() {
  return useMutation(DELETE_VIP_TIER_MUTATION, {
    refetchQueries: [{ query: VIP_TIERS_QUERY }]
  })
}

export function useCreateVIPMember() {
  return useMutation(CREATE_VIP_MEMBER_MUTATION, {
    refetchQueries: [{ query: VIP_MEMBERS_QUERY }, { query: VIP_STATS_QUERY }]
  })
}

export function useUpdateVIPMember() {
  return useMutation(UPDATE_VIP_MEMBER_MUTATION, {
    refetchQueries: [{ query: VIP_MEMBERS_QUERY }, { query: VIP_STATS_QUERY }]
  })
}

export function useAddVIPPoints() {
  return useMutation(ADD_VIP_POINTS_MUTATION, {
    refetchQueries: [{ query: VIP_MEMBERS_QUERY }, { query: VIP_STATS_QUERY }]
  })
}

export function useRemoveVIPPoints() {
  return useMutation(REMOVE_VIP_POINTS_MUTATION, {
    refetchQueries: [{ query: VIP_MEMBERS_QUERY }, { query: VIP_STATS_QUERY }]
  })
}

export function useImportVIPTiers() {
  return useMutation(IMPORT_VIP_TIERS_MUTATION, { refetchQueries: [{ query: VIP_TIERS_QUERY }] })
}

export function useExportVIPTiers() {
  return useMutation(EXPORT_VIP_TIERS_MUTATION)
}

