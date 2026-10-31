import { Link } from 'react-router-dom';
import styles from './ReportsBanner.module.css';

/* The mockup's call-out band under the dashboard grid (markup M:1829-1842, CSS M:1102-1127, phone
   step M:1617-1618). The wave and the tile's glyph are the mockup's own SVG, verbatim.

   Where it goes. The mockup's CTA opens "dash-reports", its "Saved and scheduled report
   definitions" page (M:2101-2102). This admin has no report builder; the nearest real page is the
   Export Center, where an export is built from a type, a date range, filters and a format, and can
   be saved as a template. So the CTA opens that, as a real link, so middle-click and "open in new
   tab" work. There is no ROUTES constant for the Export Center, so the path is written here.

   Who sees it. OverviewPage renders the band only when the Export Center would open for this user:
   reporting.exports:view plus the page's whitelabel-context rule, taken from
   routes/reporting/exportCenterAccess — the same function the Export Center's own guard runs.
   Without that, a Super Admin in core mode would click through to its "only available in
   Whitelabel view" screen.

   The copy says only what the Export Center does today. The mockup's line, "Create custom reports,
   segment your players, and track KPIs that matter.", promises two things it cannot do: the player
   export filters on status alone, which is not segmentation, and the KPI exports are hidden because
   the backend cannot produce them (BACKEND_SUPPORTED_EXPORT_TYPE_IDS in ExportsPage.tsx). The
   spec's fallback, "Build custom exports, save them as templates and schedule them.", also claims
   one thing too many: the Schedule dialog itself says the export "is created and processed now.
   Scheduled time is stored for reference; automatic run at scheduled time is not yet supported."
   So the line drops scheduling too; add it back when a scheduled export really runs. */

const EXPORT_CENTER_PATH = '/reporting/exports';

/* the slug OverviewPage's titleId() gives the title, so the band follows the cards' id pattern */
const TITLE_ID = 'ov-get-deeper-insights';

export function ReportsBanner() {
  return (
    <section className={styles.banner} aria-labelledby={TITLE_ID}>
      <svg
        className={styles.wave}
        width="320"
        height="120"
        viewBox="0 0 320 120"
        fill="none"
        aria-hidden="true"
      >
        <path d="M0 92c48-46 96-16 148-42 52-26 106 6 172-38v108H0Z" style={{ fill: 'var(--wave-2)' }} />
        <path d="M22 120c56-40 104-6 158-34 54-28 92 2 140-30v64H22Z" style={{ fill: 'var(--wave)' }} />
      </svg>
      <span className={styles.btile} aria-hidden="true">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.45"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 19.5V13M9.5 19.5V7M15 19.5v-9M20.5 19.5v-15" />
        </svg>
      </span>
      <div className={styles.btext}>
        <h2 className={styles.title} id={TITLE_ID}>Get deeper insights</h2>
        <p className={styles.text}>Build custom exports and save them as templates.</p>
      </div>
      {/* The words and the arrow are one flex item, so .primary's 8px gap does not fall between
          them and a plain word space sets the arrow off, as in the mockup's single text node. The
          arrow is decoration: hidden from the accessibility tree, so the link's name stays
          "Create a report". */}
      <Link to={EXPORT_CENTER_PATH} className={styles.primary}>
        <span>
          Create a report <span aria-hidden="true">→</span>
        </span>
      </Link>
    </section>
  );
}
