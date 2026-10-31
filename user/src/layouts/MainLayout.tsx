import { Suspense, lazy } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Topbar from "../components/Topbar";
import Sidebar from "../components/Sidebar";
import Footer from "../components/Footer.tsx";
import MobileTabBar from "../components/MobileTabBar";
import RouteFallback from "../components/RouteFallback";
import { NovaUtilityRail } from "../components/nova/NovaWorkspace";
import { useTranslation } from "react-i18next";

/** Account and info pages share the matchbook account styling (styles/nova-account.css). */
const ACCOUNT_PATHS = ["/deposit", "/withdrawal", "/statements", "/my-bets", "/bonus", "/referral", "/vip", "/settings", "/terms", "/privacy"];
const PlayerSupportChat = lazy(() => import('../components/PlayerSupportChat'));

export default function MainLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isAccountPage = ACCOUNT_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`));
  return (
    <div className="nova-shell nova-shell-minimal nova-shell-matchbook min-h-screen text-[color:var(--text)]" data-ui-radius="square">
      <a href="#main-content" className="nova-skip-link">{t('nova.skipToContent')}</a>
      <Topbar />
      <Sidebar />

      <div className="nova-workspace flex-1 flex flex-col min-w-0" data-ui-radius="square">
        <main
          id="main-content"
          data-ui-radius="square"
          tabIndex={-1}
          className={`nova-content${isAccountPage ? " nova-acct" : ""} flex-1 min-w-0 space-y-6 mx-auto w-full`}
        >
          {/* Route components are lazy chunks; hold the layout steady while one loads. */}
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>

        <Footer />
        <MobileTabBar />
      </div>
      <NovaUtilityRail />
      <Suspense fallback={null}><PlayerSupportChat /></Suspense>
    </div>
  );
}
