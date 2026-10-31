import { gql } from '@apollo/client'

/* The /promotions/content documents, moved out of ContentPage.tsx unchanged (page migration
   Task 111) so the page test can answer them through MockedProvider. Gate 10 compares them with the
   pre-image byte for byte once whitespace is normalised; none may change here. */

export const ContentQuery = gql`
  query Content { content { id name locale body status updatedAt } }
`
export const CreateContent = gql`
  mutation CreateContent($input: ContentCreateInput!) { createContent(input: $input) { id name status } }
`
export const UpdateContent = gql`
  mutation UpdateContent($input: ContentUpdateInput!) { updateContent(input: $input) { id name locale body status updatedAt } }
`
export const PublishContent = gql`
  mutation PublishContent($id: ID!) { publishContent(id: $id) { id status updatedAt } }
`
