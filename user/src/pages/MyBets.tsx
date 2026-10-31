import { useId, useState, useMemo, type ReactNode } from "react";
import { ChevronDown, ExternalLink, Loader2, Inbox, RefreshCw, Trophy, Dices } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import StakePageHeader from "@/components/StakePageHeader";
import { formatAmount, getDefaultLocale } from "@/lib/currency";
import { usePageSEO } from "@/hooks/usePageSEO";
import { useMyOpenBets } from "@/hooks/useMyOpenBets";
import { groupMatkaMarkets, groupSportsMarkets, matkaGameLabel, type SportsOpenBet as BetItem } from "@/features/my-bets/model";
import type { MatkaBet } from "@/lib/api/matka";
import "@/styles/account/my-bets.css";

function DateCell({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <div className="nova-mb-date">
      <div className="nova-mb-date-day">{d.toLocaleDateString(getDefaultLocale())}</div>
      <div className="nova-mb-date-time">{d.toLocaleTimeString(getDefaultLocale(), { hour: "2-digit", minute: "2-digit", hour12: true })}</div>
    </div>
  );
}

function TypeBadge({ side }: { side: string }) {
  const s = (side || "").toLowerCase();
  return (
    <span
      className={`nova-mb-side ${
        s === "back"
          ? "is-back"
          : "is-lay"
      }`}
    >
      {s === "back" ? "BACK" : "LAY"}
    </span>
  );
}

function MarketBadge({ bet }: { bet: BetItem }) {
  const mt = (bet.marketType || "").toLowerCase();
  const label = mt === "fancy" ? "Fancy" : mt === "bookmaker" ? "Bookmaker" : "Match Odds";
  const cls =
    mt === "fancy"
      ? "is-fancy"
      : mt === "bookmaker"
      ? "is-bookmaker"
      : "is-odds";
  return (
    <span className={`nova-mb-market ${cls}`}>
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  // Show "matched" as "Open"
  const label = ['matched', 'active', 'open'].includes(s) ? "Open" : status;
  const cls =
    ['matched', 'active', 'open'].includes(s)
      ? "is-success"
      : s === "unmatched"
      ? "is-pending"
      : s === "pending"
      ? "is-info"
      : "is-neutral";
  return (
    <span className={`nova-acct-chip nova-mb-status ${cls}`}>
      {label}
    </span>
  );
}

function BetsTable({ bets }: { bets: BetItem[] }) {
  return (
    <div className="nova-mb-table-wrap">
      <table className="nova-mb-table" aria-label="Open sports bets">
        <thead>
          <tr>
            <th className="c-date">Date</th>
            <th className="c-sel">Selection</th>
            <th className="c-market hidden md:table-cell">Market</th>
            <th className="c-type is-center">Type</th>
            <th className="c-odds is-num">Odds</th>
            <th className="c-stake is-num">Stake</th>
            <th className="c-liab is-num">Liability</th>
            <th className="c-payout is-num">Payout</th>
            <th className="c-status is-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {bets.map((bet) => {
            const isFancy = (bet.marketType || "").toLowerCase() === "fancy";
            const odds = Number(bet.odds || 0);
            const stake = Number(bet.stake || 0);
            const liability = bet.liability ?? stake;
            const payout = bet.payout ?? 0;
            const side = (bet.side || bet.type || "").toLowerCase() === "back" ? "is-back" : "is-lay";

            return (
              <tr key={bet.id} className={side}>
                {/* Date */}
                <td className="c-date">
                  <DateCell iso={bet.createdAt} />
                </td>

                {/* Selection + mobile market fallback */}
                <td className="c-sel">
                  <div className="nova-mb-sel">
                    {bet.selection || bet.selectionId || "—"}
                  </div>
                  <div className="nova-mb-sub md:hidden">
                    <MarketBadge bet={bet} />
                  </div>
                </td>

                {/* Market (desktop) */}
                <td className="c-market hidden md:table-cell">
                  <MarketBadge bet={bet} />
                  {bet.marketName && (
                    <div className="nova-mb-market-name">
                      {bet.marketName}
                    </div>
                  )}
                </td>

                {/* Type */}
                <td className="c-type is-center">
                  <TypeBadge side={bet.side || bet.type} />
                </td>

                {/* Odds */}
                <td className="c-odds is-num" data-label="Odds">
                  {isFancy ? (
                    <>
                      {odds.toFixed(0)}
                      {bet.oddsSize != null && (
                        <span className="nova-mb-odds-size">/{bet.oddsSize}</span>
                      )}
                    </>
                  ) : (
                    odds.toFixed(2)
                  )}
                </td>

                {/* Stake */}
                <td className="c-stake is-num" data-label="Stake">
                  {formatAmount(stake)}
                </td>

                {/* Liability */}
                <td className="c-liab is-num" data-label="Liability">
                  {formatAmount(liability)}
                </td>

                {/* Payout */}
                <td className="c-payout is-num" data-label="Payout">
                  {formatAmount(payout)}
                </td>

                {/* Status */}
                <td className="c-status is-center">
                  <StatusBadge status={bet.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MatkaBetsTable({ bets }: { bets: MatkaBet[] }) {
  return <div className="nova-mb-table-wrap"><table className="nova-mb-table nova-mb-matka" aria-label="Open Matka bets">
    <thead><tr><th className="c-date">Placed at</th><th className="c-sel">Number / game</th><th className="c-session">Session</th><th className="c-wallet">Wallet</th><th className="c-rate is-num">Rate</th><th className="c-stake is-num">Stake</th><th className="c-payout is-num">Potential payout</th><th className="c-status is-center">Status</th></tr></thead>
    <tbody>{bets.map(bet => <tr key={bet.id}>
      <td className="c-date"><DateCell iso={bet.createdAt} /></td>
      <td className="c-sel"><div className="nova-mb-sel">{bet.selection}</div><div className="nova-mb-market-name">{matkaGameLabel(bet.bidType)}</div></td>
      <td className="c-session" data-label="Session"><span className="nova-mb-market">{bet.session}</span></td>
      <td className="c-wallet" data-label="Wallet">{({ cash: 'Cash', credit: 'Credit', bonus: 'Bonus', referralBonus: 'Referral bonus' } as Record<string, string>)[bet.walletType] || bet.walletType}</td>
      <td className="c-rate is-num" data-label="Rate">1:{bet.payoutMultiplier}</td>
      <td className="c-stake is-num" data-label="Stake">{formatAmount(bet.amount, bet.currency)}</td>
      <td className="c-payout is-num" data-label="Potential payout">{formatAmount(bet.potentialWin, bet.currency)}</td>
      <td className="c-status is-center"><StatusBadge status={bet.status} /></td>
    </tr>)}</tbody>
  </table></div>
}

function MarketAccordion({ title, subtitle, count, to, linkLabel, children }: { title: string; subtitle: string; count: number; to: string; linkLabel: string; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  const id = useId()
  return <section className="nova-mb-group" aria-label={`${title} - ${subtitle}`}>
    <div className="nova-mb-group-bar">
      <button type="button" onClick={() => setOpen(value => !value)} className="nova-mb-group-head" aria-expanded={open} aria-controls={id}>
        <ChevronDown className={`nova-mb-chevron${open ? '' : ' is-closed'}`} />
        <span className="nova-mb-group-title"><span className="nova-mb-group-name">{title}</span><span className="nova-mb-group-meta">{subtitle} · {count} open bet{count === 1 ? '' : 's'}</span></span>
      </button>
      <Link to={to} className="nova-mb-view">{linkLabel}<ExternalLink aria-hidden="true" /></Link>
    </div>
    <div id={id} hidden={!open} className="nova-mb-group-body">{children}</div>
  </section>
}

export default function MyBetsPage() {
  usePageSEO({ title: 'My Bets', description: 'View your open Sports and Matka bets by market' })
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'matka' ? 'matka' : 'sports'
  const { sports, matka } = useMyOpenBets(tab)
  const read = tab === 'sports' ? sports : matka
  const sportsGroups = useMemo(() => groupSportsMarkets(sports.data), [sports.data])
  const matkaGroups = useMemo(() => groupMatkaMarkets(matka.data), [matka.data])
  const count = read.data.length
  const markets = tab === 'sports' ? sportsGroups.length : matkaGroups.length
  const label = tab === 'sports' ? 'Sports' : 'Matka'
  return <div className="nova-mb space-y-4 pb-6">
    <StakePageHeader title="My Bets" />
    <div className="nova-mb-toolbar">
      <div className="nova-mb-tabs" role="group" aria-label="Bet category">
        {(['sports', 'matka'] as const).map(key => <button key={key} type="button" aria-pressed={tab === key} aria-controls="my-open-bets" onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set('tab', key); return next.toString() }, { replace: true })}>
          {key === 'sports' ? <Trophy aria-hidden="true" size={18} /> : <Dices aria-hidden="true" size={18} />}{key === 'sports' ? 'Sports' : 'Matka'}
        </button>)}
      </div>
      <button type="button" className="nova-mb-refresh" onClick={read.refresh} disabled={read.loading || read.refreshing}><RefreshCw aria-hidden="true" size={16} className={read.refreshing ? 'animate-spin' : ''} />Refresh</button>
    </div>
    <div id="my-open-bets" role="region" aria-label={`${label} open bets`}>
      {!read.loading && (!read.error || count > 0) && <p className="nova-mb-summary">{count} open bet{count === 1 ? '' : 's'} · {markets} market{markets === 1 ? '' : 's'}{tab === 'matka' ? ' / trading dates' : ''}</p>}
      {read.error && <div className="nova-mb-error" role="alert"><p>{read.error}</p><button type="button" onClick={read.refresh} className="nova-mb-retry" disabled={read.refreshing}>Try again</button></div>}
      {read.loading && <div className="nova-mb-loading" role="status"><Loader2 className="animate-spin" /><span>Loading your bets...</span></div>}
      {!read.loading && !read.error && !count && <div className="nova-mb-empty"><div className="nova-mb-empty-icon"><Inbox /></div><p className="nova-mb-empty-title">No open {label} bets</p><p className="nova-mb-empty-text">Your unsettled {label} bets will appear here, grouped by market.</p></div>}
      {!read.loading && count > 0 && <div className="nova-mb-groups">
        {tab === 'sports' ? sportsGroups.map(group => <MarketAccordion key={group.key} title={group.eventName} subtitle={group.marketName} count={group.bets.length} to={`/sports/event/${group.eventId}`} linkLabel="View Event"><BetsTable bets={group.bets} /></MarketAccordion>)
          : matkaGroups.map(group => <MarketAccordion key={group.key} title={group.marketName} subtitle={`Trading date: ${group.runDate}`} count={group.bets.length} to={`/matka/markets/${group.marketId}`} linkLabel="View Market"><MatkaBetsTable bets={group.bets} /></MarketAccordion>)}
      </div>}
      {tab === 'matka' && count > 0 && <p className="nova-mb-note">Potential payout includes stake if the entry wins. Bets remain open until their result is settled.</p>}
    </div>
  </div>
}

