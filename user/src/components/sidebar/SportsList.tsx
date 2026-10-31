import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Circle, CircleDot, Dribbble, Flag, Trophy } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getSportsList, type SportApiItem } from "@/lib/api/user";
import { formatStart } from "../sports/utils";
import { ALL_SPORTS_SIDEBAR } from "../sports/allSportsList";

export type Nav = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  key?: string;
};

type Props = {
  items: Nav[];
  initialActive: string;
};

type ApiLeague = NonNullable<SportApiItem["leagues"]>[number];
type ApiEvent = NonNullable<ApiLeague["events"]>[number];

const PRIORITY_SPORTS = ["cricket", "football", "tennis", "basketball", "horseracing"] as const;
const SPORT_TRANSLATIONS: Partial<Record<(typeof PRIORITY_SPORTS)[number], string>> = {
  cricket: "nova.cricket",
  football: "nova.football",
  tennis: "nova.tennis",
  basketball: "nova.basketball",
  horseracing: "nova.horseRacing",
};
const SPORT_ICONS = {
  cricket: Trophy,
  football: CircleDot,
  tennis: Circle,
  basketball: Dribbble,
  horseracing: Flag,
} as const;

function normalizeSportKey(value?: string) {
  const normalized = (value || "")
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized === "soccer") return "football";
  if (normalized === "horse-racing" || normalized === "horse racing") return "horseracing";
  return normalized;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\s+(?:vs?|versus)\s+/g, "-v-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "match";
}

function eventName(event: ApiEvent) {
  return String(event.name || event.slugName || "").trim();
}

function eventUrl(event: ApiEvent) {
  const id = String(event.id || "").trim();
  const path = `/sports/event/${slugify(eventName(event))}`;
  return id ? `${path}?id=${encodeURIComponent(id)}` : path;
}

function isLive(event: ApiEvent) {
  return Boolean(event.markets?.some(market => market.inplay));
}

export default function SportsList(_props: Props) {
  const [sportsData, setSportsData] = useState<SportApiItem[] | null>(null);
  const [sportsError, setSportsError] = useState(false);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const selectedSport = pathname === "/sports" || pathname.startsWith("/sports/")
    ? normalizeSportKey(new URLSearchParams(search).get("sport") || "")
    : "";

  const prioritySports = useMemo(
    () => ALL_SPORTS_SIDEBAR.filter(sport =>
      PRIORITY_SPORTS.includes(sport.key as (typeof PRIORITY_SPORTS)[number]),
    ),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void getSportsList()
      .then(response => {
        if (cancelled) return;
        const code = response?.meta?.code;
        if ((code !== undefined && (code < 200 || code >= 300)) || !Array.isArray(response?.data)) {
          throw new Error("Sports navigation request failed");
        }
        setSportsData(response.data);
        setSportsError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSportsData([]);
        setSportsError(true);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="nova-sports-tree" aria-busy={sportsData === null}>
      {prioritySports.map(sport => {
        const sportKey = normalizeSportKey(sport.key);
        const labelKey = SPORT_TRANSLATIONS[sportKey as keyof typeof SPORT_TRANSLATIONS];
        const label = labelKey ? t(labelKey) : sport.label;
        const Icon = SPORT_ICONS[sportKey as keyof typeof SPORT_ICONS] || sport.icon || Trophy;
        const sportDetail = (sportsData || []).find(item =>
          normalizeSportKey(item.slugName || item.name) === sportKey,
        );
        const leagues = (sportDetail?.leagues || []).filter(league => {
          const name = String(league.name || league.slugName || "").trim();
          return Boolean(name) && (league.events || []).some(event => Boolean(eventName(event)));
        });
        const eventCount = leagues.reduce(
          (sum, league) => sum + (league.events || []).filter(event => Boolean(eventName(event))).length,
          0,
        );
        const selected = selectedSport === sportKey;

        return (
          <details key={sport.key} className="nova-sport-branch" open={selected}>
            <summary
              className={selected ? "active" : undefined}
              aria-current={selected ? "page" : undefined}
              onClick={() => {
                if (!selected) navigate(`/sports?sport=${encodeURIComponent(sportKey)}`);
              }}
            >
              <Icon className="nova-sport-icon" />
              <span>{label}</span>
              <small className="nova-sport-count">{sportsData === null || sportsError ? "—" : eventCount}</small>
              <ChevronRight className="nova-branch-chevron" aria-hidden="true" />
            </summary>

            <div className="nova-sport-children">
              <Link className="nova-all-markets-link" to={`/sports?sport=${encodeURIComponent(sportKey)}`}>
                <span>{t("nova.allSportMarkets", { sport: label })}</span>
                <ChevronRight aria-hidden="true" />
              </Link>

              {leagues.slice(0, 4).map(league => {
                const leagueName = String(league.name || league.slugName || "").trim();
                const events = (league.events || []).filter(event => Boolean(eventName(event)));
                const leagueUrl = `/sports?sport=${encodeURIComponent(sportKey)}&league=${encodeURIComponent(leagueName)}`;
                return (
                  <details key={league.id || leagueName} className="nova-league-branch">
                    <summary>
                      <span>{leagueName}</span>
                      <small>{events.length}</small>
                      <ChevronRight className="nova-branch-chevron" aria-hidden="true" />
                    </summary>
                    <div className="nova-league-events">
                      {events.slice(0, 3).map((event, index) => {
                        const name = eventName(event);
                        const start = event.date ? formatStart(String(event.date)) : null;
                        return (
                          <Link key={event.id || `${name}-${index}`} to={eventUrl(event)}>
                            <span>{name}</span>
                            <small className={isLive(event) ? "live" : undefined}>
                              {isLive(event) ? t("nova.inPlay") : start ? `${start.dayMon} · ${start.time}` : ""}
                            </small>
                          </Link>
                        );
                      })}
                      <Link className="nova-view-league" to={leagueUrl}>
                        {t("nova.viewLeague")} <ChevronRight aria-hidden="true" />
                      </Link>
                    </div>
                  </details>
                );
              })}

              {leagues.length === 0 && (
                <p className="nova-sport-state" role={sportsError ? "alert" : "status"}>
                  {sportsData === null
                    ? t("nova.loadingEvents")
                    : sportsError
                      ? t("nova.eventLoadError")
                      : t("nova.noUpcoming")}
                </p>
              )}
            </div>
          </details>
        );
      })}

      <Link className="nova-all-sports-link" to="/sports">
        <span>{t("nova.allSports")}</span>
        <ChevronRight aria-hidden="true" />
      </Link>
    </div>
  );
}
