import { gql } from '@apollo/client'

export const ADMIN_WITHDRAWAL_HISTORY = gql`
  query AdminWithdrawalHistory($id: ID!) {
    adminWithdrawalHistory(id: $id) {
      status
      reviewerId
      reviewedAt
      note
    }
  }
`

