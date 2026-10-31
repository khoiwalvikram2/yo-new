import { gql } from '@apollo/client'

export const MATKAS_QUERY = gql`
  query Matkas($filters: MatkaFilters) {
    matkas(filters: $filters) { 
      items { 
        id 
        name 
        code 
        description
        timezone 
        status 
        priority 
        schedule
        limits
        settings
        createdAt
        updatedAt 
      } 
      total 
    }
  }
`

export const MATKA_QUERY = gql`
  query Matka($id: ID!) {
    matka(id: $id) { id name code description timezone schedule status limits visibility priority settings createdAt updatedAt deletedAt }
  }
`

export const MATKAS_BY_IDS = gql`
  query MatkasByIds($matkaIds: [ID!]!) {
    matkasByIds(matkaIds: $matkaIds) {
      id
      name
      code
      description
      timezone
      status
      priority
      createdAt
      updatedAt
    }
  }
`

export const MATKA_RATE_VERSIONS_QUERY = gql`
  query MatkaRateVersions($matkaId: ID!) {
    matkaRateVersions(matkaId: $matkaId) { id matkaId versionTag entries { betType payoutMultiplier minOdds maxOdds } effectiveFrom effectiveTo createdBy createdAt }
  }
`

export const CREATE_MATKA_MUTATION = gql`
  mutation CreateMatka($input: MatkaCreateInput!) {
    createMatka(input: $input) {
      success
      message
      matka { id name code status }
    }
  }
`

export const UPDATE_MATKA_MUTATION = gql`
  mutation UpdateMatka($input: MatkaUpdateInput!) {
    updateMatka(input: $input) {
      success
      message
      matka { id name code status updatedAt }
    }
  }
`

export const DELETE_MATKA_MUTATION = gql`
  mutation DeleteMatka($id: ID!, $reason: String!) { deleteMatka(id: $id, reason: $reason) }
`

export const SET_MATKA_STATUS_MUTATION = gql`
  mutation SetMatkaStatus($id: ID!, $toStatus: MatkaStatus!, $reason: String) {
    setMatkaStatus(id: $id, toStatus: $toStatus, reason: $reason) {
      success
      message
      matka { id status }
    }
  }
`

export const UPDATE_MATKA_SETTINGS_MUTATION = gql`
  mutation UpdateMatkaSettings($id: ID!, $settings: JSON!, $tierId: ID, $reason: String) {
    updateMatkaSettings(id: $id, settings: $settings, tierId: $tierId, reason: $reason) {
      success
      message
      matka { id settings }
    }
  }
`

export const REORDER_MATKAS_MUTATION = gql`
  mutation ReorderMatkas($input: [MatkaReorderInput!]!) {
    reorderMatkas(input: $input) { success message }
  }
`

// Bid Rules
export const MATKA_BID_RULES_QUERY = gql`
  query MatkaBidRules($filters: MatkaBidRuleFilters) {
    matkaBidRules(filters: $filters) {
      items {
        id
        matkaId
        matkaType
        marketName
        marketSession
        bidType
        percentage
        includeAll
        includedPlayers
        minStake
        maxStake
        exposureCap
        status
        priority
        notes
        createdAt
        updatedAt
      }
      total
    }
  }
`

export const CREATE_MATKA_BID_RULE = gql`
  mutation CreateMatkaBidRule($input: MatkaBidRuleInput!) {
    createMatkaBidRule(input: $input) {
      id
      matkaId
    }
  }
`

export const UPDATE_MATKA_BID_RULE = gql`
  mutation UpdateMatkaBidRule($id: ID!, $patch: MatkaBidRulePatch!) {
    updateMatkaBidRule(id: $id, patch: $patch) {
      id
      status
      percentage
      minStake
      maxStake
      exposureCap
      includedPlayers
      notes
    }
  }
`

export const DELETE_MATKA_BID_RULE = gql`
  mutation DeleteMatkaBidRule($id: ID!) { deleteMatkaBidRule(id: $id) }
`

export const CLONE_MATKA_MUTATION = gql`
  mutation CloneMatka($id: ID!, $name: String!, $code: String!) {
    cloneMatka(id: $id, name: $name, code: $code) {
      success
      message
      matka { id name code status }
    }
  }
`

export const CREATE_RATE_VERSION_MUTATION = gql`
  mutation CreateMatkaRateVersion($input: MatkaRateVersionInput!) {
    createMatkaRateVersion(input: $input) { id versionTag effectiveFrom }
  }
`

export const EXPORT_MATKAS_MUTATION = gql`
  query MatkasExport($filters: MatkaFilters) { matkasExportCSV(filters: $filters) }
`

export const IMPORT_MATKAS_MUTATION = gql`
  mutation ImportMatkas($csv: String!, $dryRun: Boolean) {
    importMatkasCSV(csv: $csv, dryRun: $dryRun) {
      inserted
      updated
      errors {
        line
        error
      }
    }
  }
`

export const MATKA_DEFAULT_RATES_QUERY = gql`
  query MatkaDefaultRates { matkaDefaultRates { tenant entries { betType payoutMultiplier minOdds maxOdds } updatedBy updatedAt } }
`

export const UPDATE_MATKA_DEFAULT_RATES_MUTATION = gql`
  mutation UpdateMatkaDefaultRates($entries: [MatkaDefaultRatesInputEntry!]!) {
    updateMatkaDefaultRates(entries: $entries) { tenant entries { betType payoutMultiplier minOdds maxOdds } updatedBy updatedAt }
  }
`


export const MATKA_CATALOG_QUERY = gql`
  query MatkaCatalog($filters: MatkaFilters) {
    matkas: matkaCatalog(filters: $filters) { 
      items { 
        id 
        name 
        code 
        description
        timezone 
        status 
        priority 
        schedule
        limits
        settings
        createdAt
        updatedAt 
      } 
      total 
    }
  }
`
