import { gql } from '@apollo/client';

export const MY_AGENT_SHARING_QUERY = gql`
  query MyAgentSharing {
    myAgentSharing {
      sharingRates {
        domain
        rate
      }
      allTimeTotals {
        domain
        totalAmount
      }
      currentPeriodTotals {
        domain
        totalAmount
      }
      currency
    }
  }
`;

export const AGENT_SHARING_UPDATED_SUBSCRIPTION = gql`
  subscription AgentSharingUpdated($agentId: ID!) {
    agentSharingUpdated(agentId: $agentId) {
      sharingRates {
        domain
        rate
      }
      allTimeTotals {
        domain
        totalAmount
      }
      currentPeriodTotals {
        domain
        totalAmount
      }
      currency
    }
  }
`;
