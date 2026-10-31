import { gql } from '@apollo/client'

export const WHITELABEL_PG_SETTINGS = gql`
  query WhitelabelPgSettings {
    whitelabelPgSettings {
      id tenant provider enabled displayName
      secretSiteKeyMasked hasSecretSiteKey webhookUrl
      minDeposit maxDeposit redirectSuccessUrl redirectFailureUrl updatedAt
    }
  }
`

export const UPSERT_PG_SETTINGS = gql`
  mutation UpsertWhitelabelPgSettings($input: UpsertPgSettingsInput!) {
    upsertWhitelabelPgSettings(input: $input) {
      id enabled displayName secretSiteKeyMasked hasSecretSiteKey webhookUrl
      minDeposit maxDeposit redirectSuccessUrl redirectFailureUrl updatedAt
    }
  }
`

export const REGENERATE_PG_WEBHOOK_TOKEN = gql`
  mutation RegeneratePgWebhookToken {
    regeneratePgWebhookToken { id webhookUrl }
  }
`
