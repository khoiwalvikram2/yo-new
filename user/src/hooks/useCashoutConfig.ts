import { useState, useEffect } from 'react'
import { graphqlRequest } from '@/lib/graphqlClient'

export function useCashoutConfig(eventId: string | null | undefined) {
  const [isEnabled, setIsEnabled] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(false)

  useEffect(() => {
    if (!eventId) {
      setIsEnabled(false)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    graphqlRequest<{ cashoutConfig: boolean }>(
      `
        query CashoutConfig($eventId: ID!) {
          cashoutConfig(eventId: $eventId)
        }
      `,
      { eventId }
    )
      .then((response) => {
        // GraphQL returns the value directly
        setIsEnabled(response.cashoutConfig === true)
      })
      .catch(() => {
        setIsEnabled(false)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [eventId])

  return { isEnabled, isLoading }
}

