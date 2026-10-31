import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import clsx from 'clsx';
import type { TablerIcon } from '@tabler/icons-react';
import {
  IconBallAmericanFootball,
  IconBallBaseball,
  IconBallBasketball,
  IconBallFootball,
  IconBallTennis,
  IconBallVolleyball,
  IconCricket,
  IconDeviceGamepad2,
  IconGolf,
  IconHorse,
  IconIceSkating,
  IconPingPong,
  IconStack2,
  IconTicket,
  IconTrophy,
} from '@tabler/icons-react';
import { EXPOSURE_BY_MARKET_QUERY } from '../graphql';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useFormatDate } from '@/shared/core/useFormatDate';
import { ROUTES } from '@/shared/core/constants';
import { Meter } from '@/ui/components/Meter';
import {
  buildExposureRows,
  fullLabel,
  OTHERS_PRODUCT,
  type ExposureMarket,
  type ExposureRow,
} from './exposureRows';
import dash from '../dashboard.module.css';
import styles from './ExposureByMarketCard.module.css';
import type { Accent } from '@/ui/components/accent';
import { DrillButton } from './DrilldownDialog';

/* The mockup's "Exposure by market" rail card (M:1819-1826, rows M:3070-3085, CSS M:961-1008 and
   M:1083-1091). The page renders it only for a user with reporting.exposure:view, which is also
   the gate of the Exposure Report its "View all" opens, so the link is never a dead end.

   What it measures. The open book right now, split by market: one row per sport with open sports
   liability (matched and unmatched bets), and one "Matka" row for the potential payout of pending
   and active matka bets of every type. That is how the Exposure figure in "Risk & Liquidity" is
   built, so for any period that ends today the rows add up to it. Casino is left out, as it is
   there: an open casino bet records no payout, so its risk is unknown. Bets placed through the bet
   tool are counted, as they are there and on the Exposure Report.

   Point in time, not the period. Like the Real-time snapshot, it reads a query that takes no
   arguments, on its own poll, so the period presets above do not move it and the head says "Open
   now" instead of naming a period. For a past period the Exposure figure takes, per product, the
   larger of a stored snapshot and the live book; that cannot be split by market, so this card does
   not claim to follow the period.

   States are stated, not implied. The head always says when the reading was taken (a cached server
   reading keeps its own time), and a failed poll keeps the last good reading and says the refresh
   failed. Before the first reading the body is a short placeholder, marked busy; a reading with
   nothing open says so; a failure with no reading says "Unavailable". The mockup's card has no Live
   badge (it carries "View all" instead), so this one claims no liveness beyond its timestamp, and
   there is no aria-live: a card that refreshes every 15 s would talk constantly. */

interface ExposureByMarket {
  at: string;
  markets: ExposureMarket[];
}

interface ExposureByMarketQueryData {
  exposureByMarket: ExposureByMarket;
}

const TITLE = 'Exposure by market';
/* The slug OverviewPage's titleId() gives this title, so every card's id follows one pattern. */
const TITLE_ID = 'ov-exposure-by-market';

/* The server caches a reading for 5 s. The book moves with bet flow rather than second by second,
   so 15 s keeps the card current without asking for mostly repeated readings. */
const POLL_INTERVAL_MS = 15_000;

/* The body before any reading, and after a failure with none: one line, the same height as the
   "nothing open" message, so neither state shifts the rail. */
const PLACEHOLDER = '—';

/* One glyph per sport the platform carries, keyed by sports.key, all from the installed
   @tabler/icons-react. A sport not listed takes the generic trophy rather than another sport's
   ball. Matka takes the ticket the navigation already gives it, and the folded row the stack the
   mockup draws for "Others" (M:2760). */
const SPORT_GLYPHS: Readonly<Record<string, TablerIcon>> = {
  cricket: IconCricket,
  football: IconBallFootball,
  soccer: IconBallFootball,
  tennis: IconBallTennis,
  basketball: IconBallBasketball,
  esports: IconDeviceGamepad2,
  'e-sports': IconDeviceGamepad2,
  volleyball: IconBallVolleyball,
  baseball: IconBallBaseball,
  'american-football': IconBallAmericanFootball,
  'table-tennis': IconPingPong,
  'ice-hockey': IconIceSkating,
  golf: IconGolf,
  'horse-racing': IconHorse,
};

const SPORT_KEY_PREFIX = 'sports:';

function glyphFor(row: ExposureRow): TablerIcon {
  if (row.product === OTHERS_PRODUCT) return IconStack2;
  if (row.product === 'matka') return IconTicket;
  const sportKey = row.key.startsWith(SPORT_KEY_PREFIX) ? row.key.slice(SPORT_KEY_PREFIX.length) : '';
  return Object.hasOwn(SPORT_GLYPHS, sportKey) ? SPORT_GLYPHS[sportKey] : IconTrophy;
}

/* The owner's colour pass (2026-10-29): each row in its own accent, its glyph tile and its share bar, in
   order down the list so no two visible rows share one. Decorative: the amount and share carry the meaning. */
const ROW_ACCENTS: readonly Accent[] = ['blue', 'amber', 'green', 'violet', 'cyan', 'rose'];

export function ExposureByMarketCard() {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const { formatTime } = useFormatDate();

  const { data, previousData, error } = useQuery<ExposureByMarketQueryData>(
    EXPOSURE_BY_MARKET_QUERY,
    {
      pollInterval: POLL_INTERVAL_MS,
      errorPolicy: 'all',
      /* Show a reading already in the cache at once, but always ask the server too, so a remount
         (switching tabs unmounts this card) waits one round trip for a fresh reading rather than
         a whole poll interval. The head's timestamp says how old whatever is shown is. */
      fetchPolicy: 'cache-and-network',
    }
  );

  /* A failed poll leaves `data` empty. Keeping the last good reading, with its time and a head
     that says the refresh failed, is more useful and more honest than blanking the card. */
  const reading = data?.exposureByMarket ?? previousData?.exposureByMarket;
  const waiting = !reading && !error;
  const rows = reading ? buildExposureRows(reading.markets) : [];

  /* The same conversion as the Exposure figure in "Risk & Liquidity": raw whitelabel-currency
     amounts, converted to the display currency, then formatted. But in whole units, as the
     approved mockup prints this card (its money(), M:1949): the rail is ~290px wide at 1280px
     with the context panel open, and two decimals on a crore-sized amount cost the market names
     the room they need. The Share column carries this card's precision; the Exposure figure keeps
     its decimals. */
  const money = (amount: number) =>
    formatAmount(convertFromWhitelabelCurrency(amount), undefined, { fractionDigits: 0 });

  /* Always rendered, whatever the state, so the head never gains or loses the line. "View all"
     always stays on the title row (styles.headLeft), and a status too long for the room beside it
     wraps under the title instead. The two lines a reading can carry are about the same length,
     and measured with Inter at every viewport width from 360 to 1920px (panel open and
     collapsed) both fit on one line: the head is 91.8px (87.8px on a phone) whether or not the
     last poll failed. It is close at 1280px with the panel open: the widest failed line
     ("04:44:44") is 185.2px in 187.8px of room, so a wider fallback font would wrap it and add one
     18px line, with "View all" still on the title row. A stale reading is not "open now", so a
     failed poll leads with that. */
  let status: ReactNode;
  if (reading) {
    const time = <time dateTime={reading.at}>{formatTime(reading.at, 'HH:mm:ss')}</time>;
    status = error ? <>Refresh failed · as of {time}</> : <>Open now · updated {time}</>;
  } else if (error) {
    status = 'Unavailable';
  } else {
    status = 'Loading…';
  }

  let body: ReactNode;
  if (rows.length > 0) {
    body = (
      /* .tw.narrow.tbl-pad (M:1824): the table owns its outer gutter, so the body adds none */
      <div className={clsx(styles.tw, dash.tblPad)}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.market}>Market</th>
              <th scope="col" className={styles.r}>Amount</th>
              <th scope="col" className={styles.r}>Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const Glyph = glyphFor(row);
              return (
                <tr key={row.key} data-accent={ROW_ACCENTS[index % ROW_ACCENTS.length]}>
                  <th scope="row" className={styles.market}>
                    <span className={styles.whoCell}>
                      <span className={styles.mktIc} aria-hidden="true">
                        <Glyph size={16} stroke={1.75} />
                      </span>
                      {/* The name can ellipsise in the narrow rail; the title keeps it whole. The
                          folded row's "(n)" is a box of its own after the name, so the ellipsis
                          never takes it; its leading space is part of the text (white-space:
                          pre), so the row reads "Others (3)" to a screen reader too. */}
                      <span className={styles.name} title={fullLabel(row)}>
                        <span className={styles.label}>
                          <DrillButton drill={{
                            kind: 'bets',
                            arg: row.key.startsWith('sports:') ? `sport:${row.key.slice('sports:'.length)}` : 'product:matka',
                            title: `Open bets · ${row.label}`,
                          }}>{row.label}</DrillButton>
                        </span>
                        {row.foldedCount > 0 ? (
                          <span className={styles.count}>{` (${row.foldedCount})`}</span>
                        ) : null}
                      </span>
                    </span>
                  </th>
                  <td className={styles.r}>
                    <div className={styles.mk}>
                      {/* drawn at the exact share; the Share cell beside it prints the whole percent */}
                      <Meter value={row.share} className={styles.bar} />
                      <span className={styles.k}>{money(row.amount)}</span>
                    </div>
                  </td>
                  <td className={styles.r}>{row.percentLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  } else {
    body = (
      <div className={styles.state} aria-busy={waiting || undefined}>
        {reading ? 'No open exposure right now.' : PLACEHOLDER}
      </div>
    );
  }

  return (
    <section className={dash.card} aria-labelledby={TITLE_ID}>
      <div className={dash.cardHead} data-ui-radius="panel-head">
        {/* not dash.cardHeadLeft: its flex-basis is the status line's full width, which pushed
            "View all" onto a row of its own when a failed poll lengthened the line */}
        <div className={styles.headLeft}>
          <h2 className={dash.cardTitle} id={TITLE_ID}>{TITLE}</h2>
          <p className={dash.cardSub}>{status}</p>
        </div>
        <div className={dash.cardTools}>
          {/* M:1822. A real link rather than the mockup's button, so middle-click and "open in new
              tab" work. The name adds what "View all" means out of context, and still starts with
              the visible words. */}
          <Link
            to={ROUTES.REPORTING_EXPOSURE}
            className={dash.linkButton}
            aria-label="View all exposure"
          >
            View all<span aria-hidden="true"> ›</span>
          </Link>
        </div>
      </div>
      {body}
    </section>
  );
}
