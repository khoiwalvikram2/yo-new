import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Result, Spin } from 'antd'
import { useAuth, can } from '@/state/auth'
import { landingPath } from '@/app/navigation'
import { AppShell } from '@/components/AppShell'
import { LoginPage } from '@/routes/LoginPage'

// Split per route: an agent who only ever opens players should not download the
// role editor.
const PlayersPage = lazy(() => import('@/routes/PlayersPage').then((m) => ({ default: m.PlayersPage })))
const PlayerDetailPage = lazy(() => import('@/routes/PlayerDetailPage').then((m) => ({ default: m.PlayerDetailPage })))
const BooksPage = lazy(() => import('@/routes/BooksPage').then((m) => ({ default: m.BooksPage })))
const UsersPage = lazy(() => import('@/routes/UsersPage').then((m) => ({ default: m.UsersPage })))
const RolesPage = lazy(() => import('@/routes/RolesPage').then((m) => ({ default: m.RolesPage })))
const SecurityPage = lazy(() => import('@/routes/SecurityPage').then((m) => ({ default: m.SecurityPage })))
const QueuePage = lazy(() => import('@/routes/QueuePage').then((m) => ({ default: m.QueuePage })))
const DeskHealthPage = lazy(() => import('@/routes/DeskHealthPage').then((m) => ({ default: m.DeskHealthPage })))
const DeskSettingsPage = lazy(() =>
  import('@/routes/DeskSettingsPage').then((m) => ({ default: m.DeskSettingsPage }))
)
const ReportsPage = lazy(() => import('@/routes/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const TagsPage = lazy(() => import('@/routes/TagsPage').then((m) => ({ default: m.TagsPage })))
const LiveChatPage = lazy(() => import('@/routes/LiveChatPage').then((m) => ({ default: m.LiveChatPage })))
const PasswordPage = lazy(() => import('@/routes/PasswordPage').then((m) => ({ default: m.PasswordPage })))

const Loading = () => (
  <div style={{ display: 'grid', placeItems: 'center', minHeight: 240 }}>
    <Spin />
  </div>
)

/**
 * Guards a route on a permission.
 *
 * This keeps a user out of a screen that would only show them errors. It is not
 * the protection — the server refuses the operation regardless — so a missing
 * guard here is a poor experience, not a way in.
 *
 * Refusals land on the first screen the user can actually open rather than on a
 * hardcoded `/players`: that path is itself gated, and sending someone to a
 * screen they were about to be refused is how a redirect loop starts.
 */
function Guarded({ domain, action, children }: { domain: string; action: string; children: React.ReactNode }) {
  const me = useAuth((s) => s.me)
  const home = landingPath(me)
  if (!can(me, domain, action)) {
    return home ? <Navigate to={home} replace /> : <NoScreens />
  }
  return <>{children}</>
}

/**
 * An account whose role grants no screen at all.
 *
 * Rare, but reachable: every screen's permission is grantable, so a role can be
 * saved with none of them. Saying so plainly beats an empty shell or a redirect
 * that never settles.
 */
function NoScreens() {
  return (
    <Result
      status="info"
      title="No screens available"
      subTitle="Your role does not include access to any CRM screen yet. Ask an administrator to grant one."
    />
  )
}

/** Sends the user to their own landing screen instead of a fixed path. */
function Home() {
  const me = useAuth((s) => s.me)
  const home = landingPath(me)
  return home ? <Navigate to={home} replace /> : <NoScreens />
}

export function AppRouter() {
  const token = useAuth((s) => s.token)
  const me = useAuth((s) => s.me)

  if (!token) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  // A user handed a password by an administrator changes it before they can do
  // anything else — otherwise the credential that was typed into a chat window
  // stays valid indefinitely.
  if (me?.requirePasswordReset) {
    return (
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="*" element={<PasswordPage forced />} />
        </Routes>
      </Suspense>
    )
  }

  return (
    <AppShell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route
            path="/players"
            element={
              <Guarded domain="crm.players" action="view">
                <PlayersPage />
              </Guarded>
            }
          />
          <Route
            path="/players/:id"
            element={
              <Guarded domain="crm.players" action="view">
                <PlayerDetailPage />
              </Guarded>
            }
          />
          <Route
            path="/queue"
            element={
              <Guarded domain="crm.tasks" action="view">
                <QueuePage />
              </Guarded>
            }
          />
          <Route
            path="/desk-health"
            element={
              <Guarded domain="crm.tasks" action="view">
                <DeskHealthPage />
              </Guarded>
            }
          />
          <Route
            path="/reports"
            element={
              <Guarded domain="crm.reports" action="view">
                <ReportsPage />
              </Guarded>
            }
          />
          <Route
            path="/desk-settings"
            element={
              <Guarded domain="crm.settings" action="view">
                <DeskSettingsPage />
              </Guarded>
            }
          />
          <Route
            path="/tags"
            element={
              <Guarded domain="crm.tags" action="apply">
                <TagsPage />
              </Guarded>
            }
          />
          <Route
            path="/books"
            element={
              <Guarded domain="crm.books" action="view">
                <BooksPage />
              </Guarded>
            }
          />
          <Route
            path="/users"
            element={
              <Guarded domain="crm.users" action="view">
                <UsersPage />
              </Guarded>
            }
          />
          <Route
            path="/roles"
            element={
              <Guarded domain="crm.roles" action="view">
                <RolesPage />
              </Guarded>
            }
          />
          <Route
            path="/security"
            element={
              <Guarded domain="crm.security" action="view">
                <SecurityPage />
              </Guarded>
            }
          />
          <Route path="/password" element={<PasswordPage />} />
          <Route path="/live-chat" element={<Guarded domain="crm.chat" action="view"><LiveChatPage /></Guarded>} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Suspense>
    </AppShell>
  )
}
