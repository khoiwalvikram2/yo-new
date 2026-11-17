import { gql } from '@apollo/client'

export const WHITELABEL_PG_SETTINGS = gql`
  query WhitelabelPgSettings {
    whitelabelPgSettings {
      id tenant provider enabled payinGateway payoutEnabled payoutGateway minPayout maxPayout displayName
      secretSiteKeyMasked hasSecretSiteKey webhookUrl payoutWebhookUrl
      minDeposit maxDeposit redirectSuccessUrl redirectFailureUrl updatedAt
    }
  }
`

/**
 * The gateways WeLivePay reports as assigned and active for the saved merchant key. The server refuses it
 * while no key is saved, so it is only asked once `hasSecretSiteKey` is true.
 */
export const WELIVEPAY_AVAILABLE_GATEWAYS = gql`
  query WelivepayAvailableGateways {
    welivepayAvailableGateways {
      payin { code key label }
      payout { code key label }
    }
  }
`

export const UPSERT_PG_SETTINGS = gql`
  mutation UpsertWhitelabelPgSettings($input: UpsertPgSettingsInput!) {
    upsertWhitelabelPgSettings(input: $input) {
      id enabled payinGateway payoutEnabled payoutGateway minPayout maxPayout displayName
      secretSiteKeyMasked hasSecretSiteKey webhookUrl payoutWebhookUrl
      minDeposit maxDeposit redirectSuccessUrl redirectFailureUrl updatedAt
    }
  }
`

/** One token backs both webhook URLs, so regenerating it replaces both. */
export const REGENERATE_PG_WEBHOOK_TOKEN = gql`
  mutation RegeneratePgWebhookToken {
    regeneratePgWebhookToken { id webhookUrl payoutWebhookUrl }
  }
`
