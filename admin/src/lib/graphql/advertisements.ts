import { gql } from '@apollo/client'

export const ADVERTISEMENTS = gql`
  query Advertisements($status: AdvertisementStatus) {
    advertisements(status: $status) {
      id
      title
      subtitle
      imageUrl
      type
      url
      order
      status
      deviceType
      createdAt
      updatedAt
    }
  }
`

export const CREATE_ADVERTISEMENT = gql`
  mutation CreateAdvertisement($input: CreateAdvertisementInput!) {
    createAdvertisement(input: $input) {
      success
      message
    }
  }
`

export const UPDATE_ADVERTISEMENT = gql`
  mutation UpdateAdvertisement($input: UpdateAdvertisementInput!) {
    updateAdvertisement(input: $input) {
      success
      message
    }
  }
`

export const DELETE_ADVERTISEMENT = gql`
  mutation DeleteAdvertisement($id: ID!) {
    deleteAdvertisement(id: $id) {
      success
      message
    }
  }
`

export const REORDER_ADVERTISEMENTS = gql`
  mutation ReorderAdvertisements($orders: [ReorderAdvertisementInput!]!) {
    reorderAdvertisements(orders: $orders) {
      success
      message
    }
  }
`

