import { gql } from '@apollo/client';

export const MY_WHITELABEL_CREDIT_QUERY = gql`
  query MyWhitelabelCredit {
    myWhitelabelCredit {
      creditLimit
      creditUsed
      creditAvailable
      creditAlertThreshold
      usagePercentage
      isNearLimit
    }
  }
`;

export const MY_WHITELABEL_CREDIT_HISTORY_QUERY = gql`
  query MyWhitelabelCreditHistory($limit: Int, $offset: Int) {
    myWhitelabelCreditHistory(limit: $limit, offset: $offset) {
      id
      transactionType
      amount
      balanceBefore
      balanceAfter
      reason
      createdBy
      createdByType
      createdAt
      playerId
      playerName
      playerEmail
      playerUsername
      playerPhone
    }
  }
`;

export const MY_WHITELABEL_SHARING_QUERY = gql`
  query MyWhitelabelSharing {
    myWhitelabelSharing {
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

export const WHITELABEL_SHARING_UPDATED_SUBSCRIPTION = gql`
  subscription WhitelabelSharingUpdated($whitelabelId: ID!) {
    whitelabelSharingUpdated(whitelabelId: $whitelabelId) {
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

export const WHITELABEL_CREDIT_UPDATED_SUBSCRIPTION = gql`
  subscription WhitelabelCreditUpdated($whitelabelId: ID!) {
    whitelabelCreditUpdated(whitelabelId: $whitelabelId) {
      creditLimit
      creditUsed
      creditAvailable
      creditAlertThreshold
      usagePercentage
      isNearLimit
    }
  }
`;

