import { gql } from '@apollo/client'

export const OTP_PROVIDERS = gql`
  query OtpProviders {
    otpProviders {
      id
      provider
      region
      senderId
      templateId
      baseUrl
      active
      priority
      accountSidMasked
      accessKeyMasked
      authTokenMasked
      secretKeyMasked
      apiKeyMasked
      apiSecretMasked
      updatedAt
      createdAt
    }
  }
`

export const UPSERT_OTP_PROVIDER = gql`
  mutation UpsertOtpProvider($input: OtpProviderInput!) {
    upsertOtpProvider(input: $input) {
      success
      message
    }
  }
`

