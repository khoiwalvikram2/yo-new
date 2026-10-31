import { gql } from '@apollo/client';

export const MY_AGENT_COMMISSION_QUERY = gql`
  query MyAgentCommission {
    myAgentCommission {
      commissionRates {
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

export const AGENT_COMMISSION_UPDATED_SUBSCRIPTION = gql`
  subscription AgentCommissionUpdated($agentId: ID!) {
    agentCommissionUpdated(agentId: $agentId) {
      commissionRates {
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
