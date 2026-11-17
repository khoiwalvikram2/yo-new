import { gql } from '@apollo/client'

/** Whether "Pay via WeLivePay" is offered: payouts on and a merchant key saved for the payment whitelabel.
 *  A Super Admin without a selected whitelabel gets `tenant: null, payoutEnabled: false`. */
export const WITHDRAWAL_GATEWAY_CONFIG = gql`
  query WithdrawalGatewayConfig {
    withdrawalGatewayConfig { tenant payoutEnabled }
  }
`

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
        gatewayPayout { orderId status amount utr failureReason merchantTransactionId canReject }
        account {
          id
          method
          accountNumber
          ifscCode
          bankName
          accountHolderName
          deletedAt
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
          deletedAt
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

/* WeLivePay IMPS payouts of a withdrawal. Each answers the payout as last read from the gateway; the
   withdrawal itself is read again from the list. */
export const SEND_WELIVEPAY_PAYOUT = gql`
  mutation SendWelivepayPayout($id: ID!) {
    sendWelivepayPayout(id: $id) { orderId status amount utr failureReason merchantTransactionId canReject }
  }
`

export const REFRESH_WELIVEPAY_PAYOUT = gql`
  mutation RefreshWelivepayPayout($id: ID!) {
    refreshWelivepayPayout(id: $id) { orderId status amount utr failureReason merchantTransactionId canReject }
  }
`

export const REJECT_WELIVEPAY_PAYOUT = gql`
  mutation RejectWelivepayPayout($id: ID!, $note: String!) {
    rejectWelivepayPayout(id: $id, note: $note) { orderId status amount utr failureReason merchantTransactionId canReject }
  }
`

export const ADMIN_WITHDRAWAL_REQUEST_STATS = gql`
  query AdminWithdrawalRequestStats {
    adminWithdrawalRequestStats { totalRequests pending processing completed failed totalAmount completionRate failureRate }
  }
`
