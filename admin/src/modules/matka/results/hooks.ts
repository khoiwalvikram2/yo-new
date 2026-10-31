import { useQuery, useMutation, useSubscription, type QueryHookOptions } from '@apollo/client'
import {
  MATKA_RESULTS_QUERY,
  CREATE_MATKA_RESULT_MUTATION,
  ROLLBACK_MATKA_RESULT_MUTATION,
  MATKA_RESULT_EVENTS_SUBSCRIPTION,
  MATKA_RESULT_EXISTS_QUERY,
} from './graphql'

export interface MatkaResultFilters {
  matkaId?: string
  type?: 'open' | 'close'
  dateFrom?: string
  dateTo?: string
  search?: string
  rolledBack?: boolean
  page?: number
  limit?: number
  sort?: string
}

export function useMatkaResults(filters?: MatkaResultFilters, options?: QueryHookOptions) {
  return useQuery(MATKA_RESULTS_QUERY, {
    variables: { filters },
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
    ...(options || {}),
  })
}

export function useCreateMatkaResult() {
  return useMutation(CREATE_MATKA_RESULT_MUTATION, {
    refetchQueries: [{ query: MATKA_RESULTS_QUERY }],
    errorPolicy: 'all',
  })
}

export function useRollbackMatkaResult() {
  return useMutation(ROLLBACK_MATKA_RESULT_MUTATION, {
    refetchQueries: [{ query: MATKA_RESULTS_QUERY }],
    errorPolicy: 'all',
  })
}

export function useMatkaResultEvents() {
  return useSubscription(MATKA_RESULT_EVENTS_SUBSCRIPTION, {
    errorPolicy: 'all',
  })
}

export function useMatkaResultExists(
  matkaId?: string,
  date?: string,
  type?: 'open' | 'close',
  options?: QueryHookOptions
) {
  const skip = !matkaId || !date || !type
  return useQuery(MATKA_RESULT_EXISTS_QUERY, {
    variables: { matkaId, date, type },
    errorPolicy: 'all',
    fetchPolicy: 'no-cache',
    nextFetchPolicy: 'no-cache',
    notifyOnNetworkStatusChange: true,
    skip,
    ...(options || {}),
  })
}

