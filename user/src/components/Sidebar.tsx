import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { LanguageCode } from "@/types";
import { getLanguageFromStorage } from "@/lib/locale";
import { ChevronDown } from "lucide-react";
import { useFeatureFlags, useParsedSettings, useSportsIconStyle } from "../hooks/useAppSettings";
import { sportIcon as styledIcon, sportIconClass } from "./nova/exchange-home/exchangeShared";
import { useTranslation } from "react-i18next";
import SidebarFooter from "./sidebar/SidebarFooter";
import { languages } from "./sidebar/localeData";
import { ALL_SPORTS_SIDEBAR } from "./sports/allSportsList";
import { getPopularNavigation } from './sidebar/popularNavigation';
import "./sidebar/matchbook-sidebar.css";

/** Matchbook naming: the exchange calls football "Soccer". */
const sportLabel = (key: string, label: string) => (key === "football" ? "Soccer" : label);
const ALL_SPORTS_AZ = [...ALL_SPORTS_SIDEBAR].sort((a, b) => sportLabel(a.key, a.label).localeCompare(sportLabel(b.key, b.label)));

function SideLink({ to, active, icon, children }: { to: string; active: boolean; icon: ReactNode; children: ReactNode }) {
  return <Link to={to} className={`nova-mb-side-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
    <span className="nova-mb-side-icon" aria-hidden="true">{icon}</span><span className="nova-mb-side-text">{children}</span>
  </Link>;
}

/** Matchbook's footer clock: "13:13 | 15 Oct 2026" in the platform time zone. */
function SidebarClock({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: number | undefined;
    // Tick on the minute boundary so the display never lags by up to a minute.
    const timeout = window.setTimeout(() => {
      setNow(new Date());
      interval = window.setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => { window.clearTimeout(timeout); window.clearInterval(interval); };
  }, []);
  let time: string;
  let date: string;
  try {
    time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
    date = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone });
  } catch {
    time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
    date = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }
  return <div className="nova-mb-side-clock"><time dateTime={now.toISOString()}>{time}</time><span aria-hidden="true">|</span><span>{date}</span></div>;
}

export default function Sidebar() {
  const [selectedLanguage] = useState<LanguageCode>(getLanguageFromStorage());
  const features = useFeatureFlags();
  const settings = useParsedSettings();
  const { pathname, search } = useLocation();
  const { t } = useTranslation();
  const selectedSport = pathname === "/sports" ? new URLSearchParams(search).get("sport") : null;
  const sportListed = ALL_SPORTS_SIDEBAR.some(sport => sport.key === selectedSport);

  const scroller = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  const syncMore = useCallback(() => {
    const el = scroller.current;
    if (el) setMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  }, []);
  useEffect(() => {
    syncMore();
    window.addEventListener("resize", syncMore);
    return () => window.removeEventListener("resize", syncMore);
  }, [syncMore, features.sportsEnabled, features.casinoEnabled, features.matkaEnabled]);
  const scrollMore = () => scroller.current?.scrollBy({
    top: scroller.current.clientHeight * 0.7,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });

  const iconStyle = useSportsIconStyle();
  // The colourful set when the whitelabel chose one, else the list's own single-colour image.
  const sportIcon = (key: string, src?: string) => {
    const colorful = sportIconClass(key, iconStyle);
    const image = colorful ? styledIcon(key, iconStyle) : src;
    return image ? <img src={image} alt="" className={colorful} /> : null;
  };

  return (
    <aside className="nova-sidebar nova-mb-sidebar hidden min-[801px]:flex flex-col shrink-0 overflow-hidden" aria-label={t("nova.sidebarNavigation")} data-ui-radius="square">
      <div className="nova-mb-side-scroll" ref={scroller} onScroll={syncMore}>
        {/* Popular is the product links, once in the header (moved here by the owner 2026-10-29; the popular sports
            and In-Play Betting were dropped from it the same day). Sports is selected wherever no All Sports link is. */}
        <nav className="nova-mb-side-section" aria-labelledby="nova-mb-popular">
          <h2 id="nova-mb-popular" className="nova-mb-side-heading">{t("sidebar.popular", { defaultValue: "Popular" })}</h2>
          {getPopularNavigation(features).map(item => {
            const Icon = item.icon;
            const active = item.key === 'home' ? pathname === '/' : item.key === 'sports'
              ? pathname.startsWith('/sports') && !sportListed
              : pathname.startsWith(item.to);
            return <SideLink key={item.key} to={item.to} active={active} icon={<Icon />}>{t(item.labelKey, { defaultValue: item.defaultLabel })}</SideLink>;
          })}
        </nav>

        {features.sportsEnabled && <>
          <nav className="nova-mb-side-section" aria-labelledby="nova-mb-all-sports">
            <h2 id="nova-mb-all-sports" className="nova-mb-side-heading">{t("sidebar.allSports", { defaultValue: "All Sports" })}</h2>
            {ALL_SPORTS_AZ.map(sport => (
              <SideLink key={sport.key} to={`/sports?sport=${sport.key}`} active={selectedSport === sport.key} icon={sportIcon(sport.key, sport.imageSrc)}>
                {sportLabel(sport.key, sport.label)}
              </SideLink>
            ))}
          </nav>
        </>}

        {/* The Matka, Casino and Help sections were removed by the owner (2026-10-29). Their pages stay reachable:
            Matka entries from the Matka page, Bonus from the header, account menu and footer, Play controls from the
            account menu, footer and right rail, Help & support from the right rail. */}
      </div>

      <div className="nova-mb-side-bottom">
        {moreBelow && (
          <button type="button" className="nova-mb-side-more" onClick={scrollMore} aria-label={t("sidebar.showMore", { defaultValue: "Show more" })}>
            <ChevronDown aria-hidden="true" />
          </button>
        )}
        <SidebarFooter
          languages={languages}
          initialLanguage={selectedLanguage}
          baseCurrency={settings.baseCurrency}
          timeZone={settings.timeZone}
        />
        <SidebarClock timeZone={settings.timeZone || "Asia/Kolkata"} />
      </div>
    </aside>
  );
}
