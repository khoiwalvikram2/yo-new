import { gql } from '@apollo/client'

export const BETS_PAGE_QUERY = gql`
  query BetsPage($domain: BetDomain!, $filters: BetsPageFilters, $offset: Int, $limit: Int) {
    betsPage(domain: $domain, filters: $filters, offset: $offset, limit: $limit) {
      items {
        __typename
        ... on SportsBet {
          id
          userId
          userName
          userPhone
          sportName
          leagueName
          eventName
          sportsMarketName: marketName
          selectionName
          side
          stake
          price
          oddsSize
          liability
          pl
          result
          eventResult
          sportsStatus: status
          currency
          createdAt
          walletType
          ipAddress
          deviceInfo
          location
          country
          campaign {
            id
            name
            type
            distributionType
            wageringReq
            validTo
            validFrom
            domain
            status
            startDate
            endDate
            amount
            percentage
            amountType
          }
        }
        ... on CasinoBet {
          id
          userId
          userName
          userPhone
          gameName
          vendorName
          tableId
          stake
          payout
          winAmount
          netAmount
          casinoStatus: status
          currency
          createdAt
          walletType
          sessionId
          gameRoundId
          transactionId
          settledAt
          providerCode
          campaign {
            id
            name
            type
            distributionType
            wageringReq
            validTo
            validFrom
            domain
            status
            startDate
            endDate
            amount
            percentage
            amountType
          }
        }
        ... on MatkaBet {
          id
          userId
          userName
          userPhone
          marketName
          matkaType
          marketSession
          bidType
          betNumbers
          betAmount
          payoutMultiplier
          potentialWin
          actualWin
          result
          matkaStatus: status
          currency
          createdAt
          walletType
          campaign {
            id
            name
            type
            distributionType
            wageringReq
            validTo
            validFrom
            domain
            status
            startDate
            endDate
            amount
            percentage
            amountType
          }
        }
      }
      total
    }
  }
`

export type BetDomain = 'ALL' | 'SPORTS' | 'CASINO' | 'MATKA'
export type BetsPageFilters = {
  status?: string[]
  dateFrom?: string
  dateTo?: string
  agentUsername?: string
  playerSearch?: string
  search?: string
  walletType?: string
}
