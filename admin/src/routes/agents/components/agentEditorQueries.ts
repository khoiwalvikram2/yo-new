import { gql } from '@apollo/client'

/**
 * The parent of the agent being created or edited, read by id. The Basic Info step takes its
 * domains and level from it, the Scheme step its rates (the caps) and available credit, and the
 * Review step its name. One document, so the steps share one cache entry.
 */
export const PARENT_AGENT_QUERY = gql`
  query GetParentAgent($id: ID!) {
    agents {
      agentProfile(id: $id) {
        id
        username
        levelIndex
        schemeType
        status
        allowedDomains
        sharingRates {
          domain
          rate
        }
        commissionRates {
          domain
          rate
        }
        creditAvailable
      }
    }
  }
`
