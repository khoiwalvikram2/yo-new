import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/nova.css'
import './styles/panel-refresh.css'
import './styles/matchbook-tokens.css'
import './styles/nova-account.css'
import './styles/nova-modals.css'
import './styles/page-headings.css'
import App from './App.tsx'
import { BetSlipProvider } from './components/sports'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import HomePage from './pages/Home.tsx'
import MainLayout from './layouts/MainLayout.tsx'
import { applyThemeAtStartup } from './lib/theme'
import ErrorPage from './pages/ErrorPage.tsx'
import NotFound from './pages/NotFound.tsx'
import RequireAuth from './lib/RequireAuth'
import RequireFeature from './lib/RequireFeature'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import i18n from './lib/i18n'

// Route-level code splitting: each page ships as its own chunk so a visitor
// downloads only the route they open, not all 21 pages up front.
const MatkaPage = lazy(() => import('./pages/Matka.tsx'))
const CasinoPage = lazy(() => import('./pages/Casino.tsx'))
const SportsPage = lazy(() => import('./pages/Sports.tsx'))
const SlotsPage = lazy(() => import('./pages/Slots.tsx'))
const SportsEventPage = lazy(() => import('./pages/SportsEvent.tsx'))
const SettingsPage = lazy(() => import('./pages/Settings.tsx'))
const StatementsPage = lazy(() => import('./pages/Statements.tsx'))
const BonusPage = lazy(() => import('./pages/Bonus.tsx'))
const VipPage = lazy(() => import('./pages/Vip.tsx'))
const DepositPage = lazy(() => import('./pages/Deposit.tsx'))
const WithdrawalPage = lazy(() => import('./pages/Withdrawal.tsx'))
const ReferralPage = lazy(() => import('./pages/Referral.tsx'))
const TermsPage = lazy(() => import('./pages/Terms.tsx'))
const PrivacyPage = lazy(() => import('./pages/Privacy.tsx'))
const ReferralRedirect = lazy(() => import('./pages/ReferralRedirect.tsx'))
const MyBetsPage = lazy(() => import('./pages/MyBets.tsx'))
// Development builds only: in production the import is dead code, so the previews never reach the bundle.
const HomeDesignsPage = import.meta.env.DEV ? lazy(() => import('./pages/HomeDesigns.tsx')) : null

applyThemeAtStartup()
const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    errorElement: <ErrorPage />,
    children: [
      // Referral redirect route (outside MainLayout for cleaner redirect)
      {
        path: 'r',
        // Rendered outside MainLayout, so it needs its own Suspense boundary.
        element: (
          <Suspense fallback={null}>
            <ReferralRedirect />
          </Suspense>
        ),
      },
      {
        element: <MainLayout />,
        errorElement: <ErrorPage />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'matka/*', element: <RequireFeature feature="matkaEnabled"><MatkaPage /></RequireFeature> },
          { 
            path: 'casino', 
            element: (
              <RequireFeature feature="casinoEnabled">
                <CasinoPage />
              </RequireFeature>
            )
          },
          { 
            path: 'sports', 
            element: (
              <RequireFeature feature="sportsEnabled">
                <SportsPage />
              </RequireFeature>
            )
          },
          { 
            path: 'slots', 
            element: (
              <RequireFeature feature="casinoEnabled">
                <SlotsPage />
              </RequireFeature>
            )
          },
          { 
            path: 'sports/event/:eventId', 
            element: (
              <RequireFeature feature="sportsEnabled">
                <SportsEventPage />
              </RequireFeature>
            )
          },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'statements', element: <RequireAuth><StatementsPage /></RequireAuth> },
          { 
            path: 'my-bets', 
            element: (
              <RequireAuth>
                <MyBetsPage />
              </RequireAuth>
            )
          },
          { 
            path: 'bonus', 
            element: (
              <RequireAuth>
                <RequireFeature feature="bonusesEnabled">
                  <BonusPage />
                </RequireFeature>
              </RequireAuth>
            )
          },
          { path: 'vip', element: <RequireAuth><VipPage /></RequireAuth> },
          {
            path: 'referral',
            element: (
              <RequireAuth>
                <RequireFeature feature="referralsEnabled">
                  <ReferralPage />
                </RequireFeature>
              </RequireAuth>
            ),
          },
          { path: 'deposit', element: <RequireAuth><DepositPage /></RequireAuth> },
          { path: 'withdrawal', element: <RequireAuth><WithdrawalPage /></RequireAuth> },
          { path: 'terms', element: <TermsPage /> },
          { path: 'privacy', element: <PrivacyPage /> },
          // Home page design previews on sample data (owner, 2026-10-30): development builds only, so players
          // never meet the sample odds; production has no such route.
          ...(HomeDesignsPage ? [{ path: 'home-designs', element: <HomeDesignsPage /> }] : []),
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <BetSlipProvider>
          <RouterProvider router={router} />
        </BetSlipProvider>
      </QueryClientProvider>
    </I18nextProvider>
  </StrictMode>,
)
