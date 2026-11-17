import { useQuery } from '@apollo/client'
import { CHIP_READ_OPTIONS } from '@/modules/chips/chipHooks'
import { MY_CHIP_ACCOUNT_QUERY, type MyChipAccountData } from '@/lib/graphql/chips'
import { useAuthStore } from '@/shared/core/authStore'
import type { ChipWalletFigures } from './walletData'

const CHIPS_POLL_MS = 60000

export interface AgentCreditState {
  visible: boolean
  loading: boolean
  /** The CREDIT agent's own chips (spec 2026-11-02 §8); null until the first answer. */
  chips: ChipWalletFigures | null
}

/**
 * The topbar wallet of a CREDIT agent. Its chips come from myChipAccount, read outside the Apollo cache like
 * every chips read (modules/chips/chipHooks), so the wallet never overwrites another agents query on the
 * page. A deposit or withdrawal made on any chips screen refetches it by name (MyChipAccount); the poll
 * covers moves made elsewhere, such as the upline depositing to this agent. It reads no sharing figures:
 * CREDIT has no partnership split (spec decision 2), and a SHARING agent has its own wallet.
 */
export function useAgentCredit(): AgentCreditState {
  const agent = useAuthStore(s => s.agent)
  const isCreditAgent = agent?.schemeType === 'CREDIT'

  const { data, error } = useQuery<MyChipAccountData>(MY_CHIP_ACCOUNT_QUERY, {
    ...CHIP_READ_OPTIONS,
    skip: !isCreditAgent,
    pollInterval: CHIPS_POLL_MS,
  })

  const account = data?.agents?.myChipAccount ?? null
  const answered = Boolean(data?.agents)

  // A failed read with nothing to show hides the wallet, as before, and so does an answer with no chips
  // account; a later poll that fails keeps the figures.
  if (!isCreditAgent || (!account && (error || answered))) {
    return { visible: false, loading: false, chips: null }
  }

  if (!account) {
    return { visible: true, loading: true, chips: null }
  }

  return {
    visible: true,
    loading: false,
    chips: {
      currency: account.currency,
      balance: account.balance,
      downlineBalance: account.downlineBalance,
      creditReference: account.creditReference,
      refPnl: account.refPnl,
    },
  }
}
