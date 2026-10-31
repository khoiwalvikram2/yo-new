import React, { Suspense } from 'react'
import { IconAlertTriangle } from '@tabler/icons-react'
import { Button } from '../../ui/components/Button'
import { buttonClassName } from '../../ui/components/buttonClassName'
import { strokeFor } from '../../ui/components/icons'
import routeErrorStyles from './routeError.module.css'
import { createBrowserRouter, RouterProvider, Navigate, useRouteError } from 'react-router-dom'
import { LoadingState } from '../../ui/components/LoadingState'
import { RequireAgentAuth } from '../../shared/core/RequireAgentAuth'
import { RequireAuthOrAgent } from '../../shared/core/RequireAuthOrAgent'
import { AgentDomainGuard } from '../../shared/core/AgentDomainGuard'
import { AgentSchemeGuard } from '../../shared/core/AgentSchemeGuard'
import { Layout } from '../../components/Layout'
import { ROUTES } from '../../shared/core/constants'
import { lazyWithRetry } from '../../shared/utils/lazyWithRetry'
import { useAuthStore } from '../../shared/core/authStore'
import { LightRegion } from '../../shell/LightRegion'
import { PublicRegion } from '../../shell/PublicRegion'

// Lazy load pages for better performance
const AdminHomeEntry = lazyWithRetry(() => import('../../routes/overview/AdminHomeEntry'))
const LoginPage = lazyWithRetry(() => import('../../routes/LoginPage'))

// Sports Module
const SportsEventsPage = lazyWithRetry(() => import('../../routes/sports/EventsPage'))
const SportsEventDetailPage = lazyWithRetry(() => import('../../routes/sports/EventDetailPage'))
const SportsBuilderPage = lazyWithRetry(() => import('../../routes/sports/BuilderPage'))
const SportsConfigurationPage = lazyWithRetry(() => import('../../routes/sports/ConfigurationPage'))
const SportsLiveAnalysisPage = lazyWithRetry(() => import('../../routes/sports/live-analysis/LiveAnalysisPage'))
const SportsManualResultsPage = lazyWithRetry(() => import('../../routes/sports/ManualResultsPage'))

// Casino Module
const CasinoManagementPage = lazyWithRetry(() => import('../../routes/casino/management/ManagementPage'))
const VendorManagementPage = lazyWithRetry(() => import('../../routes/casino/management/VendorManagementPage'))
const CasinoProvidersPage = lazyWithRetry(() => import('../../routes/casino/ProvidersPage'))
const CasinoCategoriesPage = lazyWithRetry(() => import('../../routes/casino/CategoriesManagementPage'))
const CategoryAddGamesPage = lazyWithRetry(() => import('../../routes/casino/CategoryAddGamesPage'))
const CasinoLiveAnalysisPage = lazyWithRetry(() => import('../../routes/casino/live-analysis/LiveAnalysisPage'))

// Bet List (unified bets page)
const BetListPage = lazyWithRetry(() => import('../../routes/bets/BetListPage'))
const BonusAwardsListPage = lazyWithRetry(() => import('../../routes/bonus-awards/BonusAwardsListPage'))

// Matka Module
const MatkaResultsPage = lazyWithRetry(() => import('../../routes/matka/results/MatkaResultsPage'))
const MatkaRunningMarketsPage = lazyWithRetry(() => import('../../routes/matka/running/RunningMarketsPage'))
const MatkaLiveAnalysisPage = lazyWithRetry(() => import('../../routes/matka/live-analysis/LiveAnalysisPage'))
const MatkaManagementPage = lazyWithRetry(() => import('../../routes/matka/ManagementPage'))
const MatkaSettingsPage = lazyWithRetry(() => import('../../routes/matka/SettingsPage'))
const MatkaCreateEditPage = lazyWithRetry(() => import('../../routes/matka/CreateEditPage'))
const MatkaViewPage = lazyWithRetry(() => import('../../routes/matka/ViewPage'))
// Worli (Matka) Running Markets
const WorliRunningMarketsPage = lazyWithRetry(() => import('../../modules/matka/worli/RunningMarketsPage'))
const WorliRunningMarketDetailPage = lazyWithRetry(() => import('../../modules/matka/worli/RunningMarketDetailPage'))

// Players Module
const PlayersSearchPage = lazyWithRetry(() => import('../../routes/players/SearchPage'))
const CreatePlayerPage = lazyWithRetry(() => import('../../routes/players/CreatePage'))
const PlayerProfilePage = lazyWithRetry(() => import('../../routes/players/profile/[playerId]'))

// Agents Module
const AgentsSearchPage = lazyWithRetry(() => import('../../routes/agents/SearchPage'))
const AgentsCreatePage = lazyWithRetry(() => import('../../routes/agents/CreatePage'))
const AgentsEditPage = lazyWithRetry(() => import('../../routes/agents/EditPage'))
const AgentsHierarchyPage = lazyWithRetry(() => import('../../routes/agents/HierarchyPage'))
const AgentProfile = lazyWithRetry(() => import('../../modules/agents/AgentProfilePage'))
const AgentHome = lazyWithRetry(() => import('../../modules/agents/AgentHome'))
const AgentReferralLinkPage = lazyWithRetry(() => import('../../routes/agent/referral/AgentReferralLinkPage'))

// Commission Module (for commission agents)
const CommissionDashboard = lazyWithRetry(() => import('../../routes/commission/CommissionDashboard'))
const CommissionHistoryPage = lazyWithRetry(() => import('../../routes/commission/CommissionHistoryPage'))

// Unified Settlement Page (for both agents and admins)
const UnifiedSettlementPage = lazyWithRetry(() => import('../../routes/settlement/UnifiedSettlementPage'))

// Credit Management (for whitelabel admins)
const CreditManagementPage = lazyWithRetry(() => import('../../routes/credit/CreditManagementPage'))
// Agent Credit Management (for CREDIT scheme agents)
const AgentCreditManagementPage = lazyWithRetry(() => import('../../routes/agent/credit/CreditManagementPage'))

// Notifications Module
const NotificationsPage = lazyWithRetry(() => import('../../routes/notifications/NotificationsPage'))
const NotificationDetailPage = lazyWithRetry(() => import('../../routes/notifications/NotificationDetailPage'))
const TaskDetailPage = lazyWithRetry(() => import('../../routes/notifications/TaskDetailPage'))

// Reporting Module
const AgentOverviewReport = lazyWithRetry(() => import('../../routes/reporting/AgentOverviewReport'))
const ExportsPage = lazyWithRetry(() => import('../../routes/reporting/ExportsPage'))
const SnapshotHealthPage = lazyWithRetry(() => import('../../routes/reporting/SnapshotHealthPage'))

// Promotions Module
const PromotionsCampaignsPage = lazyWithRetry(() => import('../../routes/promotions/CampaignsPage'))
const PromotionsContentPage = lazyWithRetry(() => import('../../routes/promotions/ContentPage'))

// Bonuses Module
const BonusesListPage = lazyWithRetry(() => import('../../modules/marketing/bonuses/BonusesListPage'))
const BonusCreatePage = lazyWithRetry(() => import('../../modules/marketing/bonuses/BonusCreatePage'))
const BonusEditPage = lazyWithRetry(() => import('../../modules/marketing/bonuses/BonusEditPage'))
const BonusViewPage = lazyWithRetry(() => import('../../modules/marketing/bonuses/BonusViewPage'))
const CasinoGameBundlesPage = lazyWithRetry(() => import('../../modules/marketing/bundles/CasinoGameBundlesPage'))
const BundleCreateEditPage = lazyWithRetry(() => import('../../modules/marketing/bundles/BundleCreateEditPage'))

// Referrals Module
const ReferralsOverviewPage = lazyWithRetry(() => import('../../modules/marketing/referrals/ReferralsOverviewPage'))
const ReferralProgramEditorPage = lazyWithRetry(() => import('../../modules/marketing/referrals/ProgramEditorPage'))
const ReferralRulesManagementPage = lazyWithRetry(() => import('../../modules/marketing/referrals/RulesManagementPage'))
const ReferralEarningsPage = lazyWithRetry(() => import('../../modules/marketing/referrals/EarningsPage'))
const TopReferrersPage = lazyWithRetry(() => import('../../modules/marketing/referrals/TopReferrersPage'))
const ReferrerStatsPage = lazyWithRetry(() => import('../../modules/marketing/referrals/ReferrerStatsPage'))

// Reporting Module
const ReportingExposurePage = lazyWithRetry(() => import('../../routes/reporting/ExposurePage'))
const ReportingPNLPage = lazyWithRetry(() => import('../../routes/reporting/PNLPage'))
const SportsOverviewReport = lazyWithRetry(() => import('../../routes/reporting/SportsOverviewReport'))
const CasinoOverviewReport = lazyWithRetry(() => import('../../routes/reporting/CasinoOverviewReport'))
const ContributorDetailPage = lazyWithRetry(() => import('../../routes/reporting/ContributorDetailPage'))
const MatkaRiskReport = lazyWithRetry(() => import('../../routes/reporting/MatkaRiskReport'))
const AgentPerformanceReport = lazyWithRetry(() => import('../../routes/reporting/AgentPerformanceReport'))
const PlayerProfitabilityPage = lazyWithRetry(() => import('../../routes/reporting/PlayerProfitabilityPage'))
const PlayerActivityReportPage = lazyWithRetry(() => import('../../routes/reporting/PlayerActivityReportPage'))
const NthDepositWithdrawalReportPage = lazyWithRetry(() => import('../../routes/reporting/NthDepositWithdrawalReportPage'))

// Audit Module
const AuditEventsPage = lazyWithRetry(() => import('../../routes/audit/EventsPage'))
const AuditEventDetailPage = lazyWithRetry(() => import('../../routes/audit/EventDetailPage'))

// Config Module
const WhitelabelsListPage = lazyWithRetry(() => import('../../routes/config/WhitelabelsListPage'))
const WhitelabelWizardPage = lazyWithRetry(() => import('../../routes/config/WhitelabelWizardPage'))
const AppConfigurationPage = lazyWithRetry(() => import('../../routes/config/AppConfigurationPage'))
const AiAssistantSettingsPage = lazyWithRetry(() => import('../../routes/config/AiAssistantSettingsPage'))
const CrmAccessPage = lazyWithRetry(() => import('../../routes/config/CrmAccessPage'))
const CrmUsersPage = lazyWithRetry(() => import('../../routes/config/CrmUsersPage'))
const LiveChatPage = lazyWithRetry(() => import('../../routes/support/LiveChatPage'))
const SportsAdvancedConfigPage = lazyWithRetry(() => import('../../routes/config/SportsAdvancedConfigPage'))
const OtpProvidersPage = lazyWithRetry(() => import('../../routes/config/OtpProvidersPage'))
const AdvertisementsPage = lazyWithRetry(() => import('../../routes/config/AdvertisementsPage'))

// Currency Module
const CurrencyManagementPage = lazyWithRetry(() => import('../../routes/currency/CurrencyManagementPage'))

// Deposits Module
const PaymentMethodsListPage = lazyWithRetry(() => import('../../routes/payments/PaymentMethodsListPage'))
const PaymentMethodCreateEditPage = lazyWithRetry(() => import('../../routes/payments/PaymentMethodCreateEditPage'))
const DepositRequestsPage = lazyWithRetry(() => import('../../routes/payments/DepositRequests'))
const WithdrawalRequestsPage = lazyWithRetry(() => import('../../routes/payments/WithdrawalRequests'))
const PayoutAccountApprovalsPage = lazyWithRetry(() => import('../../routes/payments/PayoutAccountApprovals'))
const PgSettingsPage = lazyWithRetry(() => import('../../routes/payments/PgSettingsPage'))

// VIP Module

const VIPTiersPage = lazyWithRetry(() => import('../../routes/vip/TiersPage.tsx'))
const VIPCreateTierPage = lazyWithRetry(() => import('../../routes/vip/CreateTierPage.tsx'))
const VIPEditTierPage = lazyWithRetry(() => import('../../routes/vip/EditTierPage.tsx'))
const VIPTierDetailPage = lazyWithRetry(() => import('../../routes/vip/TierDetailPage.tsx'))

// Security / RBAC Module
const RolesManagementPage = lazyWithRetry(() => import('../../routes/security/roles/RolesManagementPage'))
const CreateEditRolePage = lazyWithRetry(() => import('../../routes/security/roles/CreateEditRolePage'))
const SupportAdminsPage = lazyWithRetry(() => import('../../routes/security/support-admins/SupportAdminsPage'))

/* What a route shows while its lazy chunk loads. It fills the shell's content column rather than
   reserving a viewport height: the antd Spin this replaced sat inside a `min-h-screen` wrapper, which
   made <main> taller than the area it lives in and scrolled the shell (page migration C, G3). */
const PageLoader: React.FC = () => <LoadingState fill label="Loading page" />

// Route wrapper with suspense
const withSuspense = (Component: React.ComponentType) => (
  <Suspense fallback={<PageLoader />}>
    <Component />
  </Suspense>
)

/** Lightweight guard that blocks agents from admin-only routes */
function AdminOnly({ children }: { children: React.ReactNode }) {
  const isAgent = useAuthStore(s => s.isAgent())
  if (isAgent) return <Navigate to="/agent" replace />
  return <>{children}</>
}

/** Guard that allows only Super Admin role (blocks Admin, Manager, etc.) */
function SuperAdminOnly({ children }: { children: React.ReactNode }) {
  const roles = useAuthStore((s) => s.roles) ?? []
  const isSuperAdmin = roles.some(
    (r) =>
      r === 'Super Admin' ||
      (typeof r === 'string' && r.toLowerCase() === 'super_admin') ||
      (typeof r === 'string' && r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
  )
  if (!isSuperAdmin) return <Navigate to="/overview" replace />
  return <>{children}</>
}

/** Wraps a component with AdminOnly guard + Suspense */
const adminRoute = (Component: React.ComponentType) => (
  <AdminOnly>
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  </AdminOnly>
)

/** Wraps a component with SuperAdminOnly guard + Suspense */
const superAdminRoute = (Component: React.ComponentType) => (
  <SuperAdminOnly>
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  </SuperAdminOnly>
)

function isChunkLoadError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message?.toLowerCase() ?? ''
    return (
      msg.includes('loading chunk') ||
      msg.includes('chunkloaderror') ||
      msg.includes('dynamic import') ||
      msg.includes('failed to fetch dynamically imported module')
    )
  }
  return false
}

const DefaultRouteError: React.FC = () => {
  const error = useRouteError()
  const isChunkError = isChunkLoadError(error)

  if (error != null) {
    console.error('[Admin route error]', error)
  }

  const subTitle = isChunkError
    ? 'The page script failed to load (e.g. after an update or network issue). Refresh to load the latest version.'
    : 'The page failed to load. Try refreshing or returning to the overview.'

  return (
    <div className={routeErrorStyles.screen}>
      <div className={routeErrorStyles.panel} role="alert">
        <span className={routeErrorStyles.tile} aria-hidden="true">
          <IconAlertTriangle size={24} stroke={strokeFor(24)} />
        </span>
        <h1 className={routeErrorStyles.title}>Something went wrong</h1>
        <p className={routeErrorStyles.text}>{subTitle}</p>
        <div className={routeErrorStyles.actions}>
          <Button variant="primary" onClick={() => window.location.reload()}>
            Refresh
          </Button>
          <a className={buttonClassName()} href="/overview">
            Go to Overview
          </a>
        </div>
      </div>
    </div>
  )
}

// Create router configuration (export required by main.tsx; see react-refresh/only-export-components)
/* eslint-disable-next-line react-refresh/only-export-components */
export const router = createBrowserRouter([
  {
    path: ROUTES.LOGIN,
    element: <PublicRegion>{withSuspense(LoginPage)}</PublicRegion>,
    handle: { migrated: true },
  },
  // Agent home dashboard
  {
    path: '/agent',
    element: (
      <RequireAgentAuth>
        <Layout />
      </RequireAgentAuth>
    ),
    errorElement: <LightRegion><DefaultRouteError /></LightRegion>,
    children: [
      {
        index: true,
        element: withSuspense(AgentHome),
        handle: { migrated: true },
      },
      {
        path: 'create',
        element: withSuspense(AgentsCreatePage),
        handle: { migrated: true },
      },
      {
        path: 'credit',
        element: withSuspense(AgentCreditManagementPage),
        handle: { migrated: true },
      },
      {
        path: 'sharing',
        element: <Navigate to="/agent" replace />,
      },
      {
        path: 'commission',
        element: <Navigate to="/commission/overview" replace />,
      },
      {
        path: 'referral',
        element: withSuspense(AgentReferralLinkPage),
        handle: { migrated: true },
      },
    ],
  },
  // Commission routes (for commission agents only)
  {
    path: '/commission',
    element: (
      <RequireAgentAuth>
        <AgentSchemeGuard schemeType="COMMISSION">
          <Layout />
        </AgentSchemeGuard>
      </RequireAgentAuth>
    ),
    errorElement: <LightRegion><DefaultRouteError /></LightRegion>,
    children: [
      {
        path: 'overview',
        element: withSuspense(CommissionDashboard),
        handle: { migrated: true },
      },
      {
        path: 'history',
        element: withSuspense(CommissionHistoryPage),
        handle: { migrated: true },
      },
      {
        path: 'report',
        element: <Navigate to="/reporting/agents/performance" replace />,
      },
    ],
  },
  // Unified Settlement routes (for both agents and admins)
  {
    path: '/settlement',
    element: (
      <RequireAuthOrAgent>
        <Layout />
      </RequireAuthOrAgent>
    ),
    errorElement: <LightRegion><DefaultRouteError /></LightRegion>,
    children: [
      {
        index: true,
        element: withSuspense(UnifiedSettlementPage),
        handle: { migrated: true },
      },
      {
        path: 'overview',
        element: <Navigate to="/settlement" replace />,
      },
      {
        path: 'dashboard',
        element: <Navigate to="/settlement" replace />,
      },
      {
        path: 'ledger',
        element: <Navigate to="/settlement" replace />,
      },
      {
        path: 'history',
        element: <Navigate to="/settlement?tab=history" replace />,
      },
      {
        path: 'report',
        element: <Navigate to="/settlement?tab=breakdown" replace />,
      },
      {
        path: 'reports',
        element: <Navigate to="/settlement?tab=breakdown" replace />,
      },
      {
        path: 'request',
        element: <Navigate to="/settlement?tab=pending" replace />,
      },
    ],
  },
  // ─── Single consolidated layout group for all main routes ─────────────
  // Uses RequireAuthOrAgent (most permissive), admin-only routes use AdminOnly guard
  {
    path: '/',
    element: (
      <RequireAuthOrAgent>
        <Layout />
      </RequireAuthOrAgent>
    ),
    errorElement: <LightRegion><DefaultRouteError /></LightRegion>,
    children: [
      // ═══ Dashboard (admin only) — redirect limited-role admins to first allowed screen ═══
      /* `handle.migrated` is how a route tells the shell its page is built on the kit and follows the
         theme toggle (shell/migratedRoutes.ts). The dashboard is the same component at both paths, so
         both carry it; before this it followed the theme at /overview only. */
      {
        path: '/',
        element: adminRoute(AdminHomeEntry),
        handle: { migrated: true },
      },
      {
        path: ROUTES.OVERVIEW,
        element: adminRoute(AdminHomeEntry),
        handle: { migrated: true },
      },

      // ═══ Shared routes (both admins and agents) ═══

      // Bet List
      {
        path: '/bets',
        element: withSuspense(BetListPage),
        handle: { migrated: true },
      },

      // Bonus cards — whitelabel / admin only (agents redirected by AdminOnly)
      {
        path: '/bonus-awards',
        element: adminRoute(BonusAwardsListPage),
        handle: { migrated: true },
      },

      // Sports — shared
      {
        path: '/sports/events',
        element: withSuspense(SportsEventsPage),
        handle: { migrated: true },
      },
      {
        path: '/sports/event/:eventId',
        element: withSuspense(SportsEventDetailPage),
        handle: { migrated: true },
      },
      {
        path: '/sports/live-analysis',
        element: withSuspense(SportsLiveAnalysisPage),
        handle: { migrated: true },
      },

      // Casino — shared (live analysis)
      {
        path: ROUTES.CASINO_LIVE,
        element: withSuspense(CasinoLiveAnalysisPage),
        handle: { migrated: true },
      },

      // Matka — shared (live analysis)
      {
        path: ROUTES.MATKA_LIVE,
        element: withSuspense(MatkaLiveAnalysisPage),
        handle: { migrated: true },
      },

      // Players
      {
        path: '/players',
        element: <Navigate to={ROUTES.PLAYERS_SEARCH} replace />,
      },
      {
        path: ROUTES.PLAYERS_SEARCH,
        element: withSuspense(PlayersSearchPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.PLAYERS_CREATE,
        element: withSuspense(CreatePlayerPage),
        handle: { migrated: true },
      },
      {
        path: '/players/activity',
        element: <Navigate to="/reporting/players/activity" replace />,
      },
      {
        path: ROUTES.PLAYERS_PROFILE,
        element: withSuspense(PlayerProfilePage),
        handle: { migrated: true },
      },

      // Agents — shared
      {
        path: '/agents',
        element: withSuspense(AgentsSearchPage),
        handle: { migrated: true },
      },
      {
        path: '/agents/create',
        element: withSuspense(AgentsCreatePage),
        handle: { migrated: true },
      },
      {
        path: '/agents/hierarchy',
        element: withSuspense(AgentsHierarchyPage),
        handle: { migrated: true },
      },
      {
        path: '/agents/performance',
        element: <Navigate to="/reporting/agents/performance" replace />,
      },
      {
        path: '/agents/:id',
        element: withSuspense(AgentProfile),
        handle: { migrated: true },
      },

      // Reporting — shared
      {
        path: '/reporting',
        element: <Navigate to={ROUTES.REPORTING_EXPOSURE} replace />,
      },
      {
        path: ROUTES.REPORTING_EXPOSURE,
        element: withSuspense(ReportingExposurePage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.REPORTING_PNL,
        element: withSuspense(ReportingPNLPage),
        handle: { migrated: true },
      },
      {
        path: '/reporting/domain',
        element: <Navigate to="/reporting/sports" replace />,
      },
      {
        path: '/reporting/sports',
        element: (
          <AgentDomainGuard domain="sports">
            {withSuspense(SportsOverviewReport)}
          </AgentDomainGuard>
        ),
        handle: { migrated: true },
      },
      {
        path: '/reporting/casino',
        element: (
          <AgentDomainGuard domain="casino">
            {withSuspense(CasinoOverviewReport)}
          </AgentDomainGuard>
        ),
        handle: { migrated: true },
      },
      // A report contributor (player or agent) in the drilled selection; it replaced the Contributors drawer.
      {
        path: '/reporting/sports/contributors/:kind/:id',
        element: (
          <AgentDomainGuard domain="sports">
            {withSuspense(ContributorDetailPage)}
          </AgentDomainGuard>
        ),
        handle: { migrated: true },
      },
      {
        path: '/reporting/casino/contributors/:kind/:id',
        element: (
          <AgentDomainGuard domain="casino">
            {withSuspense(ContributorDetailPage)}
          </AgentDomainGuard>
        ),
        handle: { migrated: true },
      },
      {
        path: '/reporting/matka',
        element: (
          <AgentDomainGuard domain="matka">
            {withSuspense(MatkaRiskReport)}
          </AgentDomainGuard>
        ),
        handle: { migrated: true },
      },
      {
        path: '/reporting/agents',
        element: <Navigate to="/reporting/agents/performance" replace />,
      },
      {
        path: '/reporting/agent-overview',
        element: withSuspense(AgentOverviewReport),
        handle: { migrated: true },
      },
      {
        path: '/reporting/agents/performance',
        element: withSuspense(AgentPerformanceReport),
        handle: { migrated: true },
      },
      {
        path: '/reporting/agents/commission',
        element: <Navigate to="/reporting/agents/performance" replace />,
      },
      {
        path: '/reporting/players',
        element: <Navigate to="/reporting/players/activity" replace />,
      },
      {
        path: '/reporting/players/activity',
        element: withSuspense(PlayerActivityReportPage),
        handle: { migrated: true },
      },
      {
        path: '/reporting/players/profitability',
        element: withSuspense(PlayerProfitabilityPage),
        handle: { migrated: true },
      },
      {
        path: '/reporting/exports',
        element: withSuspense(ExportsPage),
        handle: { migrated: true },
      },
      {
        path: '/reporting/snapshot-health',
        element: superAdminRoute(SnapshotHealthPage),
        handle: { migrated: true },
      },
      {
        path: '/reporting/players/nth-dw',
        element: withSuspense(NthDepositWithdrawalReportPage),
        handle: { migrated: true },
      },

      // ═══ Admin-only routes (agents redirected) ═══

      // Sports — admin only
      {
        path: ROUTES.SPORTS_BUILDER,
        element: adminRoute(SportsBuilderPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.SPORTS_CONFIGURATION,
        element: adminRoute(SportsConfigurationPage),
        handle: { migrated: true },
      },
      {
        path: '/sports/manual-results',
        element: adminRoute(SportsManualResultsPage),
        handle: { migrated: true },
      },

      // Casino — admin only
      {
        path: ROUTES.CASINO_MANAGEMENT,
        element: adminRoute(CasinoManagementPage),
        handle: { migrated: true },
      },
      {
        path: '/casino/vendors',
        element: adminRoute(VendorManagementPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.CASINO_PROVIDERS,
        element: adminRoute(CasinoProvidersPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.CASINO_CATEGORIES,
        element: adminRoute(CasinoCategoriesPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.CASINO_CATEGORY_ADD_GAMES,
        element: adminRoute(CategoryAddGamesPage),
        handle: { migrated: true },
      },

      // Matka — admin only
      {
        path: '/matka/list',
        element: adminRoute(MatkaManagementPage),
        handle: { migrated: true },
      },
      {
        path: '/matka/management',
        element: adminRoute(MatkaManagementPage),
        handle: { migrated: true },
      },
      {
        path: '/matka/create',
        element: adminRoute(MatkaCreateEditPage),
        handle: { migrated: true },
      },
      {
        path: '/matka/edit/:id',
        element: adminRoute(MatkaCreateEditPage),
        handle: { migrated: true },
      },
      {
        path: '/matka/settings/:id',
        element: adminRoute(MatkaSettingsPage),
        handle: { migrated: true },
      },
      {
        path: '/matka/running',
        element: adminRoute(MatkaRunningMarketsPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.MATKA_RESULTS,
        element: adminRoute(MatkaResultsPage),
        handle: { migrated: true },
      },
      {
        path: '/matka/:id',
        element: adminRoute(MatkaViewPage),
        handle: { migrated: true },
      },
      {
        path: '/matka/worli/running',
        element: <Navigate to="/matka/worli" replace />,
      },
      {
        path: '/matka/worli',
        element: adminRoute(WorliRunningMarketsPage),
        handle: { migrated: true },
      },
      {
        path: '/matka/worli/:id',
        element: adminRoute(WorliRunningMarketDetailPage),
        handle: { migrated: true },
      },

      // Agents — edit: admins edit any agent; an agent edits its sub-agents only (EditPage refuses self).
      {
        path: '/agents/:id/edit',
        element: withSuspense(AgentsEditPage),
        handle: { migrated: true },
      },

      // Promotions
      {
        path: ROUTES.PROMOTIONS_CAMPAIGNS,
        element: adminRoute(PromotionsCampaignsPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.PROMOTIONS_CONTENT,
        element: adminRoute(PromotionsContentPage),
        handle: { migrated: true },
      },

      // Bonuses
      {
        path: ROUTES.BONUSES_LIST,
        element: adminRoute(BonusesListPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.BONUSES_NEW,
        element: adminRoute(BonusCreatePage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.BONUSES_EDIT,
        element: adminRoute(BonusEditPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.BONUSES_VIEW,
        element: adminRoute(BonusViewPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.BONUSES_BUNDLES,
        element: adminRoute(CasinoGameBundlesPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.BONUSES_BUNDLES_NEW,
        element: adminRoute(BundleCreateEditPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.BONUSES_BUNDLES_EDIT,
        element: adminRoute(BundleCreateEditPage),
        handle: { migrated: true },
      },

      // Referrals
      {
        path: ROUTES.REFERRALS_OVERVIEW,
        element: adminRoute(ReferralsOverviewPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.REFERRALS_PROGRAM,
        element: adminRoute(ReferralProgramEditorPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.REFERRALS_RULES,
        element: adminRoute(ReferralRulesManagementPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.REFERRALS_EARNINGS,
        element: adminRoute(ReferralEarningsPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.REFERRALS_TOP_REFERRERS,
        element: adminRoute(TopReferrersPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.REFERRALS_REFERRER_STATS,
        element: adminRoute(ReferrerStatsPage),
        handle: { migrated: true },
      },

      // Audit
      {
        path: '/audit',
        element: <Navigate to={ROUTES.AUDIT_EVENTS} replace />,
      },
      {
        path: ROUTES.AUDIT_EVENTS,
        element: adminRoute(AuditEventsPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.AUDIT_EVENT_DETAIL,
        element: adminRoute(AuditEventDetailPage),
        handle: { migrated: true },
      },

      // Notifications
      {
        path: '/notifications',
        element: adminRoute(NotificationsPage),
        handle: { migrated: true },
      },
      {
        path: '/notifications/:id',
        element: adminRoute(NotificationDetailPage),
        handle: { migrated: true },
      },
      {
        path: '/notifications/tasks/:id',
        element: adminRoute(TaskDetailPage),
        handle: { migrated: true },
      },

      // Config
      { path: '/support/live-chat', element: adminRoute(LiveChatPage), handle: { migrated: true } },
      {
        path: '/config/app-configuration',
        element: adminRoute(AppConfigurationPage),
        handle: { migrated: true },
      },
      {
        // Super Admin owns assistant access; the resolver refuses anyone else.
        path: '/config/ai-assistant',
        element: adminRoute(AiAssistantSettingsPage),
        handle: { migrated: true },
      },
      {
        // Super Admin owns CRM access; the resolver refuses anyone else.
        path: '/config/crm-access',
        element: adminRoute(CrmAccessPage),
        handle: { migrated: true },
      },
      {
        // A whitelabel administrator manages their own CRM logins here; a Super
        // Admin may pick any whitelabel. The resolvers refuse everyone else.
        path: '/config/crm-users',
        element: adminRoute(CrmUsersPage),
        handle: { migrated: true },
      },
      {
        path: '/config/sports-advanced',
        element: adminRoute(SportsAdvancedConfigPage),
        handle: { migrated: true },
      },
      {
        path: '/config/whitelabels',
        element: adminRoute(WhitelabelsListPage),
        handle: { migrated: true },
      },
      {
        path: '/config/whitelabels/create',
        element: adminRoute(WhitelabelWizardPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.CONFIG_OTP_PROVIDERS,
        element: adminRoute(OtpProvidersPage),
        handle: { migrated: true },
      },
      {
        path: '/config/advertisements',
        element: adminRoute(AdvertisementsPage),
        handle: { migrated: true },
      },

      // Payments
      {
        path: '/payments/methods',
        element: adminRoute(PaymentMethodsListPage),
        handle: { migrated: true },
      },
      {
        path: '/payments/methods/create',
        element: adminRoute(PaymentMethodCreateEditPage),
        handle: { migrated: true },
      },
      {
        path: '/payments/methods/edit/:type/:id',
        element: adminRoute(PaymentMethodCreateEditPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.PAYMENTS_WITHDRAWALS,
        element: adminRoute(WithdrawalRequestsPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.PAYMENTS_PAYOUT_APPROVALS,
        element: adminRoute(PayoutAccountApprovalsPage),
        handle: { migrated: true },
      },
      {
        path: '/payments/deposits',
        element: adminRoute(DepositRequestsPage),
        handle: { migrated: true },
      },
      {
        path: '/payments/pg-settings',
        element: adminRoute(PgSettingsPage),
        handle: { migrated: true },
      },

      // Credit Management (whitelabel admins)
      {
        path: '/credit',
        element: adminRoute(CreditManagementPage),
        handle: { migrated: true },
      },

      // Currency
      {
        path: ROUTES.CURRENCY_MANAGEMENT,
        element: adminRoute(CurrencyManagementPage),
        handle: { migrated: true },
      },

      // VIP
      {
        path: '/vip',
        element: <Navigate to="/vip/tiers" replace />,
      },
      {
        path: '/vip/tiers',
        element: adminRoute(VIPTiersPage),
        handle: { migrated: true },
      },
      {
        path: '/vip/tiers/create',
        element: adminRoute(VIPCreateTierPage),
        handle: { migrated: true },
      },
      {
        path: '/vip/tiers/:id/edit',
        element: adminRoute(VIPEditTierPage),
        handle: { migrated: true },
      },
      {
        path: '/vip/tiers/:id',
        element: adminRoute(VIPTierDetailPage),
        handle: { migrated: true },
      },

      // Security / RBAC
      {
        path: ROUTES.SECURITY_ROLES,
        element: adminRoute(RolesManagementPage),
        handle: { migrated: true },
      },
      {
        path: ROUTES.SECURITY_ROLES_CREATE,
        element: adminRoute(CreateEditRolePage),
        handle: { migrated: true },
      },
      {
        path: '/security/roles/:id/edit',
        element: adminRoute(CreateEditRolePage),
        handle: { migrated: true },
      },
      {
        path: '/security/support-admins',
        element: adminRoute(SupportAdminsPage),
        handle: { migrated: true },
      },

    ],
  },
])

// Router provider component
export const AppRouter: React.FC = () => {
  return <RouterProvider router={router} />
}
