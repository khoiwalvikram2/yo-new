export const baseSDL = /* GraphQL */ `
  scalar JSON

  type ApiMeta {
    code: Int
    message: String
    token: String
  }

  type ApiResponse {
    meta: ApiMeta
    data: JSON
  }

  type Query {
    _health: String
  }

  type Mutation {
    _noop: String
  }
`

export const userSDL = /* GraphQL */ `
  type UserProfile {
    id: ID!
    username: String
    name: String
    phone: String
    level: Int
    balance: Float!
    bonusBalance: Float
    exposure: Float
    walletType: String
    affiliateCode: String
    referralBalance: Float
  }

  type AuthPayload {
    token: String!
    user: UserProfile!
  }

  type OtpResponse {
    success: Boolean!
    message: String
  }

  type MessageResponse {
    success: Boolean!
    message: String
  }

  input RegisterInput {
    username: String!
    phone: String!
    password: String!
    confirmPassword: String!
    affiliateCode: String
    otp: String
  }

  input LoginInput {
    phoneOrUsername: String!
    password: String!
  }

  extend type Query {
    me: UserProfile
    userData: UserProfile
    userDetail: ApiResponse
  }

  extend type Mutation {
    requestOtp(phone: String!): OtpResponse!
    loginWithOtp(phone: String!, otp: String!): AuthPayload!
    registerUser(input: RegisterInput!): OtpResponse!
    login(input: LoginInput!): AuthPayload!
    changePassword(currentPassword: String!, newPassword: String!): MessageResponse!
  }
`

export const walletSDL = /* GraphQL */ `
  extend type Query {
    accountStatement(startDate: String!, endDate: String!, isChecked: Boolean): ApiResponse
    resultTransactions(startDate: String!, endDate: String!, isChecked: Boolean): ApiResponse
    withdrawalRequests(startDate: String, endDate: String): ApiResponse
  }

  extend type Mutation {
    changeWallet(selectedWallet: String!): ApiResponse
    createWithdrawalRequest(accountId: ID!, amount: Float!): ApiResponse
  }
`

export const paymentsSDL = /* GraphQL */ `
  extend type Query {
    adminAccounts: ApiResponse
    adminDepositRequests(startDate: String, endDate: String): ApiResponse
  }

  extend type Mutation {
    createAdminDeposit(accountId: ID!, amount: Float!, txnRef: String, baseImage: String, type: String): ApiResponse
    createDeposit(amount: Float!): ApiResponse
  }
`

export const accountSDL = /* GraphQL */ `
  input AccountDetailsInput {
    accountNumber: String!
    ifscCode: String
    accountType: String
    type: String
    bankName: String
    accountHolderName: String!
  }

  input AccountDetailsUpdateInput {
    accountId: ID!
    accountNumber: String
    ifscCode: String
    accountType: String
    type: String
    bankName: String
    accountHolderName: String
  }

  extend type Query {
    accountDetails: ApiResponse
  }

  extend type Mutation {
    createAccountDetails(input: AccountDetailsInput!): ApiResponse
    updateAccountDetails(input: AccountDetailsUpdateInput!): ApiResponse
    deleteAccountDetails(accountId: ID!): ApiResponse
  }
`

export const appSDL = /* GraphQL */ `
  extend type Query {
    appSettings: ApiResponse
    allAppSettings: ApiResponse
    advertisements: ApiResponse
  }
`

export const casinoSDL = /* GraphQL */ `
  extend type Query {
    gapCasinoUrl(gameId: String!): ApiResponse
    casinoGames(input: CasinoGamesInput): ApiResponse
    casinoCategories(liveOnly: Boolean, slotsOnly: Boolean): ApiResponse
    casinoProviders(category: String, liveOnly: Boolean): ApiResponse
    casinoSummary(input: CasinoGamesInput): ApiResponse
    recentCasinoGames(limit: Int): ApiResponse
    likedCasinoGames(limit: Int): ApiResponse
  }

  extend type Mutation {
    likeCasinoGame(gameId: String!): CasinoRedirectResponse!
    unlikeCasinoGame(gameId: String!): CasinoRedirectResponse!
  }
`

export const bonusSDL = /* GraphQL */ `
  extend type Query {
    bonusData: ApiResponse
  }

  extend type Mutation {
    activateBonus(bonusId: ID!): ApiResponse
    forfeitBonus: ApiResponse
    claimBonus: ApiResponse
  }
`

export const referralSDL = /* GraphQL */ `
  extend type Query {
    referralUsers: ApiResponse
    referralTransactions: ApiResponse
    weeklyReferralSummary(startDate: String!, endDate: String!): ApiResponse
  }

  extend type Mutation {
    claimReferralBonus(amount: Float!): ApiResponse
  }
`

export const sportsSDL = /* GraphQL */ `
  input SportsBetInput {
    eventId: String!
    leagueId: String
    sportId: String
    marketId: String
    selectionId: String
    selection: String
    selectionType: String!
    odds: Float!
    stake: Float!
    marketType: String
    marketCode: String
    odds_size: Float
  }

  input FancyBetInput {
    stake: Float!
    selectionType: String!
    odds: String!
    selection: String!
    marketType: String!
    marketId: String
    marketCode: String!
    selectionId: String!
    odds_size: Float!
    eventId: String!
    leagueId: String!
    sportId: String!
  }

  extend type Query {
    sportsList: ApiResponse
    userSportsData: ApiResponse
    sportsEventDetails(sport: String!, league: String!, event: String!): ApiResponse
    allSportsData: ApiResponse
    sportsSettings(sportId: String!, leagueId: String!, eventId: String!): ApiResponse
    fancyOdds(eventCode: String!): ApiResponse
    recentSports: ApiResponse
    bookmarkedSports: ApiResponse
    activeFancies(eventCode: String!): ApiResponse
  }

  extend type Mutation {
    placeSportsBet(input: SportsBetInput!): ApiResponse
    placeFancyBet(input: FancyBetInput!): ApiResponse
    addRecentSports(eventId: String!): ApiResponse
    toggleBookmarkSports(eventId: String!): ApiResponse
  }
`

export const allTypeDefs = [
  baseSDL,
  userSDL,
  walletSDL,
  paymentsSDL,
  accountSDL,
  appSDL,
  casinoSDL,
  bonusSDL,
  referralSDL,
  sportsSDL,
].join('\n')

