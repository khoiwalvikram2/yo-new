import { useState, useRef, useEffect } from "react";
import { ArrowLeft, Bookmark, ChevronDown, Clock, TrendingUp } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import ConfettiBurst from "../animations/ConfettiBurst";
import { generateEventId } from "@/lib/sportsHelpers";
import { normalizeSportKey } from "@/components/sports/useSportsEventsData";
import { istClock, sportIcon, sportIconClass, sportTitle, useDayLabel } from "@/components/nova/exchange-home/exchangeShared";
import { useSportsIconStyle } from "@/hooks/useAppSettings";
import { LivePulse } from "@/components/nova/exchange-home/LivePulse";
import type { EventDetails } from "./types";
import "./nova-sports-event.css";

export interface LeagueEventItem {
  id: string;
  name: string;
}

interface EventHeaderProps {
  event: EventDetails;
  bookmarked: boolean;
  onBookmark: () => void;
  status?: EventDetails["status"];
  onOpenAnalytics?: () => void;
  timeRemaining?: string;
  leagueEvents?: LeagueEventItem[];
}

/**
 * Matchbook event bar: back, sport, teams and competition on the dark bar with live state, analytics
 * and bookmark; the strip below switches between the league's events and shows the countdown and start.
 */
export default function EventHeader({
  event,
  bookmarked,
  onBookmark,
  status = "upcoming",
  onOpenAnalytics,
  timeRemaining = "00:00:00",
  leagueEvents = [],
}: EventHeaderProps) {
  const navigate = useNavigate();
  const dayLabel = useDayLabel();
  const [switchOpen, setSwitchOpen] = useState(false);
  const switchRef = useRef<HTMLDivElement>(null);
  const isLive = status === "live";
  const start = new Date(event.startTime || "");
  const hasStart = !isNaN(start.getTime());
  const [hh, mm, ss] = (timeRemaining || "00:00:00").split(":");
  const sport = normalizeSportKey(String(event.sportName ?? ""));
  const iconStyle = useSportsIconStyle();
  const icon = sport ? sportIcon(sport, iconStyle) : undefined;
  const competition = [sport ? sportTitle(sport) : "", event.league].filter(Boolean).join(" · ");

  useEffect(() => {
    if (!switchOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (switchRef.current && !switchRef.current.contains(e.target as Node)) setSwitchOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSwitchOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [switchOpen]);

  return (
    <header className="nova-ev-head" data-page-header="title-only">
      <div className="nova-ev-head-main">
        <button type="button" onClick={() => navigate(-1)} className="nova-ev-icon-btn" aria-label="Go back">
          <ArrowLeft aria-hidden="true" />
        </button>
        <div className="nova-ev-title">
          <h1>{event.homeTeam.name} <em>v</em> {event.awayTeam.name}</h1>
        </div>
        <div className="nova-ev-head-actions">
          {isLive && <span className="nova-ev-live"><i aria-hidden="true" />Live<LivePulse /></span>}
          {onOpenAnalytics && (
            <button type="button" onClick={onOpenAnalytics} className="nova-ev-btn" title="Analytics">
              <TrendingUp aria-hidden="true" />
              <span>Analytics</span>
            </button>
          )}
          <button
            type="button"
            onClick={onBookmark}
            className={`nova-ev-icon-btn nova-ev-bookmark${bookmarked ? " is-active" : ""}`}
            aria-pressed={bookmarked}
            aria-label={bookmarked ? "Remove bookmark" : "Bookmark"}
          >
            <Bookmark aria-hidden="true" style={bookmarked ? { animation: "heart-burst 180ms ease" } : undefined} />
            {bookmarked && <ConfettiBurst className="absolute inset-0" particleCount={5} durationMs={450} spread={14} />}
          </button>
        </div>
      </div>

      <div className="nova-ev-head-sub">
        {icon && <span className="nova-ev-sport-tile"><img className={sportIconClass(sport ?? "", iconStyle, "nova-ev-sport")} src={icon} alt="" /></span>}
        {competition && <span className="nova-ev-competition" title={competition} data-page-meta="">{competition}</span>}
        <div className="nova-ev-switch" ref={switchRef}>
          <button type="button" aria-expanded={switchOpen} aria-controls="nova-ev-switch-menu" onClick={() => setSwitchOpen((open) => !open)}>
            <span>Switch Event</span>
            <ChevronDown aria-hidden="true" />
          </button>
          {switchOpen && (
            <div id="nova-ev-switch-menu" className="nova-ev-switch-menu">
              {leagueEvents.length > 0 ? leagueEvents.map((ev) => {
                const isCurrent = ev.id === event.id || ev.id === event.eventId;
                return (
                  <Link
                    key={ev.id}
                    to={`/sports/event/${generateEventId(ev.name)}?id=${encodeURIComponent(ev.id)}`}
                    aria-current={isCurrent ? "page" : undefined}
                    onClick={() => setSwitchOpen(false)}
                  >
                    {ev.name}
                  </Link>
                );
              }) : <p className="nova-ev-switch-empty">No other events in this league</p>}
            </div>
          )}
        </div>
        {status === "upcoming" && (
          <span className="nova-ev-countdown"><span>Starts in</span><strong><b>{hh}</b>:<b>{mm}</b>:<b>{ss}</b></strong></span>
        )}
        {hasStart && (
          <span className="nova-ev-when"><Clock aria-hidden="true" />{dayLabel(start)}, {istClock(start)}</span>
        )}
      </div>
    </header>
  );
}
