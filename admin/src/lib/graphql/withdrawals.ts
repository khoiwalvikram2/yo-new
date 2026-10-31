import { gql } from '@apollo/client'

export const ADMIN_WITHDRAWAL_REQUESTS = gql`
  query AdminWithdrawalRequests($input: AdminWithdrawalFilter) {
    adminWithdrawalRequests(input: $input) {
      items {
        id
        userId
        amount
        currency
        status
        reviewerId
        reviewedAt
        note
        createdAt
        updatedAt
        account {
          id
          method
          accountNumber
          ifscCode
          bankName
          accountHolderName
        }
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

export const SET_WITHDRAWAL_STATUS = gql`
  mutation SetWithdrawalStatus($input: SetWithdrawalStatusInput!) {
    setWithdrawalStatus(input: $input) {
      success
      message
      request {
        id
        userId
        amount
        currency
        status
        reviewerId
        reviewedAt
        note
        createdAt
        updatedAt
        account {
          id
          method
          accountNumber
          ifscCode
          bankName
          accountHolderName
        }
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

export const ADMIN_WITHDRAWAL_REQUEST_STATS = gql`
  query AdminWithdrawalRequestStats {
    adminWithdrawalRequestStats { totalRequests pending processing completed failed totalAmount completionRate failureRate }
  }
`
