import { useQuery, useMutation, type QueryHookOptions } from '@apollo/client'
import {
  SPORTS_RESULTS_QUERY,
  CREATE_SPORTS_RESULT_MUTATION,
  ROLLBACK_SPORTS_RESULT_MUTATION,
} from './graphql'
import type { SportsResultFilters } from './types'

export function useSportsResults(filters?: SportsResultFilters, options?: QueryHookOptions) {
  return useQuery(SPORTS_RESULTS_QUERY, {
    variables: { query: filters },
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
    ...(options || {}),
  })
}

export function useCreateSportsResult() {
  return useMutation(CREATE_SPORTS_RESULT_MUTATION, {
    refetchQueries: [{ query: SPORTS_RESULTS_QUERY }],
    errorPolicy: 'all',
  })
}

export function useRollbackSportsResult() {
  return useMutation(ROLLBACK_SPORTS_RESULT_MUTATION, {
    refetchQueries: [{ query: SPORTS_RESULTS_QUERY }],
    errorPolicy: 'all',
  })
}

