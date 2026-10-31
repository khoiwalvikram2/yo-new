import { gql } from '@apollo/client'

export const ADMIN_DEPOSIT_REQUESTS = gql`
  query AdminDepositRequests($input: ListDepositRequestsInput) {
    adminDepositRequests(input: $input) {
      items {
        id
        tenant
        userId
        amount
        currency
        method
        utr
        referenceId
        proofKey
        proofUrl
        status
        reviewerId
        reviewedAt
        note
        walletTxnId
        createdAt
        updatedAt
        user {
          id
          name
          email
          phone
        }
      }
      total
    }
  }
`

export const MY_DEPOSIT_METHODS = gql`
  query MyDepositMethods {
    myDepositMethods {
      id
      tenant
      enabledMethods
      banks {
        id
        accountName
        accountNumber
        ifsc
        bankName
        branch
        notes
        minAmount
        maxAmount
        weight
      }
      upis {
        id
        upiId
        displayName
        qrKey
        qrUrl
        minAmount
        maxAmount
        weight
      }
      limits {
        min
        max
      }
      createdAt
      updatedAt
    }
  }
`

export const WHITELABEL_PAYMENT_METHODS = gql`
  query WhitelabelPaymentMethods {
    whitelabelPaymentMethods {
      id
      tenant
      enabledMethods
      banks {
        id
        accountName
        accountNumber
        ifsc
        bankName
        branch
        notes
        minAmount
        maxAmount
        weight
        enabled
        vipTierIds
      }
      upis {
        id
        upiId
        displayName
        qrKey
        qrUrl
        minAmount
        maxAmount
        weight
        enabled
        vipTierIds
      }
      limits {
        min
        max
      }
      createdAt
      updatedAt
    }
  }
`

export const CREATE_DEPOSIT_REQUEST = gql`
  mutation CreateDepositRequest($input: CreateDepositRequestInput!) {
    createDepositRequest(input: $input) {
      success
      message
      depositRequest {
        id
        tenant
        userId
        amount
        currency
        method
        utr
        referenceId
        proofKey
        status
        createdAt
        updatedAt
      }
    }
  }
`

export const APPROVE_DEPOSIT_REQUEST = gql`
  mutation ApproveDepositRequest($input: ApproveDepositRequestInput!) {
    approveDepositRequest(input: $input) {
      success
      message
      depositRequest {
        id
        status
        reviewerId
        reviewedAt
        note
        walletTxnId
      }
    }
  }
`

export const REJECT_DEPOSIT_REQUEST = gql`
  mutation RejectDepositRequest($input: RejectDepositRequestInput!) {
    rejectDepositRequest(input: $input) {
      success
      message
      depositRequest {
        id
        status
        reviewerId
        reviewedAt
        note
      }
    }
  }
`

export const UPSERT_WHITELABEL_PAYMENT_METHODS = gql`
  mutation UpsertWhitelabelPaymentMethods($input: UpsertWhitelabelPaymentMethodsInput!) {
    upsertWhitelabelPaymentMethods(input: $input) {
      success
      message
      paymentMethods {
        id
        tenant
        enabledMethods
        banks {
          id
          accountName
          accountNumber
          ifsc
          bankName
          branch
          notes
          minAmount
          maxAmount
          weight
          enabled
          vipTierIds
        }
        upis {
          id
          upiId
          displayName
          qrKey
          qrUrl
          minAmount
          maxAmount
          weight
          enabled
          vipTierIds
        }
        limits {
          min
          max
        }
        createdAt
        updatedAt
      }
    }
  }
`

export const DEPOSIT_REQUEST_UPDATED_SUBSCRIPTION = gql`
  subscription DepositRequestUpdated($tenant: String) {
    depositRequestUpdated(tenant: $tenant) {
      id
      tenant
      userId
      amount
      currency
      method
      utr
      referenceId
      proofKey
      proofUrl
      status
      reviewerId
      reviewedAt
      note
      walletTxnId
      createdAt
      updatedAt
      user {
        id
        name
        email
        phone
      }
    }
  }
`

export const ADMIN_DEPOSIT_REQUEST_STATS = gql`
  query AdminDepositRequestStats {
    adminDepositRequestStats { totalRequests pending approved rejected totalAmount approvalRate rejectionRate }
  }
`
