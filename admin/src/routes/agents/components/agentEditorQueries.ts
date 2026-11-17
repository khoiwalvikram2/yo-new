import { gql } from '@apollo/client'

/**
 * The parent of the agent being created or edited, read by id. The Basic Info step takes its
 * domains and level from it, the Scheme step its rates (the caps), and the Review step its name.
 * One document, so the steps share one cache entry. A CREDIT parent's free chips come from the
 * chips API (useChipAccount), not from here.
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
      }
    }
  }
`
