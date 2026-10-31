import { gql } from '@apollo/client'

/* The /promotions/campaigns documents, moved out of CampaignsPage.tsx unchanged (page migration
   Task 110) so the page test can answer them through MockedProvider. Gate 10 compares them with the
   pre-image byte for byte once whitespace is normalised; none may change here. */

// A Promotion carries scheduleStart/scheduleEnd, not a nested `schedule`, and
// every mutation returns a PromotionPayload wrapper rather than the promotion
// itself. Both were wrong here, so this whole page failed validation and
// rendered nothing.
export const PromotionsQuery = gql`
  query Promotions { promotions { id name status updatedAt scheduleStart scheduleEnd } }
`
export const CreatePromotion = gql`
  mutation CreatePromotion($input: PromotionCreateInput!) {
    createPromotion(input: $input) { success message promotion { id name status updatedAt } }
  }
`
export const PublishPromotion = gql`
  mutation PublishPromotion($id: ID!) {
    publishPromotion(id: $id) { success message promotion { id status updatedAt } }
  }
`
export const PausePromotion = gql`
  mutation PausePromotion($id: ID!) {
    pausePromotion(id: $id) { success message promotion { id status updatedAt } }
  }
`
