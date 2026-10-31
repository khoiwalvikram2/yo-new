import { gql } from '@apollo/client'

/* The Export Center's GraphQL documents (page migration C, W3 Task 128). They moved here out of
 * ExportsPage.tsx unchanged, character for character apart from indentation, so gate 10 finds the
 * same twenty documents: six the page sends itself and fourteen the row estimates send.
 *
 * CREATE_SAVED_REPORT has no sender. The legacy page mounted its mutation hook only for a Save Template
 * dialog that nothing ever opened (no control set it open), so the migrated page does not rebuild that
 * dialog; the document stays here, unchanged, for whoever wires template saving up (record, task 128). */

export const CREATE_EXPORT_JOB = gql`
  mutation CreateExportJob($input: ExportJobInput!) {
    createExportJob(input: $input) {
      id
      reportType
      exportFormat
      status
      fileUrl
      errorMessage
      scheduledAt
      createdAt
    }
  }
`

export const EXPORT_JOBS_QUERY = gql`
  query ExportJobs($status: String, $limit: Int, $offset: Int) {
    exportJobsPage(status: $status, limit: $limit, offset: $offset) {
      total completed pending failed successRate avgProcessingTime
      items {
      id
      reportType
      exportFormat
      status
      fileUrl
      errorMessage
      scheduledAt
      completedAt
      createdAt
      }
    }
  }
`

export const EXPORT_JOB_DOWNLOAD_URL = gql`
  query ExportJobDownloadUrl($jobId: ID!) {
    exportJobDownloadUrl(jobId: $jobId)
  }
`

export const SAVED_REPORTS_QUERY = gql`
  query SavedReports {
    savedReports {
      id
      name
      description
      reportType
      filtersJson
      isPinned
      createdAt
      updatedAt
    }
  }
`

export const CREATE_SAVED_REPORT = gql`
  mutation CreateSavedReport($input: SavedReportInput!) {
    createSavedReport(input: $input) {
      id
      name
      description
      reportType
      filtersJson
      isPinned
      createdAt
    }
  }
`

export const DELETE_SAVED_REPORT = gql`
  mutation DeleteSavedReport($id: ID!) {
    deleteSavedReport(id: $id) {
      success
      message
    }
  }
`

/* ---------- the row estimates (exportsPageEstimate.ts) ---------- */

export const PLAYERS_COUNT_QUERY = gql`
  query GetPlayersCount($query: String, $status: PlayerStatus, $offset: Int, $limit: Int) {
    usersPage(query: $query, status: $status, offset: $offset, limit: $limit) {
      total
    }
  }
`

export const PLAYERS_FOR_TRANSACTION_ESTIMATE_QUERY = gql`
  query GetPlayersForTransactionEstimate($offset: Int, $limit: Int) {
    usersPage(offset: $offset, limit: $limit) {
      total
    }
  }
`

export const SPORTS_BETS_COUNT_QUERY = gql`
  query GetSportsBetsCount($query: SportsBetsQuery) {
    sportsBets(query: $query) {
      id
    }
  }
`

export const CASINO_BETS_COUNT_QUERY = gql`
  query GetCasinoBetsCount($query: CasinoBetsQuery) {
    casinoBets(query: $query) {
      id
    }
  }
`

export const MATKA_BETS_COUNT_QUERY = gql`
  query GetMatkaBetsCount($query: MatkaBetsQuery) {
    matkaBets(query: $query) {
      id
    }
  }
`

export const AGENTS_COUNT_QUERY = gql`
  query GetAgentsCount($query: String, $schemeType: AgentScheme, $status: String, $offset: Int, $limit: Int) {
    agents {
      agentsPage(query: $query, schemeType: $schemeType, status: $status, offset: $offset, limit: $limit) {
        total
      }
    }
  }
`



export const ALL_SUB_AGENTS_QUERY = gql`
  query GetAllSubAgents($offset: Int, $limit: Int) {
    agents {
      agentsPage(offset: $offset, limit: $limit) {
        items {
          id
          parentAgentId
        }
        total
      }
    }
  }
`

export const AGENTS_FOR_ESTIMATE_QUERY = gql`
  query GetAgentsForEstimate($offset: Int, $limit: Int) {
    agents {
      agentsPage(offset: $offset, limit: $limit) {
        total
      }
    }
  }
`

export const AGENTS_FOR_PERFORMANCE_QUERY = gql`
  query GetAgentsForPerformance($offset: Int, $limit: Int) {
    agents {
      agentsPage(offset: $offset, limit: $limit) {
        total
      }
    }
  }
`

export const BONUS_CAMPAIGNS_COUNT_QUERY = gql`
  query GetBonusCampaignsCount($status: BonusStatus, $domain: BonusDomain) {
    bonusCampaigns(status: $status, domain: $domain) {
      id
    }
  }
`

export const AUDIT_LOGS_COUNT_QUERY = gql`
  query GetAuditLogsCount($domain: String, $action: String, $from: String, $to: String, $limit: Int) {
    audit(domain: $domain, action: $action, from: $from, to: $to, limit: $limit) {
      id
    }
  }
`

export const DEPOSIT_REQUESTS_COUNT_QUERY = gql`
  query GetDepositRequestsCount($input: ListDepositRequestsInput) {
    adminDepositRequests(input: $input) {
      total
    }
  }
`

export const WITHDRAWAL_REQUESTS_COUNT_QUERY = gql`
  query GetWithdrawalRequestsCount($input: AdminWithdrawalFilter) {
    adminWithdrawalRequests(input: $input) {
      total
    }
  }
`


/* An agent's row estimate (agent features spec §4): the backend's COUNT of exactly the rows the
 * agent's export would hold, in its own subtree and capped like the file. Null for admins. */
export const AGENT_EXPORT_ROW_COUNT_QUERY = gql`
  query AgentExportRowCount($reportType: String!, $filtersJson: JSON) {
    agentExportRowCount(reportType: $reportType, filtersJson: $filtersJson)
  }
`
