import type { ReactNode } from 'react';
import { useQuery } from '@apollo/client';
import { IconArrowBarToDown, IconCoins, IconDice, IconUsers } from '@tabler/icons-react';
import { REALTIME_SNAPSHOT_QUERY } from '../graphql';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useFormatDate } from '@/shared/core/useFormatDate';
import type { Accent } from '@/ui/components/accent';
import { DrillButton } from './DrilldownDialog';
import type { DrillRequest } from './drilldownContext';
import dash from '../dashboard.module.css';

/* The mockup's "Real-time snapshot" rail card (M:1810-1817, rows M:2818-2826, SNAPSHOT CSS
   M:1075-1081). "The snapshot is what is happening right now — it does not follow the period
   presets" (M:2818-2819), so this card reads Query.realtimeSnapshot, which takes no arguments,
   and runs on its own poll rather than on the page's date range.

   It renders the page's card and .snap row classes directly, the way GrowthMetricsChart
   carries its own card, rather than going through OverviewPage's SectionCard and StatRow. Those
   two are private to the page module, so reusing them from here would mean the page importing
   this card and this card importing the page. Keeping the 10 s poll inside this component also
   means only this card re-renders on each reading, not the whole overview. The row label is
   the mockup's .slab (dash.snapLabel), which wraps; StatRow's label ellipses, and in the narrow
   rail that could clip the "(last N min)" qualifier the first row depends on.

   What the labels mean. This platform has no presence, heartbeat or last-seen data, so there is
   no "online now" count. "Active players" is the number of distinct players who placed a bet in
   the trailing window, and its label states that window using the activityWindowMins value the
   server returns, so the label and the query cannot drift apart. "Active bets" is bets open now
   across sports, casino and matka. The two money rows are approved deposit requests and
   completed withdrawal requests settled in the trailing 60 minutes.

   Liveness is claimed only when it is true. The Live badge shows only while the card holds a
   reading, its latest poll succeeded, and the first server reply since the card mounted has
   landed — a reading Apollo serves from its cache on a remount can be minutes old. The head's
   sub line always says when the reading was taken (a cached server reading keeps its own time),
   so a card that has stopped refreshing is visibly stale. There is no aria-live anywhere: a card
   that refreshes every 10 s would talk constantly. */

interface RealtimeSnapshot {
  at: string;
  activePlayers: number;
  activityWindowMins: number;
  activeBets: number;
  depositsLastHour: number;
  withdrawalsLastHour: number;
}

interface RealtimeSnapshotQueryData {
  realtimeSnapshot: RealtimeSnapshot;
}

const TITLE = 'Real-time snapshot';
/* The slug OverviewPage's titleId() gives this title, so every card's id follows one pattern. */
const TITLE_ID = 'ov-real-time-snapshot';

/* The server caches a reading for 5 s, so a faster poll would mostly return the same reading. */
const POLL_INTERVAL_MS = 10_000;

/* Shown in a value cell while there is no reading, so a loading, failed or recovered card keeps
   the same four rows and does not shift the rail. */
const PLACEHOLDER = '—';

interface SnapshotRow {
  key: string;
  icon: ReactNode;
  label: string;
  value: string;
  /** The tile's colour (the owner's colour pass, 2026-10-29); decorative. */
  accent: Accent;
  /** The rows behind the figure, for the drill-down modal; only once a reading has landed. */
  drill?: DrillRequest;
}

export function RealtimeSnapshotCard() {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const { formatTime } = useFormatDate();

  const { data, previousData, error, loading } = useQuery<RealtimeSnapshotQueryData>(
    REALTIME_SNAPSHOT_QUERY,
    {
      pollInterval: POLL_INTERVAL_MS,
      errorPolicy: 'all',
      /* Show a reading already in the cache at once, but always ask the server too, so a remount
         (switching tabs unmounts this card) waits one round trip for a fresh reading rather than a
         whole poll interval. That shortens the stale window; it does not remove it, which is why
         the badge below also waits on `loading`. */
      fetchPolicy: 'cache-and-network',
    }
  );

  /* A failed poll leaves `data` empty. Keeping the last good reading, with its time and without
     the badge, is more useful and more honest than blanking the card. */
  const snapshot = data?.realtimeSnapshot ?? previousData?.realtimeSnapshot;
  /* `loading` is true only until the first server reply after mounting: polls leave it alone,
     because notifyOnNetworkStatusChange is off. So a cached reading shown on a remount never
     carries the badge, and a steady poll never makes it flicker. */
  const isLive = Boolean(snapshot) && !error && !loading;
  const waiting = !snapshot && !error;

  const money = (amount: number) => formatAmount(convertFromWhitelabelCurrency(amount));

  /* Always rendered, whatever the state, so the head is the same height in all of them. A failed
     poll is worded exactly as the Exposure by market card below it words one, so a network drop,
     which fails both polls at once, reads the same in the whole rail. */
  let status: ReactNode;
  if (snapshot) {
    const time = <time dateTime={snapshot.at}>{formatTime(snapshot.at, 'HH:mm:ss')}</time>;
    status = error ? <>Refresh failed · as of {time}</> : <>Updated {time}</>;
  } else if (error) {
    status = 'Unavailable';
  } else {
    status = 'Loading…';
  }

  /* The mockup's order and glyphs: users, dice, down, coins (M:2822-2825). */
  const rows: SnapshotRow[] = [
    {
      key: 'players',
      accent: 'violet',
      drill: snapshot ? { kind: 'bettors', arg: `mins:${snapshot.activityWindowMins}`, title: 'Active players' } : undefined,
      icon: <IconUsers size={16} stroke={1.75} />,
      /* The same shape in every state, so a reading landing cannot make the label wrap and push
         the rows below it down. The window itself always comes from the server. */
      label: `Active players (last ${snapshot ? snapshot.activityWindowMins : PLACEHOLDER} min)`,
      value: snapshot ? snapshot.activePlayers.toLocaleString() : PLACEHOLDER,
    },
    {
      key: 'bets',
      accent: 'blue',
      drill: snapshot ? { kind: 'bets', arg: 'open', title: 'Active bets' } : undefined,
      icon: <IconDice size={16} stroke={1.75} />,
      label: 'Active bets',
      value: snapshot ? snapshot.activeBets.toLocaleString() : PLACEHOLDER,
    },
    {
      key: 'deposits',
      accent: 'green',
      drill: snapshot ? { kind: 'deposits', arg: 'mins:60', title: 'Deposits in the last hour' } : undefined,
      icon: <IconArrowBarToDown size={16} stroke={1.75} />,
      label: 'Deposits (last 1h)',
      value: snapshot ? money(snapshot.depositsLastHour) : PLACEHOLDER,
    },
    {
      key: 'withdrawals',
      accent: 'rose',
      drill: snapshot ? { kind: 'withdrawals', arg: 'mins:60', title: 'Withdrawals in the last hour' } : undefined,
      icon: <IconCoins size={16} stroke={1.75} />,
      label: 'Withdrawals (last 1h)',
      value: snapshot ? money(snapshot.withdrawalsLastHour) : PLACEHOLDER,
    },
  ];

  return (
    <section className={dash.card} aria-labelledby={TITLE_ID}>
      <div className={dash.cardHead} data-ui-radius="panel-head">
        <div className={dash.cardHeadLeft}>
          <h2 className={dash.cardTitle} id={TITLE_ID}>{TITLE}</h2>
          <p className={dash.cardSub}>{status}</p>
        </div>
        {isLive ? (
          <div className={dash.cardTools}>
            {/* M:1814. The dot is static here, as in the mockup (M:869), so there is no motion
                to answer under prefers-reduced-motion. */}
            <span className={dash.live}>
              <i className={dash.liveDot} aria-hidden="true" />
              Live
            </span>
          </div>
        ) : null}
      </div>
      <div className={dash.snap} aria-busy={waiting || undefined}>
        {rows.map(row => (
          <div key={row.key} className={dash.snapRow} data-accent={row.accent}>
            <span className={dash.snapTile} aria-hidden="true">{row.icon}</span>
            <span className={dash.snapLabel}>{row.label}</span>
            <span className={dash.snapValue}>{row.drill ? <DrillButton drill={row.drill}>{row.value}</DrillButton> : row.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
