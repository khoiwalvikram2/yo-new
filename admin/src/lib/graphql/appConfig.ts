import { gql } from '@apollo/client'

export const APP_DISPLAY_CONFIG = gql`
  query AppDisplayConfig {
    appDisplayConfig { baseCurrency timeZone defaultLocale }
  }
`

export const APP_CONFIG = gql`
  query AppConfig {
    appConfig {
      supportEmail
      supportPhone
      whatsappSupportPhone
      defaultLocale
      timeZone
      baseCurrency
      maintenance
      maintenanceMessage
      newsTicker
      seoTitle
      seoDescription
      ogImageUrl
      socialLinks
      analytics
      features { sportsEnabled casinoEnabled matkaEnabled agentsEnabled referralsEnabled bonusesEnabled registerEnabled }
      payments {
        depositMin
        depositMax
        withdrawalMin
        withdrawalMax
        depositFeePercent
        withdrawalFeePercent
        kycRequiredToWithdraw
        roundingStrategy
        upiPayoutsDisabled
        bankPayoutsDisabled
        hideAddUpi
        hideAddBank
        maxDailyWithdrawalRequests
      }
      risk { overallExposureCap dailyStakeLimit weeklyStakeLimit cashoutEnabled }
      notifications { host port username fromEmail alertRecipients }
      sms { provider senderId }
      adminUiNotifications { enabled placement durationMs showSuccess showError showInfo showWarning muteCategories soundEnabled }
      webhooks { endpointUrl events }
      observability { sentryDsn logLevel metricsEnabled }
      pwa { shortName themeColor backgroundColor }
      theme {
        primary
        success
        warning
        danger
        dark { bgPage textPrimary textSecondary border }
        light { bgPage textPrimary textSecondary border }
        bgPage
        textPrimary
        textSecondary
        border
      }
      preLoginBannerUrl
      postLoginBannerUrl
      sportsGlobalConfig {
        oddsFormat
        showFancy
        showBookmaker
        showExchange
        defaultCommission {
          exchange
          bookmaker
          fancy
        }
        defaultStakeLimits {
          exchangeMin
          exchangeMax
          bookmakerMin
          bookmakerMax
          fancyMin
          fancyMax
        }
        defaultBetDelays {
          exchange
          bookmaker
          fancy
        }
        defaultBetCooldowns {
          exchange
          bookmaker
          fancy
        }
      }
      updatedAt
    }
  }
`

export const UPDATE_APP_CONFIG = gql`
  mutation UpdateAppConfig($input: UpdateAppConfigInput!) {
    updateAppConfig(input: $input) { success message }
  }
`

export const CMS_PAGES = gql`
  query CmsPages($locale: String, $status: CMSStatus) {
    cmsPages(locale: $locale, status: $status) {
      id slug title locale status updatedAt
    }
  }
`

export const UPSERT_CMS_PAGE = gql`
  mutation UpsertCMSPage($input: UpsertCMSPageInput!) {
    upsertCMSPage(input: $input) { success message }
  }
`

export const PUBLISH_CMS_PAGE = gql`
  mutation PublishCMSPage($id: ID!) {
    publishCMSPage(id: $id) { success message }
  }
`

export const DELETE_CMS_PAGE = gql`
  mutation DeleteCMSPage($id: ID!) {
    deleteCMSPage(id: $id) { success message }
  }
`

