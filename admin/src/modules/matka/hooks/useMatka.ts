import { useQuery, useMutation } from '@apollo/client'
import {
  MATKAS_QUERY,
  MATKA_QUERY,
  MATKA_RATE_VERSIONS_QUERY,
  CREATE_MATKA_MUTATION,
  UPDATE_MATKA_MUTATION,
  DELETE_MATKA_MUTATION,
  SET_MATKA_STATUS_MUTATION,
  UPDATE_MATKA_SETTINGS_MUTATION,
  REORDER_MATKAS_MUTATION,
  CLONE_MATKA_MUTATION,
  CREATE_RATE_VERSION_MUTATION,
  EXPORT_MATKAS_MUTATION,
  IMPORT_MATKAS_MUTATION,
  MATKA_DEFAULT_RATES_QUERY,
  UPDATE_MATKA_DEFAULT_RATES_MUTATION,
  MATKA_BID_RULES_QUERY,
  CREATE_MATKA_BID_RULE,
  UPDATE_MATKA_BID_RULE,
  DELETE_MATKA_BID_RULE,
} from '../services/matkaService'
import { MATKA_CATALOG_QUERY } from '@/lib/graphql/matka'

export function useMatkas(filters?: any, options?: { skip?: boolean }) {
  return useQuery(filters?.limit && filters.limit > 100 ? MATKA_CATALOG_QUERY : MATKAS_QUERY, { variables: { filters }, errorPolicy: 'all', ...options })
}

export function useMatka(id: string) {
  return useQuery(MATKA_QUERY, { variables: { id }, skip: !id, errorPolicy: 'all' })
}

export function useMatkaRateVersions(matkaId: string) {
  return useQuery(MATKA_RATE_VERSIONS_QUERY, { variables: { matkaId }, skip: !matkaId, errorPolicy: 'all' })
}

export function useCreateMatka() {
  return useMutation(CREATE_MATKA_MUTATION, { refetchQueries: [{ query: MATKAS_QUERY }] })
}

export function useUpdateMatka() {
  return useMutation(UPDATE_MATKA_MUTATION, { refetchQueries: [{ query: MATKAS_QUERY }] })
}

export function useDeleteMatka() {
  return useMutation(DELETE_MATKA_MUTATION, { refetchQueries: [{ query: MATKAS_QUERY }] })
}

export function useSetMatkaStatus() {
  return useMutation(SET_MATKA_STATUS_MUTATION, { refetchQueries: [{ query: MATKAS_QUERY }] })
}

export function useUpdateMatkaSettings() {
  return useMutation(UPDATE_MATKA_SETTINGS_MUTATION, { refetchQueries: [{ query: MATKAS_QUERY }] })
}

export function useReorderMatkas() {
  return useMutation(REORDER_MATKAS_MUTATION, { 
    refetchQueries: [{ 
      query: MATKAS_QUERY,
      // Refetch will use the current variables from active queries
    }],
    awaitRefetchQueries: true,
  })
}

export function useCloneMatka() {
  return useMutation(CLONE_MATKA_MUTATION, { refetchQueries: [{ query: MATKAS_QUERY }] })
}

export function useCreateRateVersion() {
  return useMutation(CREATE_RATE_VERSION_MUTATION, { refetchQueries: [] })
}

export function useExportMatkas() {
  // Using query since schema exposes export as query returning string
  return useQuery(EXPORT_MATKAS_MUTATION, { variables: { filters: {} }, skip: true })
}

export function useImportMatkas() {
  return useMutation(IMPORT_MATKAS_MUTATION, { refetchQueries: [{ query: MATKAS_QUERY }] })
}

export function useMatkaDefaultRates() {
  return useQuery(MATKA_DEFAULT_RATES_QUERY, { errorPolicy: 'all' })
}

export function useUpdateMatkaDefaultRates() {
  return useMutation(UPDATE_MATKA_DEFAULT_RATES_MUTATION, { refetchQueries: [{ query: MATKA_DEFAULT_RATES_QUERY }] })
}

// Bid rules hooks
export function useMatkaBidRules(filters: any) {
  return useQuery(MATKA_BID_RULES_QUERY, { variables: { filters }, skip: !filters?.matkaId, errorPolicy: 'all' })
}

export function useCreateMatkaBidRule() {
  return useMutation(CREATE_MATKA_BID_RULE, { refetchQueries: [{ query: MATKA_BID_RULES_QUERY }] })
}

export function useUpdateMatkaBidRule() {
  return useMutation(UPDATE_MATKA_BID_RULE, { refetchQueries: [{ query: MATKA_BID_RULES_QUERY }] })
}

export function useDeleteMatkaBidRule() {
  return useMutation(DELETE_MATKA_BID_RULE, { refetchQueries: [{ query: MATKA_BID_RULES_QUERY }] })
}

