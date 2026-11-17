import { graphqlRequest } from '@/lib/graphqlClient'
import { tokenService } from '@/lib/tokenService'
import { getWhitelabelId, isWhitelabelIdFromEnv } from '@/lib/whitelabel'

// Get API base URL for REST endpoints
const getApiBaseUrl = () => {
  const graphqlUrl = import.meta.env.VITE_USER_GRAPHQL_URL ||
    (import.meta.env.VITE_API_BASE_URL
      ? `${import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '')}/graphql`
      : '/graphql')
  // Remove /graphql to get base URL
  return graphqlUrl.replace(/\/graphql$/, '')
}

function resolveSiteAssetUrl(value: string | null | undefined) {
  return value?.startsWith('/api/site-assets/') ? `${getApiBaseUrl().replace(/\/$/, '')}${value}` : value
}

export type GmagTestResult = {
  success: boolean
  message?: string
  request: { url: string; body: Record<string, unknown>; hash: string }
  response: { status: number; body: unknown }
  logs: string[]
  durationMs: number
}

export async function runGmagTest(
  testCase: string,
  params: Record<string, unknown>
): Promise<GmagTestResult> {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token && !tokenService.isTokenExpired(token)) {
    headers['Authorization'] = `Bearer ${token}`
  }
  if (typeof window !== 'undefined') {
    const whitelabelId = getWhitelabelId()
    const fromEnv = isWhitelabelIdFromEnv()
    headers['x-tenant'] = whitelabelId
    headers['x-whitelabel-id'] = whitelabelId
    if (!fromEnv) {
      headers['x-whitelabel'] = window.location.hostname
    }
  }

  const response = await fetch(`${getApiBaseUrl()}/gmag-test/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ testCase, params }),
  })
  let result: GmagTestResult & { message?: string }
  try {
    result = await response.json()
  } catch {
    throw new Error(response.status === 200 ? 'Invalid JSON in response' : `Request failed with status ${response.status}`)
  }
  if (!response.ok) {
    throw new Error(result?.message ?? 'GMAG test request failed')
  }
  return result as GmagTestResult
}

type ApiResponse<T> = { data: T; meta: { code: number; message?: string; total?: number; page?: number; hasMore?: boolean } }

export type UserDetail = {
  _id: string
  name?: string
  username?: string
  mobileNo?: string
  balance?: number
  bonus?: number
  wallet?: '1' | '2'
  affiliateCode?: string
  refBonus?: number
  referralBalance?: number
  referralBonusBalance?: number
}

function mapUserDetail(data: any): UserDetail {
  if (!data) return { _id: '', balance: 0, wallet: '1' }
  return {
    _id: data.id ?? data._id ?? '',
    name: data.name,
    username: data.username,
    mobileNo: data.mobileNo || data.phone,
    balance: data.balance ?? 0,
    bonus: data.bonus ?? data.bonusBalance ?? 0,
    wallet: (data.walletType as any) ?? data.wallet ?? '1',
    affiliateCode: data.affiliateCode,
    refBonus: data.refBonus ?? data.referralBalance,
    referralBalance: data.referralBalance != null ? Number(data.referralBalance) : undefined,
    referralBonusBalance: data.referralBonusBalance != null ? Number(data.referralBonusBalance) : undefined,
  }
}

async function mapResponse<T>(promise: Promise<any>, key: string): Promise<ApiResponse<T>> {
  const res = await promise
  const payload = res[key]
  return { data: payload?.data as T, meta: payload?.meta ?? { code: 500, message: 'Unknown response' } }
}

export async function getUserDetail(): Promise<ApiResponse<UserDetail>> {
  return mapResponse<UserDetail>(
    graphqlRequest(
      `
        query UserDetail {
          userDetail { meta { code message } data { id name username mobileNo balance bonus wallet affiliateCode refBonus referralBalance referralBonusBalance } }
        }
      `
    ),
    'userDetail'
  ).then((resp) => ({ ...resp, data: mapUserDetail(resp.data) }))
}

export async function getAccountStatement(params: { start_date: string; end_date: string; isChecked?: boolean }) {
  return mapResponse<any>(
    graphqlRequest(
      `
        query AccountStatement($start: String!, $end: String!, $isChecked: Boolean) {
          accountStatement(startDate: $start, endDate: $end, isChecked: $isChecked) { meta { code message } data { id amount type transactionType description createdAt status bonusCampaignName bonusCampaignType } }
        }
      `,
      { start: params.start_date, end: params.end_date, isChecked: params.isChecked }
    ),
    'accountStatement'
  )
}

export async function getResultTransactions(params: { start_date: string; end_date: string; isChecked?: boolean }) {
  return mapResponse<any>(
    graphqlRequest(
      `
        query ResultTransactions($start: String!, $end: String!, $isChecked: Boolean) {
          resultTransactions(startDate: $start, endDate: $end, isChecked: $isChecked) { 
            meta { code message } 
            data { 
              id 
              amount 
              type 
              description 
              createdAt 
              status 
              stake 
              pl 
              price 
              side
              oddsSize
              liability
              selectionName
              sportName 
              leagueName 
              provider
              walletType
              eventResult
              result
              eventId { 
                id 
                name 
              }
              marketId { 
                id 
                marketName 
                marketType 
              }
            } 
          }
        }
      `,
      { start: params.start_date, end: params.end_date, isChecked: params.isChecked }
    ),
    'resultTransactions'
  )
}

export type StatementTransaction = {
  id: string; amount: number; type: string; createdAt: string
  transactionType?: string | null; description?: string | null; status?: string | null
  bonusCampaignName?: string | null; bonusCampaignType?: string | null
  stake?: number | null; pl?: number | null; price?: number | null; side?: string | null
  oddsSize?: number | null; liability?: number | null; selectionName?: string | null
  eventId?: { id: string; name?: string | null } | null
  marketId?: { id: string; marketName?: string | null; marketType?: string | null } | null
  sportName?: string | null; leagueName?: string | null; provider?: string | null
  walletType?: string | null; eventResult?: string | null; result?: string | null
  currency?: string | null; runDate?: string | null; session?: string | null; bidType?: string | null
  payoutMultiplier?: number | null; payout?: number | null; settledAt?: string | null
}
export async function getStatementPage(input: {
  domain: 'WALLET' | 'SPORTS' | 'CASINO' | 'MATKA'; startDate: string; endDate: string
  page: number; pageSize: number; search?: string; status?: string; type?: string
}) {
  const response = await graphqlRequest<{ statementPage: {
    meta: { code: number; message?: string; total: number; page: number; hasMore: boolean }
    data: StatementTransaction[]; walletTypes: string[]
  } }>(`
    query StatementPage($input: StatementPageInput!) {
      statementPage(input: $input) {
        meta { code message total page hasMore }
        walletTypes
        data {
          id amount type transactionType description createdAt status bonusCampaignName bonusCampaignType
          stake pl price side oddsSize liability selectionName sportName leagueName provider walletType eventResult result
          currency runDate session bidType payoutMultiplier payout settledAt
          eventId { id name } marketId { id marketName marketType }
        }
      }
    }
  `, { input })
  return response.statementPage
}

export async function getAppSettings() {
  const response = await graphqlRequest<{ appSettings: { meta: { code: number; message?: string }; version?: string; data: Array<{ key: string; value: string | null }> } }>(`
    query AppSettings {
      appSettings { meta { code message } version data { key value } }
    }
  `)
  return { ...response.appSettings, data: response.appSettings.data.map(item => ({ ...item, value: resolveSiteAssetUrl(item.value) ?? null })) }
}

export async function getAppSettingsVersion() {
  const response = await graphqlRequest<{ appSettingsVersion: string }>(`query AppSettingsVersion { appSettingsVersion }`)
  return response.appSettingsVersion
}

export async function getMyStakeLimits() {
  return mapResponse<{
    dailyTotal: number
    weeklyTotal: number
    dailyLimit: number | null
    weeklyLimit: number | null
    dailyRemaining: number | null
    weeklyRemaining: number | null
  }>(
    graphqlRequest(
      `
        query MyStakeLimits {
          myStakeLimits { 
            meta { code message } 
            data { 
              dailyTotal 
              weeklyTotal 
              dailyLimit 
              weeklyLimit 
              dailyRemaining 
              weeklyRemaining 
            } 
          }
        }
      `
    ),
    'myStakeLimits'
  )
}

export async function getAllAppSettings() {
  return mapResponse<any>(
    graphqlRequest(
      `
        query AllAppSettings {
          allAppSettings { meta { code message } data { key value } }
        }
      `
    ),
    'allAppSettings'
  ).then(response => ({ ...response, data: Array.isArray(response.data) ? response.data.map(item => ({ ...item, value: resolveSiteAssetUrl(item.value) })) : response.data }))
}

export async function getAdvertisements() {
  return mapResponse<any[]>(
    graphqlRequest(
      `
        query Ads {
          advertisements { meta { code message } data { id title subtitle image type url order deviceType } }
        }
      `
    ),
    'advertisements'
  ).then(response => ({ ...response, data: (response.data || []).map(ad => ({ ...ad, image: resolveSiteAssetUrl(ad.image) })) }))
}

export async function createWithdrawalRequest(payload: { accountId: string; amount: number }) {
  return mapResponse<any>(
    graphqlRequest(
      `
        mutation CreateWithdrawal($accountId: String!, $amount: Float!) {
          createWithdrawalRequest(accountId: $accountId, amount: $amount) {
            meta { code message }
            data { id amount status accountId accountNumber accountHolderName method ifscCode currency createdAt }
          }
        }
      `,
      payload
    ),
    'createWithdrawalRequest'
  )
}

export async function getWithdrawalRequests(params: { start_date?: string; end_date?: string }) {
  return mapResponse<any>(
    graphqlRequest(
      `
        query WithdrawalRequests($start: String, $end: String) {
          withdrawalRequests(startDate: $start, endDate: $end) {
            meta { code message }
            data { id amount status accountId accountNumber accountHolderName method ifscCode currency note createdAt }
          }
        }
      `,
      { start: params.start_date, end: params.end_date }
    ),
    'withdrawalRequests'
  )
}

export type UserPaymentAccount = {
  id: string; type: string; accountNumber?: string | null; ifscCode?: string | null
  bankName?: string | null; accountHolderName?: string | null; branch?: string | null
  upiId?: string | null; displayName?: string | null; qrUrl?: string | null
  minAmount?: number | null; maxAmount?: number | null; weight?: number | null; source?: string | null
  // type 'crypto' only: a USDT wallet (accountNumber is the same address) and the whitelabel's rate
  // (wallet currency per 1 USDT) and bonus percent (null = no bonus)
  walletAddress?: string | null; network?: string | null; cryptoRate?: number | null; cryptoBonusPercent?: number | null
}

/** A deposit request as the player API returns it. The crypto fields are set on CRYPTO requests only. */
export type UserDepositRequest = {
  id: string; amount: number; status: string; createdAt: string; utr?: string | null; method?: string | null
  cryptoAmount?: number | null; cryptoRate?: number | null; cryptoNetwork?: string | null; cryptoBonusAmount?: number | null
}

export async function getAdminAccounts() {
  return mapResponse<UserPaymentAccount[]>(
    graphqlRequest(
      `
        query AdminAccounts {
          adminAccounts(includeCrypto: true) {
            meta { code message }
            data {
              id
              type
              accountNumber
              ifscCode
              bankName
              accountHolderName
              branch
              upiId
              displayName
              qrUrl
              minAmount
              maxAmount
              weight
              source
              walletAddress
              network
              cryptoRate
              cryptoBonusPercent
            }
          }
        }
      `
    ),
    'adminAccounts'
  ).then(response => ({ ...response, data: (response.data || []).map(account => ({ ...account, qrUrl: resolveSiteAssetUrl(account.qrUrl) })) }))
}

/**
 * A manual deposit request. `type` is the receiving account's type: 'bank', 'upi' or 'crypto'. For 'crypto'
 * `txnRef` is the transaction hash (TxID), which the server requires, and the server quotes the USDT itself:
 * `data[0]` carries its cryptoAmount and cryptoBonusAmount. `proofKey` is the payment screenshot as an image data
 * URI (compressDepositProof in '@/lib/depositProof'); there is no separate upload.
 */
export async function createAdminDeposit(payload: { accountId: string; amount: number; txnRef?: string; proofKey?: string; type?: string }) {
  return mapResponse<UserDepositRequest[]>(
    graphqlRequest(
      `
        mutation CreateAdminDeposit($accountId: String!, $amount: Float!, $txnRef: String, $proofKey: String, $type: String) {
          createAdminDeposit(accountId: $accountId, amount: $amount, txnRef: $txnRef, proofKey: $proofKey, type: $type) {
            meta { code message }
            data { id amount status createdAt utr method cryptoAmount cryptoRate cryptoNetwork cryptoBonusAmount }
          }
        }
      `,
      { ...payload, proofKey: payload.proofKey }
    ),
    'createAdminDeposit'
  )
}

export async function createDeposit(payload: { amount: number }) {
  return mapResponse<{ redirectUrl: string }>(
    graphqlRequest(
      `
        mutation CreateDeposit($amount: Float!) {
          createDeposit(amount: $amount) { meta { code message } data { redirectUrl } }
        }
      `,
      payload
    ),
    'createDeposit'
  )
}

/** A WeLivePay checkout as the deposit page keeps it: the order, where to pay it, and the amount (added by the page). */
export type WelivepayCheckout = { orderId: string; paymentLink: string; hostedUrl?: string | null; qrImage: string; amount: number }

/**
 * Starts a WeLivePay order. `paymentLink` is the hosted checkout when the gateway returns one, else its
 * payment link; `qrImage` may be empty, a data URI, a URL or bare base64. A refusal (VIP limits, no mobile
 * number, gateway switched off) comes back in meta.message with code 400 and no data.
 */
export async function createWelivepayDeposit(amount: number) {
  return mapResponse<Omit<WelivepayCheckout, 'amount'> | null>(
    graphqlRequest(
      `
        mutation CreateWelivepayDeposit($amount: Float!) {
          createWelivepayDeposit(amount: $amount) {
            meta { code message }
            data { orderId paymentLink hostedUrl qrImage }
          }
        }
      `,
      { amount }
    ),
    'createWelivepayDeposit'
  )
}

export type WelivepayOrderStatus = { orderId: string; status: string; amount: number }

/**
 * The player's own WeLivePay order: pending | success | expired | invalid. The server asks the gateway at
 * most once a minute per order and credits a paid order itself, so polling is safe. Throws "Payment order
 * not found" for an order that is not the player's.
 */
export async function getWelivepayDepositStatus(orderId: string): Promise<WelivepayOrderStatus> {
  const data = await graphqlRequest<{ welivepayDepositStatus: WelivepayOrderStatus }>(
    `
      query WelivepayDepositStatus($orderId: String!) {
        welivepayDepositStatus(orderId: $orderId) { orderId status amount }
      }
    `,
    { orderId }
  )
  return data.welivepayDepositStatus
}

export async function getAdminDepositRequests(params: { start_date?: string; end_date?: string }) {
  return mapResponse<UserDepositRequest[]>(
    graphqlRequest(
      `
        query AdminDepositRequests($start: String, $end: String) {
          adminDepositRequests(startDate: $start, endDate: $end) { meta { code message } data { id amount status createdAt utr method cryptoAmount cryptoRate cryptoNetwork cryptoBonusAmount } }
        }
      `,
      { start: params.start_date, end: params.end_date }
    ),
    'adminDepositRequests'
  )
}

export async function getAccountDetails() {
  return mapResponse<any[]>(
    graphqlRequest(
      `
        query AccountDetails {
          accountDetails { meta { code message } data { id accountNumber ifscCode accountType type bankName accountHolderName isPrimary approvalStatus rejectionReason } }
        }
      `
    ),
    'accountDetails'
  )
}

export async function createAccountDetails(payload: {
  accountNumber: string
  ifscCode: string
  accountType?: string
  type?: string
  bankName?: string
  accountHolderName: string
}) {
  return mapResponse<any>(
    graphqlRequest(
      `
        mutation CreateAccountDetails($accountNumber: String!, $ifscCode: String!, $accountType: String, $type: String, $bankName: String, $accountHolderName: String!) {
          createAccountDetails(accountNumber: $accountNumber, ifscCode: $ifscCode, accountType: $accountType, type: $type, bankName: $bankName, accountHolderName: $accountHolderName) {
            meta { code message }
            data { id accountNumber ifscCode accountType type bankName accountHolderName }
          }
        }
      `,
      payload
    ),
    'createAccountDetails'
  )
}

export async function updateAccountDetails(payload: {
  accountId: string
  accountNumber?: string
  ifscCode?: string
  accountType?: string
  bankName?: string
  accountHolderName?: string
}) {
  return mapResponse<any>(
    graphqlRequest(
      `
        mutation UpdateAccountDetails($accountId: String!, $accountNumber: String, $ifscCode: String, $accountType: String, $bankName: String, $accountHolderName: String) {
          updateAccountDetails(accountId: $accountId, accountNumber: $accountNumber, ifscCode: $ifscCode, accountType: $accountType, bankName: $bankName, accountHolderName: $accountHolderName) {
            meta { code message }
            data { id accountNumber ifscCode accountType type bankName accountHolderName }
          }
        }
      `,
      payload
    ),
    'updateAccountDetails'
  )
}

export async function setPrimaryAccount(payload: { accountId: string }) {
  return mapResponse<any>(
    graphqlRequest(
      `
        mutation SetPrimaryAccount($accountId: String!) {
          setPrimaryAccount(accountId: $accountId) {
            meta { code message }
            data { id accountNumber ifscCode accountType type bankName accountHolderName isPrimary }
          }
        }
      `,
      payload
    ),
    'setPrimaryAccount'
  )
}

export async function deleteAccountDetails(accountId: string) {
  return mapResponse<any>(
    graphqlRequest(
      `
        mutation DeleteAccountDetails($accountId: String!) {
          deleteAccountDetails(accountId: $accountId) { meta { code message } data { id accountNumber } }
        }
      `,
      { accountId }
    ),
    'deleteAccountDetails'
  )
}

export async function getCasinoUrl(gameId: string, walletType?: 'balance' | 'bonus' | 'referralBonus') {
  const headers: Record<string, string> = {}
  if (walletType) headers['x-wallet-type'] = walletType

  const rawPromise = graphqlRequest<{ casinoUrl?: { meta?: { code: number; message?: string }; data?: { redirectUrl: string } } }>(
    `
        query CasinoUrl($gameId: ID!) {
          casinoUrl(gameId: $gameId) { meta { code message } data { redirectUrl } }
        }
      `,
    { gameId },
    headers
  )

  const raw = await rawPromise
  const payload = raw?.casinoUrl

  const result = { data: payload?.data as { redirectUrl: string }, meta: payload?.meta ?? { code: 500, message: 'Unknown response' } }
  return result
}

/** @deprecated Use getCasinoUrl; backend routes by provider. */
export async function getGapCasinoUrl(gameId: string, walletType?: 'balance' | 'bonus' | 'referralBonus') {
  return getCasinoUrl(gameId, walletType)
}

export async function getCasinoGames(params?: {
  slots?: boolean
  category?: string
  categoryType?: 'GENERAL' | 'TOP' | 'FEATURED' | 'LOUNGE'
  provider?: string
  providers?: string[]
  search?: string
  page?: number
  limit?: number
  sort?: 'popularity' | 'new' | 'alpha'
  liveOnly?: boolean
  cursor?: string
}) {
  return mapResponse<any[]>(
    graphqlRequest(
      `
        query CasinoGames($input: CasinoGamesInput) {
          casinoGames(input: $input) { meta { code message total page hasMore } data { id title provider category imageUrl gameId } }
        }
      `,
      { input: params }
    ),
    'casinoGames'
  )
}

export async function getCasinoCategories(params?: { liveOnly?: boolean; slotsOnly?: boolean }) {
  return mapResponse<Array<{ name: string; type: string; slug: string; subtitle: string | null; order: number | null; iconData: string | null }>>(
    graphqlRequest(
      `
        query CasinoCategories($liveOnly: Boolean, $slotsOnly: Boolean) {
          casinoCategories(liveOnly: $liveOnly, slotsOnly: $slotsOnly) { 
            meta { code message } 
            data { name type slug subtitle order iconData }
          }
        }
      `,
      { liveOnly: params?.liveOnly, slotsOnly: params?.slotsOnly }
    ),
    'casinoCategories'
  )
}

export async function getCasinoProviders(params?: { category?: string; liveOnly?: boolean }) {
  return mapResponse<Array<{ name: string; slug: string | null }>>(
    graphqlRequest(
      `
        query CasinoProviders($category: String, $liveOnly: Boolean) {
          casinoProviders(category: $category, liveOnly: $liveOnly) { meta { code message } data { name slug } }
        }
      `,
      { category: params?.category, liveOnly: params?.liveOnly }
    ),
    'casinoProviders'
  )
}

export async function getCasinoSummary(params?: { limit?: number; sort?: 'popularity' | 'new' | 'alpha'; liveOnly?: boolean; slots?: boolean; provider?: string; providers?: string[] }) {
  return mapResponse<any[]>(
    graphqlRequest(
      `
        query CasinoSummary($input: CasinoGamesInput) {
          casinoSummary(input: $input) { meta { code message } data { id title provider category imageUrl gameId } }
        }
      `,
      { input: params }
    ),
    'casinoSummary'
  )
}

export async function getRecentCasinoGames(limit = 20) {
  return mapResponse<any[]>(
    graphqlRequest(
      `
        query RecentCasinoGames($limit: Int) {
          recentCasinoGames(limit: $limit) { meta { code message } data { id title provider category imageUrl gameId } }
        }
      `,
      { limit }
    ),
    'recentCasinoGames'
  )
}

export async function getLikedCasinoGames(limit = 100) {
  return mapResponse<any[]>(
    graphqlRequest(
      `
        query LikedCasinoGames($limit: Int) {
          likedCasinoGames(limit: $limit) { meta { code message } data { id title provider category imageUrl gameId } }
        }
      `,
      { limit }
    ),
    'likedCasinoGames'
  )
}

export async function likeCasinoGame(gameId: string) {
  return mapResponse<{ redirectUrl: string }>(
    graphqlRequest(
      `
        mutation LikeCasinoGame($gameId: ID!) {
          likeCasinoGame(gameId: $gameId) { meta { code message } data { redirectUrl } }
        }
      `,
      { gameId }
    ),
    'likeCasinoGame'
  )
}

export async function unlikeCasinoGame(gameId: string) {
  return mapResponse<{ redirectUrl: string }>(
    graphqlRequest(
      `
        mutation UnlikeCasinoGame($gameId: ID!) {
          unlikeCasinoGame(gameId: $gameId) { meta { code message } data { redirectUrl } }
        }
      `,
      { gameId }
    ),
    'unlikeCasinoGame'
  )
}

export type BonusApiItem = {
  _id?: string
  id?: string
  bonusAmount: number
  createdAt: string
  awardedAt?: string
  completedAt?: string
  claimedAt?: string
  depositAmount?: number
  expiresAt?: string
  wageringAmount: number
  fulfilledAmount?: number
  status: 'available' | 'active' | 'forfeited' | 'claimed' | 'expired'
  firstDepositRequired?: boolean
  firstDepositMade?: boolean
  currency?: string
  distributionType?: string
  domain?: string
  type?: string
  campaignDetails?: {
    id: string
    name: string
    type: string
    domain: string
    status: string
    currency?: string
    distributionType?: string
    amountType?: string
    percentage?: number
    wagering?: number
    depositConditionType?: string
    depositConditionAmount?: number
    releaseType?: string
    expiryBonusDays?: number
  } | null
}

export async function getBonusData() {
  return mapResponse<BonusApiItem[]>(
    graphqlRequest(
      `
        query BonusData {
          bonusData { 
            meta { code message } 
            data { 
              id 
              bonusAmount 
              createdAt 
              awardedAt
              completedAt
              claimedAt
              depositAmount
              expiresAt 
              wageringAmount 
              fulfilledAmount 
              status 
              firstDepositRequired
              firstDepositMade
              currency
              distributionType
              domain
              type
              campaignDetails {
                id
                name
                type
                domain
                status
                currency
                distributionType
                amountType
                percentage
                wagering
                depositConditionType
                depositConditionAmount
                releaseType
                expiryBonusDays
              }
            } 
          }
        }
      `
    ),
    'bonusData'
  )
}

export async function getBonusHistory(filters?: { status?: string; fromDate?: string; toDate?: string }) {
  const filterVars: any = {}
  if (filters?.status) filterVars.status = filters.status
  if (filters?.fromDate) filterVars.fromDate = filters.fromDate
  if (filters?.toDate) filterVars.toDate = filters.toDate

  return mapResponse<any[]>(
    graphqlRequest(
      `
        query BonusHistory($status: String, $fromDate: String, $toDate: String) {
          bonusHistory(status: $status, fromDate: $fromDate, toDate: $toDate) { 
            meta { code message } 
            data { 
              id 
              name 
              amount 
              status 
              currency 
              awardedAt 
              completedAt 
              claimedAt
              domain
              type
              distributionType
              depositAmount
              wageringAmount
              fulfilledAmount
              expiresAt
              amountType
              percentage
              wagering
              releaseType
              expiryBonusDays
            } 
          }
        }
      `,
      filterVars
    ),
    'bonusHistory'
  )
}

export async function getAvailableBonusCampaigns() {
  return mapResponse<any[]>(
    graphqlRequest(
      `
        query AvailableBonusCampaigns {
          availableBonusCampaigns { 
            meta { code message } 
            data { 
              id 
              name 
              domain 
              type 
              currency 
              codeMode 
              validFrom 
              validTo 
              rulesJson 
              limitsJson 
            } 
          }
        }
      `
    ),
    'availableBonusCampaigns'
  )
}

export async function getReferralProgram() {
  return mapResponse<any>(
    graphqlRequest(
      `
        query ReferralProgram {
          referralProgram { 
            meta { code message } 
            data { 
              id 
              name 
              enabledRewardTypes 
              maxTierDepth 
              attributionModel 
              status 
              minReferralBalanceForCashTransfer 
            } 
          }
        }
      `
    ),
    'referralProgram'
  )
}

export async function getMyReferralLink() {
  return mapResponse<{ code: string; url: string }>(
    graphqlRequest(
      `
        query MyReferralLink {
          myReferralLink { meta { code message } data { code url } }
        }
      `
    ),
    'myReferralLink'
  )
}

export async function getActiveReferralRules() {
  return mapResponse<any[]>(
    graphqlRequest(
      `
        query ActiveReferralRules {
          activeReferralRules { 
            meta { code message } 
            data { 
              id 
              ruleType 
              description 
              tierRates 
              fixedAmount 
              cap 
              threshold 
              status 
            } 
          }
        }
      `
    ),
    'activeReferralRules'
  )
}

export async function activateBonus(payload: { bonusId: string }) {
  return mapResponse<any>(
    graphqlRequest(
      `
        mutation ActivateBonus($bonusId: ID!) {
          activateBonus(bonusId: $bonusId) { meta { code message } data { id bonusAmount createdAt status } }
        }
      `,
      payload
    ),
    'activateBonus'
  )
}

export async function forfeitBonus() {
  return mapResponse<any>(
    graphqlRequest(
      `
        mutation ForfeitBonus {
          forfeitBonus { meta { code message } data { id bonusAmount createdAt status } }
        }
      `
    ),
    'forfeitBonus'
  )
}

export async function claimBonus() {
  return mapResponse<any>(
    graphqlRequest(
      `
        mutation ClaimBonus {
          claimBonus { meta { code message } data { id bonusAmount createdAt status } }
        }
      `
    ),
    'claimBonus'
  )
}

export async function redeemBonusCode(code: string) {
  return mapResponse<any>(
    graphqlRequest(
      `
        mutation RedeemBonusCode($code: String!) {
          redeemBonusCode(code: $code) { meta { code message } data { id bonusAmount createdAt status } }
        }
      `,
      { code }
    ),
    'redeemBonusCode'
  )
}

export async function claimBonusCampaign(campaignId: string) {
  return mapResponse<any>(
    graphqlRequest(
      `
        mutation ClaimBonusCampaign($campaignId: ID!) {
          claimBonusCampaign(campaignId: $campaignId) { meta { code message } data { id bonusAmount createdAt status } }
        }
      `,
      { campaignId }
    ),
    'claimBonusCampaign'
  )
}

export async function switchBonus(newBonusId: string) {
  return mapResponse<any>(
    graphqlRequest(
      `
        mutation SwitchBonus($newBonusId: ID!) {
          switchBonus(newBonusId: $newBonusId) { meta { code message } data { id bonusAmount createdAt expiresAt wageringAmount fulfilledAmount status currency campaignDetails { id name type domain status currency } } }
        }
      `,
      { newBonusId }
    ),
    'switchBonus'
  )
}

export type ReferralUserItem = {
  id?: string
  _id?: string
  name?: string
  mobileNo?: string
  createdAt?: string
  totalPl?: number
  pl?: number
  percentage?: number
  status?: string | null
  reason?: string | null
  tier?: number | null
  referralCode?: string | null
  firstClickAt?: string | null
  utmSource?: string | null
  utmCampaign?: string | null
  utmMedium?: string | null
}

export async function getReferralUsers() {
  return mapResponse<ReferralUserItem[]>(
    graphqlRequest(
      `
        query ReferralUsers {
          referralUsers { meta { code message } data { id name mobileNo createdAt totalPl pl percentage status reason tier referralCode firstClickAt utmSource utmCampaign utmMedium } }
        }
      `
    ),
    'referralUsers'
  )
}

export type ReferralTxnItem = {
  id?: string
  _id?: string
  userName?: string
  mobileNo?: string
  pl?: number
  bonusAmount?: number
  weekStartDate?: string
  weekEndDate?: string
  createdAt?: string
  ruleType?: string | null
  tier?: number | null
  currency?: string | null
}

export async function getReferralTransactions() {
  return mapResponse<ReferralTxnItem[]>(
    graphqlRequest(
      `
        query ReferralTransactions {
          referralTransactions { meta { code message } data { id userName mobileNo pl bonusAmount weekStartDate weekEndDate createdAt ruleType tier currency } }
        }
      `
    ),
    'referralTransactions'
  )
}

export async function getWeeklyReferralSummary(params: { startDate: string; endDate: string }) {
  return mapResponse<
    Array<{ pl: number; bonusAmount: number; weekStartDate: string; weekEndDate: string; createdAt: string; ruleType?: string | null; tier?: number | null; currency?: string | null }>
  >(
    graphqlRequest(
      `
        query WeeklyReferral($start: String!, $end: String!) {
          weeklyReferralSummary(startDate: $start, endDate: $end) { meta { code message } data { pl bonusAmount weekStartDate weekEndDate createdAt ruleType tier currency } }
        }
      `,
      { start: params.startDate, end: params.endDate }
    ),
    'weeklyReferralSummary'
  )
}

export type ReferralAggregateItem = {
  ruleType?: string | null
  tier?: number | null
  currency?: string | null
  totalPl?: number
  totalBonus?: number
  count?: number
}

export async function getReferralAggregate() {
  return mapResponse<ReferralAggregateItem[]>(
    graphqlRequest(
      `
        query ReferralAggregate {
          referralAggregate { meta { code message } data { ruleType tier currency totalPl totalBonus count } }
        }
      `
    ),
    'referralAggregate'
  )
}

export type ClaimReferralBonusResult = {
  count: number
  totalCash: number
  totalBonus: number
}

export async function claimReferralBonus(amount: number) {
  return mapResponse<ClaimReferralBonusResult | null>(
    graphqlRequest(
      `
        mutation ClaimReferralBonus($amount: Float!) {
          claimReferralBonus(amount: $amount) { meta { code message } data { count totalCash totalBonus } }
        }
      `,
      { amount }
    ),
    'claimReferralBonus'
  )
}

export type TransferReferralBalanceResult = {
  success: boolean
  message: string
  newReferralBalance?: number
  newCashBalance?: number
}

export async function transferReferralBalanceToCash(amount: number) {
  const data = await graphqlRequest<{ transferReferralBalanceToCash: TransferReferralBalanceResult }>(
    `
      mutation TransferReferralBalanceToCash($amount: Float!) {
        transferReferralBalanceToCash(amount: $amount) {
          success
          message
          newReferralBalance
          newCashBalance
        }
      }`,
    { amount }
  )
  return data.transferReferralBalanceToCash
}

export async function trackReferralClick(params: {
  code: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
}) {
  return graphqlRequest(
    `
      mutation TrackReferralClick($code: String!, $utmSource: String, $utmMedium: String, $utmCampaign: String) {
        trackReferralClick(code: $code, utmSource: $utmSource, utmMedium: $utmMedium, utmCampaign: $utmCampaign) { code message }
      }
    `,
    params
  ).then((res: any) => res?.trackReferralClick ?? { code: 200, message: 'ok' })
}

export type SportApiItem = {
  _id?: string
  name?: string
  slugName?: string
    leagues?: Array<{
    id?: string
    name?: string
    slugName?: string
    events?: Array<{
      id?: string
      eventCode?: string
      name?: string
      slugName?: string
      date?: string
      markets?: Array<{
        marketId?: string
        marketName?: string
        type?: string
        marketStatus?: string
        inplay?: boolean
      }>
    }>
  }>
}

export async function getSportsList() {
  return mapResponse<SportApiItem[]>(
    graphqlRequest(
      `
        query SportsList {
          sportsList {
            meta { code message }
            data {
              id
              name
              slugName
              leagues {
                id
                name
                slugName
                events {
                  id
                  eventCode
                  name
                  slugName
                  date
                  markets {
                    marketId
                    marketName
                    type
                    marketStatus
                    inplay
                  }
                }
              }
            }
          }
        }
      `
    ),
    'sportsList'
  )
}

export async function getUserData() {
  // Alias to userDetail for compatibility
  const res = await getUserDetail()
  return { data: res.data, meta: res.meta }
}

export async function getUserBets(params: { eventId?: string; marketIds?: string[]; openOnly?: boolean }) {
  return mapResponse<Array<{
    id: string
    eventId: string
    eventName?: string
    marketId?: string
    marketName?: string
    marketType?: string
    selectionId?: string
    selection?: string
    side: string
    odds: number
    stake: number
    status: string
    createdAt: string
    pl?: number
    liability?: number
    payout?: number
    type: string
    market?: string
    oddsSize?: number
  }>>(
    graphqlRequest(
      `
        query UserBets($eventId: ID, $marketIds: [ID!], $openOnly: Boolean) {
          userBets(eventId: $eventId, marketIds: $marketIds, openOnly: $openOnly) {
            meta { code message }
            data {
              id
              eventId
              eventName
              marketId
              marketName
              marketType
              selectionId
              selection
              side
              odds
              stake
              status
              createdAt
              pl
              liability
              payout
              type
              market
              oddsSize
            }
          }
        }
      `,
      { eventId: params.eventId, marketIds: params.marketIds, openOnly: params.openOnly }
    ),
    'userBets'
  )
}

export async function getSportsEventDetails(_params: { sport: string; league: string; event: string }) {
  return mapResponse<any>(
    graphqlRequest(
      `
        query SportsEventDetail($eventId: ID!) {
          sportsEventDetail(eventId: $eventId) {
            meta { code message }
            data {
              leagueEvents { id name }
              event {
                id
                name
                slugName
                date
                leagueId
                leagueName
                sportId
                sportName
                eventCode
              }
              markets {
                marketId
                marketCode
                name
                type
                marketStatus
                inplay
                runners {
                  selectionId
                  name
                  sort
                  status
                }
              }
            }
          }
        }
      `,
      { eventId: _params.event }
    ),
    'sportsEventDetail'
  )
}

export async function getAllSportsData() {
  const res = await getSportsList()
  return res
}

export async function getSportsBookmarks() {
  return mapResponse<any[]>(
    graphqlRequest(
      `
        query SportsBookmarks {
          sportsBookmarks { meta { code message } data { eventId meta } }
        }
      `
    ),
    'sportsBookmarks'
  )
}

export async function getRecentSports() {
  return mapResponse<any[]>(
    graphqlRequest(
      `
        query RecentSports {
          recentSports { meta { code message } data { eventId meta } }
        }
      `
    ),
    'recentSports'
  )
}

export async function getSportsSettings(params: { sportId: string | number; leagueId: string | number; eventId: string }) {
  return mapResponse<{
    exchange: { minStake: number | null; maxStake: number | null; minOdds: number | null; maxOdds: number | null }
    bookmaker: { minStake: number | null; maxStake: number | null; minOdds: number | null; maxOdds: number | null }
    fancy: { minStake: number | null; maxStake: number | null; minOdds: null; maxOdds: null }
  }>(
    graphqlRequest(
      `
        query SportsSettings($sportId: String!, $leagueId: String!, $eventId: String!) {
          sportsSettings(sportId: $sportId, leagueId: $leagueId, eventId: $eventId) {
            meta { code message }
            data {
              exchange {
                minStake
                maxStake
                minOdds
                maxOdds
              }
              bookmaker {
                minStake
                maxStake
                minOdds
                maxOdds
              }
              fancy {
                minStake
                maxStake
                minOdds
                maxOdds
              }
            }
          }
        }
      `,
      { sportId: String(params.sportId), leagueId: String(params.leagueId), eventId: String(params.eventId) }
    ),
    'sportsSettings'
  )
}

export async function getFancyOdds(eventCode: string, marketCode: string = 'FANCY') {
  return mapResponse<Array<{
    marketCode: string
    selectionId: string
    selection: string
    odds: number
    updatedAt: string
  }>>(
    graphqlRequest(
      `
        mutation GetFancyOdds($eventId: String!, $marketCode: String!) {
          fancyOdds(eventId: $eventId, marketCode: $marketCode) {
            meta { code message }
            data {
              marketCode
              selectionId
              selection
              odds
              updatedAt
            }
          }
        }
      `,
      { eventId: eventCode, marketCode }
    ),
    'fancyOdds'
  )
}

export type PlaceBetPayload = {
  eventId: string
  leagueId?: string | number
  sportId?: string | number
  marketId?: string
  selectionId?: string | number
  selection?: string
  selectionType: 'back' | 'lay'
  odds: number
  stake: number
  marketType?: 'exchange' | 'bookmaker' | 'fancy'
  marketCode?: string
  odds_size?: number
}

export async function placeSportsBet(payload: PlaceBetPayload) {
  return mapResponse<any>(
    graphqlRequest(
      `
        mutation PlaceSportsBet(
          $eventId: String!
          $leagueId: String
          $sportId: String
          $marketId: String
          $selectionId: String
          $selection: String
          $selectionType: String!
          $odds: Float!
          $stake: Float!
          $marketType: String
          $marketCode: String
          $odds_size: Float
        ) {
          placeSportsBet(
            eventId: $eventId
            leagueId: $leagueId
            sportId: $sportId
            marketId: $marketId
            selectionId: $selectionId
            selection: $selection
            selectionType: $selectionType
            odds: $odds
            stake: $stake
            marketType: $marketType
            marketCode: $marketCode
            odds_size: $odds_size
          ) { meta { code message } data { id amount type createdAt } }
        }
      `,
      {
        eventId: payload.eventId,
        leagueId: payload.leagueId?.toString(),
        sportId: payload.sportId?.toString(),
        marketId: payload.marketId,
        selectionId: payload.selectionId?.toString(),
        selection: payload.selection,
        selectionType: payload.selectionType,
        odds: payload.odds,
        stake: payload.stake,
        marketType: payload.marketType,
        marketCode: payload.marketCode,
        odds_size: payload.odds_size,
      }
    ),
    'placeSportsBet'
  )
}

export type FancyBetPayload = {
  stake: number
  selectionType: 'back' | 'lay'
  odds: string
  selection: string
  marketType: 'fancy'
  marketId?: string | null
  marketCode: string
  selectionId: string
  odds_size: number
  eventId: string
  leagueId: string
  sportId: string
}

export async function placeFancyBet(payload: FancyBetPayload) {
  return mapResponse<any>(
    graphqlRequest(
      `
        mutation PlaceFancyBet(
          $stake: Float!
          $selectionType: String!
          $odds: String!
          $selection: String!
          $marketType: String!
          $marketId: String
          $marketCode: String!
          $selectionId: String!
          $odds_size: Float!
          $eventId: String!
          $leagueId: String!
          $sportId: String!
        ) {
          placeFancyBet(
            stake: $stake
            selectionType: $selectionType
            odds: $odds
            selection: $selection
            marketType: $marketType
            marketId: $marketId
            marketCode: $marketCode
            selectionId: $selectionId
            odds_size: $odds_size
            eventId: $eventId
            leagueId: $leagueId
            sportId: $sportId
          ) { meta { code message } data { id amount type createdAt } }
        }
      `,
      {
        stake: payload.stake,
        selectionType: payload.selectionType,
        odds: payload.odds,
        selection: payload.selection,
        marketType: payload.marketType,
        marketId: payload.marketId,
        marketCode: payload.marketCode,
        selectionId: payload.selectionId,
        odds_size: payload.odds_size,
        eventId: payload.eventId,
        leagueId: payload.leagueId,
        sportId: payload.sportId,
      }
    ),
    'placeFancyBet'
  )
}

export async function addRecentSports(eventId: string) {
  return mapResponse<any>(
    graphqlRequest(
      `
        mutation AddRecentSports($eventId: String!) {
          addRecentSports(eventId: $eventId) { meta { code message } data { id name slugName } }
        }
      `,
      { eventId }
    ),
    'addRecentSports'
  )
}

export async function getBookmarkedSports() {
  return mapResponse<any[]>(
    graphqlRequest(
      `
        query SportsBookmarks {
          sportsBookmarks { meta { code message } data { eventId meta } }
        }
      `
    ),
    'sportsBookmarks'
  )
}

export async function toggleBookmarkSports(eventId: string) {
  return mapResponse<any>(
    graphqlRequest(
      `
        mutation ToggleBookmarkSports($eventId: String!) {
          toggleBookmarkSports(eventId: $eventId) { meta { code message } data { id name slugName } }
        }
      `,
      { eventId }
    ),
    'toggleBookmarkSports'
  )
}

export type UserBet = {
  id: string
  eventId: string
  marketId?: string
  marketName?: string
  marketType?: 'exchange' | 'bookmaker' | 'fancy'
  selectionId?: string | number
  selection: string
  side: 'back' | 'lay'
  odds: number
  stake: number
  status: 'open' | 'matched' | 'settled' | 'cancelled' | 'void'
  createdAt?: string
  pl?: number
}

