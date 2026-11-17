import { useCallback } from 'react'
import { useApolloClient, useQuery } from '@apollo/client'
import { useCurrency } from '@/shared/core/CurrencyContext'
import {
  CHIP_ACCOUNT_QUERY,
  CHIP_POOL_QUERY,
  CHIP_QUERY_NAMES,
  MY_CHIP_ACCOUNT_QUERY,
  type ChipAccountData,
  type ChipAccountType,
  type ChipAccountVariables,
  type ChipPoolData,
  type MyChipAccountData,
} from '@/lib/graphql/chips'
import { roundChips, type ChipFormat } from './chipModel'

/*
 * The chips reads stay out of the Apollo cache. Each of them sits under Query.agents, an object with no id
 * that the app's cache keeps inline and has no merge policy for, so a cached read would replace whatever
 * another agents query on the same page had stored there. That query would find its fields gone and fetch
 * again, replacing this one's in turn. Kept out of the cache, the chips screens can sit next to any other
 * agents query; money figures are wanted fresh anyway.
 */
export const CHIP_READ_OPTIONS = { fetchPolicy: 'no-cache', errorPolicy: 'all' } as const

/** Formats chips in the account's currency (the whitelabel's, spec §2), kept to 2 decimals. */
export function useChipFormat(currency?: string | null): ChipFormat {
  const { formatAmount } = useCurrency()
  return useCallback((value: number) => formatAmount(roundChips(value), currency || undefined), [formatAmount, currency])
}

export interface ChipReadOptions {
  skip?: boolean
}

/** One account's chip figures: an agent's or a player's, within the caller's read scope. */
export function useChipAccount(accountType: ChipAccountType, accountId: string | null | undefined, options: ChipReadOptions = {}) {
  const query = useQuery<ChipAccountData, ChipAccountVariables>(CHIP_ACCOUNT_QUERY, {
    ...CHIP_READ_OPTIONS,
    variables: { accountType, accountId: accountId ?? '' },
    skip: options.skip || !accountId,
  })
  return { account: query.data?.agents?.chipAccount ?? null, loading: query.loading, error: query.error, refetch: query.refetch }
}

/** The signed-in CREDIT agent's own account; null for an admin and for agents of other schemes. */
export function useMyChipAccount(options: ChipReadOptions = {}) {
  const query = useQuery<MyChipAccountData>(MY_CHIP_ACCOUNT_QUERY, { ...CHIP_READ_OPTIONS, skip: options.skip })
  return { account: query.data?.agents?.myChipAccount ?? null, loading: query.loading, error: query.error, refetch: query.refetch }
}

/** The whitelabel credit pool that root deposits come from (admin only). */
export function useChipPool(options: ChipReadOptions = {}) {
  const query = useQuery<ChipPoolData>(CHIP_POOL_QUERY, { ...CHIP_READ_OPTIONS, skip: options.skip })
  return { pool: query.data?.agents?.chipPool ?? null, loading: query.loading, error: query.error, refetch: query.refetch }
}

/**
 * Refetches the chips reads that are on screen, after a move. Only the active ones are named: Apollo warns
 * about a name it cannot find. A read that fails shows its own error, so nothing is reported here.
 */
export function useRefreshChips(): () => Promise<void> {
  const client = useApolloClient()
  return useCallback(async () => {
    const names = new Set<string>()
    client.getObservableQueries('active').forEach((query) => {
      if (query.queryName && (CHIP_QUERY_NAMES as readonly string[]).includes(query.queryName)) names.add(query.queryName)
    })
    if (names.size === 0) return
    try {
      await client.refetchQueries({ include: [...names] })
    } catch {
      // Each read keeps its own error state (errorPolicy 'all'); the move itself already succeeded.
    }
  }, [client])
}
