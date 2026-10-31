import { gql } from '@apollo/client'

export const MY_ADMIN_PREFERENCES = gql`
  query MyAdminPreferences {
    myAdminPreferences {
      directorMode
      selectedWhitelabelId
    }
  }
`

export const UPDATE_ADMIN_PREFERENCES = gql`
  mutation UpdateAdminPreferences($input: AdminPreferencesInput!) {
    updateAdminPreferences(input: $input) {
      success
      message
      preferences {
        directorMode
        selectedWhitelabelId
      }
    }
  }
`
