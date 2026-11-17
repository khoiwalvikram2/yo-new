import { gql } from '@apollo/client'

export const CASINO_API_PROVIDERS = gql`
  query CasinoApiProviders {
    casinoApiProviders { id key name status lastSyncAt }
  }
`

export const CASINO_VENDORS = gql`
  query CasinoVendors($providerId: ID, $category: CasinoMainCategory) {
    casinoVendors(providerId: $providerId, category: $category) { id name slug }
  }
`

export const CASINO_VENDORS_WITH_SETTINGS = gql`
  query CasinoVendorsWithSettings($providerId: ID, $category: CasinoMainCategory) {
    casinoVendorsWithSettings(providerId: $providerId, category: $category) {
      id
      name
      slug
      enabled
      gamesCount
      enabledGamesCount
      displayOrder
    }
  }
`

export const TOGGLE_CASINO_VENDOR_ENABLED = gql`
  mutation ToggleCasinoVendorEnabled($vendorId: ID!, $enabled: Boolean!) {
    toggleCasinoVendorEnabled(vendorId: $vendorId, enabled: $enabled) {
      success
      message
    }
  }
`

export const BULK_UPDATE_VENDOR_SETTINGS = gql`
  mutation BulkUpdateVendorSettings($vendorIds: [ID!]!, $enabled: Boolean!) {
    bulkUpdateVendorSettings(vendorIds: $vendorIds, enabled: $enabled) {
      success
      message
    }
  }
`

export const UPDATE_VENDOR_DISPLAY_ORDER = gql`
  mutation UpdateVendorDisplayOrder($vendorOrders: [VendorOrderInput!]!) {
    updateVendorDisplayOrder(vendorOrders: $vendorOrders) {
      success
      message
    }
  }
`

export const CASINO_GAMES = gql`
  query CasinoGames($input: GamesQueryInput!) {
    casinoGames(input: $input) {
      total
      page
      pageSize
      items {
        id
        name
        slug
        mainCategory
        vendorId
        vendorName
        thumbnailUrl
        rtp
        demoUrl
        betSettingsCount
        isActive
        tenantEnabled
        premiumOnly
        order
        featured
        categoryAssigned
        limits {
          minStake
          maxStake
          maxWin
          maxWinTarget
          maxWinPlayers
        }
        updatedAt
      }
    }
  }
`

export const GAMES_IN_CATEGORY = gql`
  query GamesInCategory($categoryId: ID!) {
    gamesInCategory(categoryId: $categoryId)
  }
`

export const GAMES_BY_IDS = gql`
  query GamesByIds($gameIds: [ID!]!, $skipVendorFilter: Boolean) {
    gamesByIds(gameIds: $gameIds, skipVendorFilter: $skipVendorFilter) {
      id
      name
      slug
      mainCategory
      vendorId
      vendorName
      thumbnailUrl
      rtp
      demoUrl
      isActive
      tenantEnabled
      premiumOnly
      order
      featured
      categoryAssigned
      limits {
        minStake
        maxStake
        maxWin
        maxWinTarget
        maxWinPlayers
      }
      updatedAt
    }
  }
`

export const TOGGLE_CASINO_GAME_ENABLED = gql`
  mutation ToggleCasinoGameEnabled($gameId: ID!, $enabled: Boolean!) {
    toggleCasinoGameEnabled(gameId: $gameId, enabled: $enabled) { success message }
  }
`

export const REORDER_VENDOR_GAMES = gql`
  mutation ReorderVendorGames($vendorId: ID!, $category: CasinoMainCategory!, $gameIds: [ID!]!) {
    reorderVendorGames(vendorId: $vendorId, category: $category, gameIds: $gameIds) { success message }
  }
`

export const GAME_VIP_TIERS = gql`
  query GameVipTiers($gameId: ID!) {
    gameVipTiers(gameId: $gameId) {
      tierId
      tierName
      enabled
      updatedAt
    }
  }
`

export const TOGGLE_VIP_TIER_GAME_ENABLED = gql`
  mutation ToggleVipTierGameEnabled($tierId: ID!, $gameId: ID!, $enabled: Boolean!) {
    toggleVipTierGameEnabled(tierId: $tierId, gameId: $gameId, enabled: $enabled) { success message }
  }
`

export const BULK_UPDATE_VIP_TIER_GAMES = gql`
  mutation BulkUpdateVipTierGames($tierId: ID!, $gameIds: [ID!]!, $enabled: Boolean!) {
    bulkUpdateVipTierGames(tierId: $tierId, gameIds: $gameIds, enabled: $enabled) { success message }
  }
`

export const UPDATE_CASINO_GAME_SETTINGS = gql`
  mutation UpdateCasinoGameSettings($gameId: ID!, $enabled: Boolean, $premiumOnly: Boolean, $limits: CasinoGameLimitsInput) {
    updateCasinoGameSettings(gameId: $gameId, enabled: $enabled, premiumOnly: $premiumOnly, limits: $limits) { success message }
  }
`

export const BULK_UPDATE_CASINO_GAME_SETTINGS = gql`
  mutation BulkUpdateCasinoGameSettings($gameIds: [ID!]!, $enabled: Boolean, $premiumOnly: Boolean, $limits: CasinoGameLimitsInput) {
    bulkUpdateCasinoGameSettings(gameIds: $gameIds, enabled: $enabled, premiumOnly: $premiumOnly, limits: $limits) { success message }
  }
`

export const TOGGLE_CASINO_GAME_MASTER_ACTIVE = gql`
  mutation ToggleCasinoGameMasterActive($gameId: ID!, $isActive: Boolean!) {
    toggleCasinoGameMasterActive(gameId: $gameId, isActive: $isActive) {
      success
      message
    }
  }
`

export const CASINO_GAME_BET_SETTINGS = gql`
  query CasinoGameBetSettings($gameId: ID!) {
    casinoGameBetSettings(gameId: $gameId) {
      id
      gameId
      playerId
      playerName
      playerPhone
      betEnabled
      minStake
      maxStake
      maxWin
      createdAt
      updatedAt
    }
  }
`

export const UPSERT_CASINO_GAME_BET_SETTINGS = gql`
  mutation UpsertCasinoGameBetSettings($gameId: ID!, $settings: CasinoGameBetSettingsInput!) {
    upsertCasinoGameBetSettings(gameId: $gameId, settings: $settings) {
      id
      gameId
      playerId
      playerName
      playerPhone
      betEnabled
      minStake
      maxStake
      maxWin
      createdAt
      updatedAt
    }
  }
`

export const DELETE_CASINO_GAME_BET_SETTINGS = gql`
  mutation DeleteCasinoGameBetSettings($gameId: ID!, $playerId: String) {
    deleteCasinoGameBetSettings(gameId: $gameId, playerId: $playerId) { success message }
  }
`

export const PROVIDERS_WITH_VENDORS = gql`
  query ProvidersWithVendors {
    providersWithVendors {
      id
      key
      name
      status
      lastSyncAt
      vendors { id name slug }
      vendorStats {
        vendorId
        vendorName
        totalGames
        activeGames
      }
    }
  }
`

export const PROVIDER_VENDOR_SHARES = gql`
  query ProviderVendorShares($providerId: ID!) {
    providerVendorShares(providerId: $providerId) {
      vendorId
      vendorName
      sharePercentage
      updatedAt
    }
  }
`

export const PROVIDER_ANALYTICS = gql`
  query ProviderAnalytics($providerId: ID!, $start: String, $end: String) {
    providerAnalytics(providerId: $providerId, start: $start, end: $end) {
      providerId
      totalGGR
      vendorBreakdown {
        vendorId
        vendorName
        ggr
        shareAmount
        transactionCount
      }
    }
  }
`

export const PROVIDERS_ANALYTICS = gql`
  query ProvidersAnalytics($providerIds: [ID!]!, $start: String, $end: String) {
    providersAnalytics(providerIds: $providerIds, start: $start, end: $end) {
      providerId
      totalGGR
      vendorBreakdown {
        vendorId
        vendorName
        ggr
        shareAmount
        transactionCount
        totalStake
      }
    }
  }
`

export const VENDOR_ANALYTICS = gql`
  query VendorAnalytics($providerId: ID!, $vendorId: ID!, $start: String, $end: String) {
    vendorAnalytics(providerId: $providerId, vendorId: $vendorId, start: $start, end: $end) {
      vendorId
      vendorName
      ggr
      shareAmount
      transactionCount
      totalStake
    }
  }
`

export const VENDOR_GAMES_STATS = gql`
  query VendorGamesStats($vendorId: ID!) {
    vendorGamesStats(vendorId: $vendorId) {
      vendorId
      vendorName
      totalGames
      activeGames
    }
  }
`

export const CREATE_CASINO_PROVIDER = gql`
  mutation CreateCasinoProvider($input: ProviderInput!) {
    createCasinoProvider(input: $input) { id key name status lastSyncAt }
  }
`

export const UPDATE_CASINO_PROVIDER = gql`
  mutation UpdateCasinoProvider($id: ID!, $input: ProviderInput!) {
    updateCasinoProvider(id: $id, input: $input) { id key name status lastSyncAt }
  }
`

export const DELETE_CASINO_PROVIDER = gql`
  mutation DeleteCasinoProvider($id: ID!) {
    deleteCasinoProvider(id: $id)
  }
`

export const UPSERT_PROVIDER_VENDOR_SHARE = gql`
  mutation UpsertProviderVendorShare($providerId: ID!, $vendorId: ID!, $sharePercentage: Float!) {
    upsertProviderVendorShare(providerId: $providerId, vendorId: $vendorId, sharePercentage: $sharePercentage) {
      vendorId
      sharePercentage
      updatedAt
    }
  }
`

export const WHITELABEL_CASINO_PROVIDER_SETTINGS = gql`
  query WhitelabelCasinoProviderSettings($tenantId: String!) {
    whitelabelCasinoProviderSettings(tenantId: $tenantId) {
      id
      tenantId
      providerId
      providerKey
      providerName
      enabled
      displayOrder
    }
  }
`

export const TOGGLE_WHITELABEL_CASINO_PROVIDER = gql`
  mutation ToggleWhitelabelCasinoProvider($tenantId: String!, $providerId: ID!, $enabled: Boolean!) {
    toggleWhitelabelCasinoProvider(tenantId: $tenantId, providerId: $providerId, enabled: $enabled) {
      success
      message
    }
  }
`

export const WHITELABEL_CASINO_VENDOR_OVERRIDE_SETTINGS = gql`
  query WhitelabelCasinoVendorOverrideSettings($tenantId: String!) {
    whitelabelCasinoVendorOverrideSettings(tenantId: $tenantId) {
      id
      tenantId
      vendorId
      vendorName
      vendorSlug
      providerId
      providerKey
      disabled
    }
  }
`

export const SET_WHITELABEL_CASINO_VENDOR_SUPER_ADMIN_OVERRIDE = gql`
  mutation SetWhitelabelCasinoVendorSuperAdminOverride($tenantId: String!, $vendorId: ID!, $disabled: Boolean!) {
    setWhitelabelCasinoVendorSuperAdminOverride(tenantId: $tenantId, vendorId: $vendorId, disabled: $disabled) {
      success
      message
    }
  }
`

export const WHITELABEL_CASINO_GAME_OVERRIDE_SETTINGS = gql`
  query WhitelabelCasinoGameOverrideSettings($tenantId: String!, $providerId: ID, $vendorId: ID, $search: String, $page: Int, $pageSize: Int) {
    whitelabelCasinoGameOverrideSettings(tenantId: $tenantId, providerId: $providerId, vendorId: $vendorId, search: $search, page: $page, pageSize: $pageSize) {
      items {
        id
        tenantId
        gameId
        gameName
        externalId
        thumbnailUrl
        vendorId
        vendorName
        providerId
        providerKey
        disabled
      }
      total
      hasMore
    }
  }
`

export const SET_WHITELABEL_CASINO_GAME_SUPER_ADMIN_OVERRIDE = gql`
  mutation SetWhitelabelCasinoGameSuperAdminOverride($tenantId: String!, $gameId: ID!, $disabled: Boolean!) {
    setWhitelabelCasinoGameSuperAdminOverride(tenantId: $tenantId, gameId: $gameId, disabled: $disabled) {
      success
      message
    }
  }
`

// Custom categories
export const CASINO_CUSTOM_CATEGORIES = gql`
  query CasinoCustomCategories($mainCategory: CasinoMainCategory) {
    casinoCustomCategories(mainCategory: $mainCategory) {
      id
      mainCategory
      type
      subtitle
      name
      slug
      iconData
      order
      isActive
      gameCount
      createdAt
      updatedAt
    }
  }
`

export const CASINO_CATEGORY = gql`
  query CasinoCategory($id: ID!) {
    casinoCategory(id: $id) {
      id
      mainCategory
      type
      subtitle
      name
      slug
      iconData
      order
      isActive
      createdAt
      updatedAt
    }
  }
`

export const CATEGORIES_FOR_GAME = gql`
  query CategoriesForGame($gameId: ID!, $mainCategory: CasinoMainCategory) {
    categoriesForGame(gameId: $gameId, mainCategory: $mainCategory) {
      id
      mainCategory
      type
      subtitle
      name
      slug
      iconData
      order
      isActive
    }
  }
`

export const CREATE_CASINO_CATEGORY = gql`
  mutation CreateCasinoCategory($input: CreateCasinoCategoryInput!) {
    createCasinoCategory(input: $input) {
      id
      mainCategory
      type
      subtitle
      name
      slug
      iconData
      order
      isActive
      gameCount
      createdAt
      updatedAt
    }
  }
`

export const UPDATE_CASINO_CATEGORY = gql`
  mutation UpdateCasinoCategory($id: ID!, $input: UpdateCasinoCategoryInput!) {
    updateCasinoCategory(id: $id, input: $input) {
      id
      mainCategory
      type
      subtitle
      name
      slug
      iconData
      order
      isActive
      createdAt
      updatedAt
    }
  }
`

export const DELETE_CASINO_CATEGORY = gql`
  mutation DeleteCasinoCategory($id: ID!) {
    deleteCasinoCategory(id: $id)
  }
`

export const REORDER_CASINO_CATEGORIES = gql`
  mutation ReorderCasinoCategories($inputs: [ReorderCasinoCategoriesInput!]!) {
    reorderCasinoCategories(inputs: $inputs) { success message }
  }
`

export const ASSIGN_GAMES_TO_CATEGORY = gql`
  mutation AssignGamesToCategory($categoryId: ID!, $gameIds: [ID!]!) {
    assignGamesToCategory(categoryId: $categoryId, gameIds: $gameIds) { success message }
  }
`

export const CASINO_LOUNGE_GAME_IMAGES = gql`
  query CasinoLoungeGameImages($categoryId: ID!) {
    casinoLoungeGameImages(categoryId: $categoryId) { gameId imageData }
  }
`

export const SAVE_CASINO_LOUNGE_GAMES = gql`
  mutation SaveCasinoLoungeGames($categoryId: ID!, $gameIds: [ID!]!, $images: [CasinoLoungeGameImageInput!]) {
    saveCasinoLoungeGames(categoryId: $categoryId, gameIds: $gameIds, images: $images) { success message }
  }
`

export const REMOVE_GAMES_FROM_CATEGORY = gql`
  mutation RemoveGamesFromCategory($categoryId: ID!, $gameIds: [ID!]!) {
    removeGamesFromCategory(categoryId: $categoryId, gameIds: $gameIds) { success message }
  }
`

export const REORDER_CATEGORY_GAMES = gql`
  mutation ReorderCategoryGames($categoryId: ID!, $gameIds: [ID!]!) {
    reorderCategoryGames(categoryId: $categoryId, gameIds: $gameIds) { success message }
  }
`

export const GMAG_ROUND_DETAIL = gql`
  mutation GmagRoundDetail($roundId: String!, $endTime: String!, $providerCode: String!, $language: String) {
    gmagRoundDetail(roundId: $roundId, endTime: $endTime, providerCode: $providerCode, language: $language) {
      url
    }
  }
`

export const CASINO_SELECTION_GAMES = gql`
  query CasinoSelectionGames($input: CasinoSelectionInput!) {
    casinoSelectionGames(input: $input) {
      total page pageSize
      items { id name slug mainCategory vendorId vendorName thumbnailUrl }
    }
  }
`
export const CASINO_SELECTION_GAME_IDS = gql`
  query CasinoSelectionGameIds($providerId: ID!, $gameIds: [ID!]!) {
    casinoSelectionGameIds(providerId: $providerId, gameIds: $gameIds)
  }
`
