import { gql } from '@apollo/client'

/**
 * Every currency for the Currency Management page, inactive ones included: this page is where they are
 * activated again or deleted. Query.currencies alone lists only the active ones (the display-currency list
 * the whole admin reads), so a deactivated currency vanished from here for good. Named GetCurrencies, the
 * name the currency mutations refetch (shared/core/useCurrency.ts).
 */
export const ALL_CURRENCIES = gql`
  query GetCurrencies {
    currencies(includeInactive: true) {
      code
      name
      symbol
      decimals
      isActive
      exchangeRate
    }
  }
`
