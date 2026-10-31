import { gql } from '@apollo/client'

export const AI_AVAILABILITY = gql`
  query AiAvailability {
    aiAvailability {
      enabled
      reason
    }
    aiEntitlement {
      enabled
      chatLimit
      limitPeriod
      used
      remaining
      blockedReason
    }
  }
`

export const AI_WHITELABEL_SETTINGS = gql`
  query AiWhitelabelSettings {
    aiWhitelabelSettings {
      tenant
      enabled
      chatLimit
      limitPeriod
      used
      remaining
      updatedBy
      updatedAt
    }
  }
`

export const SET_AI_WHITELABEL_SETTINGS = gql`
  mutation SetAiWhitelabelSettings(
    $tenant: String!
    $enabled: Boolean!
    $chatLimit: Int!
    $limitPeriod: String
  ) {
    setAiWhitelabelSettings(
      tenant: $tenant
      enabled: $enabled
      chatLimit: $chatLimit
      limitPeriod: $limitPeriod
    ) {
      tenant
      enabled
      chatLimit
      limitPeriod
      used
      remaining
      updatedBy
      updatedAt
    }
  }
`

export const AI_CONVERSATION = gql`
  query AiConversation($id: ID!) {
    aiConversation(id: $id) {
      id
      title
      messages {
        id
        role
        content
        createdAt
      }
      pendingProposals {
        id
        toolName
        summary
        expiresAt
      }
    }
  }
`

export const AI_CHAT = gql`
  mutation AiChat($message: String!, $conversationId: ID) {
    aiChat(message: $message, conversationId: $conversationId) {
      conversationId
      reply
      toolsUsed
      proposals {
        id
        toolName
        summary
        expiresAt
      }
    }
  }
`

export const AI_CONFIRM_ACTION = gql`
  mutation AiConfirmAction($proposalId: ID!) {
    aiConfirmAction(proposalId: $proposalId) {
      status
      message
    }
  }
`

export const AI_REJECT_ACTION = gql`
  mutation AiRejectAction($proposalId: ID!) {
    aiRejectAction(proposalId: $proposalId) {
      status
      message
    }
  }
`

/** Minimal whitelabel list, so unconfigured whitelabels still appear on the settings page. */
export const WHITELABELS_FOR_AI = gql`
  query WhitelabelsForAi {
    whitelabels {
      id
      name
    }
  }
`
