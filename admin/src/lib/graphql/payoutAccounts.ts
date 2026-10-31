import { gql } from '@apollo/client'

export const ADMIN_PAYOUT_ACCOUNTS = gql`
  query AdminPayoutAccounts($input: AdminPayoutAccountFilter) {
    adminPayoutAccounts(input: $input) {
      items {
        id
        userId
        method
        accountNumber
        ifscCode
        bankName
        accountHolderName
        approvalStatus
        rejectionReason
        approvedBy
        approvedAt
        createdAt
        user {
          id
          name
          phone
          email
        }
      }
      total
    }
  }
`

export const APPROVE_PAYOUT_ACCOUNT = gql`
  mutation ApprovePayoutAccount($input: ApprovePayoutAccountInput!) {
    approvePayoutAccount(input: $input) {
      success
      message
      account {
        id
        userId
        method
        accountNumber
        ifscCode
        bankName
        accountHolderName
        approvalStatus
        rejectionReason
        approvedBy
        approvedAt
        createdAt
        user {
          id
          name
          phone
          email
        }
      }
    }
  }
`

export const REJECT_PAYOUT_ACCOUNT = gql`
  mutation RejectPayoutAccount($input: RejectPayoutAccountInput!) {
    rejectPayoutAccount(input: $input) {
      success
      message
      account {
        id
        userId
        method
        accountNumber
        ifscCode
        bankName
        accountHolderName
        approvalStatus
        rejectionReason
        approvedBy
        approvedAt
        createdAt
        user {
          id
          name
          phone
          email
        }
      }
    }
  }
`

export const ADMIN_PAYOUT_ACCOUNT_STATS = gql`
  query AdminPayoutAccountStats {
    adminPayoutAccountStats { total pending approved rejected approvalRate rejectionRate }
  }
`
