# NOVA user UI integration

Target: `D:\MERN\LATEST_GW_CODE\user`.
Reference: the Arena design and original artwork from `NOVA-website-source`.
The player UI was replaced without replacing backend schemas, bet submission,
wallet, settlement or provider contracts. A final release pass also hardened
session hydration, production configuration and provider debug logging.

## Implementation

### Authentication and modal redesign on 10 October 2026

Login and registration now share a branded split layout on desktop and a compact,
scrollable layout on mobile. Tenant identity and theme colors remain authoritative.
The redesign includes password login, account creation, OTP verification and password
reset, with consistent labels, validation, loading states and four existing locales.

- A shared native modal surface provides labelled dialogs, background focus isolation,
  Escape and backdrop dismissal, focus return and nested body-scroll locks. Forced
  password changes and submitting confirmations retain their dismissal restrictions.
- Password changes, bank and UPI forms, statement details, transaction receipts,
  deposit and withdrawal details/help/confirmations, bonus gates, provider filters
  and sports analytics use the same visual family. Search, account, wallet, mobile
  bets and utility/navigation panels retain their dedicated layouts with matching
  surfaces, spacing and touch targets.
- Password toggles expose their state and associated input. OTP digits have individual
  accessible names; deleting a middle digit no longer shifts the remaining digits.
  Password reset requests use the reset-specific OTP adapter. Closed auth flows ignore
  stale UI responses, and repeated submits have a single-flight guard.
- Mobile bet-slip shortcuts only operate inside their own active slip. Enter cannot
  submit a background bet behind another dialog or activate from an unrelated control.
  Drag cleanup restores existing body styles instead of clearing another modal's lock.
- Light-mode status text remains readable in portalled dialogs. Deposit details now
  display an explicit payment method before falling back to paymentMethod or type.
  Receipt export templates and financial calculations/submission payloads are otherwise
  retained. Existing browser alerts on receipt-export failure remain native browser UI.

Local checks pass 163/163 frontend tests, a forced full TypeScript compilation and
full frontend ESLint with zero errors. Existing nonfatal ESLint warnings are not
suppressed in source. The production build contains 2,159 modules and all eight
local HTML asset references resolve. Output is preserved at
`D:/MERN/codex-temp/user-modals-final-verified-build-20261010`, outside deployment output.

Final isolated browser proof passes 18 cases and 268 stages across 320–1440px,
short desktop viewports and both themes. It covers all 16 main modal families,
actual-page help/bonus guards and existing search/account/navigation/wallet panels.
Normal warning, receipt, provider and status copy passes measured contrast checks.
All 232 application source hashes match before, after and across the three final
reports. Explicit local auth fixtures are allowed; real API writes, payment/bet
transactions, external connections and provider launches are denied. Event analytics
uses the real read-only widget and shared surface, not the live SportsEvent route's
automatic FancyOdds operation.

Reports, final screenshots and scope are in
`D:/MERN/codex-temp/user-modals-20261010/final-verification.json`. Existing-panel
regressions are in `D:/MERN/codex-temp/user-modals-shell-20261010`. Earlier trial
reports remain separate from the final verified evidence.

Recoverable snapshots 537–545 preserve this revision. Backend, dependency declarations,
environment settings, database and remote Git are unchanged. The test script adds
the new modal regression suite. Real authentication, payment, provider and betting
release checks still require an explicitly authorized test environment.

### Sidebar and top bar refinement on 10 October 2026

The latest navigation refresh groups the left sidebar into workspace, sports and
explore sections, with quieter icons, clear active states and independent scrolling
on short screens. The top bar uses a wider search field, compact wallet summary and
named account control. Mobile keeps two rows, with theme and search above the wallet
and account actions. Existing configured banners remain first on the homepage,
using their original image ratios; the center and right workspace stay in place.

- Sport selection is scoped to sports routes. Counts show a dash while loading or
  failed; successful empty feeds show actual zero. Invalid API responses use the
  existing localized error state rather than pretending the feed is empty.
- Sidebar Bonus navigation respects both credit account types. Wallet popup amounts
  now match the existing header display: cash subtracts absolute exposure, while
  credit displays available credit without subtracting exposure again.
- The native language selector follows current i18n state, including changes from
  Settings, and retains the existing locale persistence adapter. The Settings footer
  link reflects the active route. Search exposes its existing Ctrl/Cmd K shortcut.
- Existing authentication, funding restrictions, wallet selection, native dialogs,
  API contracts and tenant/theme authority remain intact. No backend, dependency,
  environment, ledger, payment or provider change is included.

Fresh verification passes 127/127 frontend tests, TypeScript compilation, targeted
ESLint with zero errors and the production build. All eight local HTML asset
references resolve. Browser proof covers 17 unique configurations and 174 successful
stages, including both themes, 320px mobile, cash/credit accounts, hidden funding,
disabled sports, short screens, long names, large amounts and locale synchronization.
The isolated fixtures deny real mutations and external API/provider connections.

Evidence is in `D:/MERN/codex-temp/user-shell-20261010`. The
`browser-shell-verified/report.json` contains 15 passing configurations; two fixture
assertion issues are resolved for the same remaining configurations in
`browser-shell-targeted-final/report.json`, with identical application source hashes.
The final build is `D:/MERN/codex-temp/user-shell-final-build-20261010`.
Recoverable snapshots 534–536 preserve source, integration notes and tests.
This is a local update; deployment output and remote Git remain untouched.

### Middle workspace refinement on 10 October 2026

The latest center layout replaces the larger stacked home presentation with a
compact, data-first sports workspace. Both sidebars remain in place. The homepage
uses the available middle width instead of retaining an unnecessary 1,440px cap.

- Empty desktop feeds use a bento layout: feature and market recovery on one side,
  three real sport-navigation cards on the other, with existing Terms guidance
  below. Loaded markets retain the full middle width.
- A single compact status strip appears only when actual events exist. Empty,
  loading and failed requests do not show zero-valued metric tiles or invented
  featured matches. Retry and filter reset remain distinct actions.
- Mobile puts the market list and useful discovery before the feature banner.
  Recovery actions and the first genuine match fit the usable first viewport.
  Native sport cards retain their labels and touch targets at 320px.
- Original artwork has a bounded crop, blended left edge and readable light/dark
  copy. The accent comes from existing tenant settings; no new palette authority,
  dependency, image asset, authentication or financial workflow is introduced.
- Compact markets omit the duplicate heading while preserving the noncompact
  presentation and every existing API, normalization, sorting and lifecycle hook.
  Existing translations cover the new navigation and guidance.

Fresh verification passes 117/117 frontend tests, forced full TypeScript with no
diagnostics, full ESLint with zero errors, and production build. The existing
`lint:nova` command still has 95 nonfatal warnings and zero errors. Isolated browser
proof passes 88 cases and 290 stages: 32 center-specific cases, 54 whole-user
regressions and two actual-settings red-palette cases. These include both themes,
independent casino-disabled tenants, loading/error/retry/filter states and
320–1920px widths. Fixtures reject mutations and external API/provider connections.

Evidence and final previews are in `D:/MERN/codex-temp/user-center-20261010`.
The production artifact is `D:/MERN/codex-temp/user-center-build-20261010`; deployment
output is not overwritten. Snapshots and records 528–531 preserve this revision
separately from the earlier design. Real provider/event/payment release QA remains
operator-authorized work; no deployment or remote Git write is performed.

### Player panel redesign on 10 October 2026

The player panel now uses a restrained layout with clear headings, neutral cards,
compact navigation and consistent light/dark surfaces. The original right-side
workspace rail and desktop match/account context are preserved, as requested.

- Home retains sport/status filters, one real featured match, overview shortcuts,
  the existing market list, configured advertisements and casino discovery.
  Duplicate schedules, oversized stories, guides and FAQ sections are removed.
- The footer keeps tenant identity, configured support/social links and guarded
  account/legal destinations in compact groups. Mobile links use two columns.
- Theme, wallet and profile controls are directly available on mobile. Wallet
  options fit at 320px without clipping their labels or amounts. Profile, Search,
  mobile navigation and mobile bets retain keyboard dismissal and focus return.
- Account/deposit/withdrawal headings share neutral styling and functioning back
  actions. Contextual Help appears only when a handler exists. Settings decoration
  and VIP glow effects are removed; the VIP banner no longer duplicates the page h1.
- Sports activity and mobile bets now use the existing UserBets adapter, with
  distinct loading/error/empty states and account-lifecycle guards. Existing bet
  events refresh authoritative data instead of fabricating local bet identifiers.
- Reopened native dialogs ignore stale queued close events. Wallet calculations,
  credit/hideDW restrictions, authentication, backend schemas and financial actions
  remain unchanged. New loading/search copy covers all four existing locales.

Final verification passes: 115/115 frontend tests, forced full TypeScript with no
diagnostics, full ESLint with zero errors, and production Vite build. The existing
`lint:nova` gate exits zero with 95 nonfatal typing/style/hook warnings. The build
contains 2,164 modules; all eight local HTML asset references resolve.

Isolated Chromium verification passes 54 cases and 214 stages across 320–1440px,
light/dark, public/account pages, cash/credit/funding restrictions, native panels,
filter/retry behavior, saved theme choice and supported locales. Two artwork checks
verify lazy card images, and two final Sports checks verify the typed consumer fix.
Fixtures reject every mutation, unexpected API request and external connection;
they are not shipped with the application. The automatic FancyOdds mutation keeps
the event-detail route outside this read-query-only browser matrix.

Reports and screenshots are in
`D:/MERN/codex-temp/user-reimagine-20261010`; the final build is in
`D:/MERN/codex-temp/user-reimagine-build-20261010`. Recoverable pre-images and
checkpoints are `.backups/page-migration-2026-09-22/task-520` through `task-527`.
The handoff records preserve the final scope and verification separately from
earlier iterations. Dependency declarations and the version are unchanged.
This redesign does not deploy, overwrite deployment output or write remote Git.

### Player panel refresh — 2026-10-09

- `src/styles/panel-refresh.css` improves shared navigation, header, readable
  wallet labels, card spacing, sports artwork, loading states and mobile controls.
  It consumes the existing tenant/theme tokens and is loaded after `nova.css`.
- Homepage sport buttons filter the schedule, featured match, market list and
  match desk together. Live/upcoming buttons filter before the eight-event cap;
  overview cards focus and scroll to the corresponding market results. The
  overview still receives the complete API event set.
- Failed sports requests offer an explicit retry. Empty filters offer a reset.
  Decorative homepage artwork remains visible when no featured event exists.
- Ctrl/Cmd+K opens search outside editable fields or an existing modal. A skip
  link reaches the main content, and the mobile Home link uses exact matching.
- Page language follows the selected locale. Native-script headlines and mobile
  labels fit Hindi, Tamil and Telugu layouts. Compact fixture times use 24-hour IST.
- Developer settings chrome is opt-in with `VITE_SETTINGS_DEBUG=true`; production
  behavior and API/environment configuration are unchanged.
- Validation: production build and TypeScript compilation passed, targeted ESLint
  reported no errors, and the user regression suite passed 81/81 tests. Isolated
  Playwright checks covered 320–1440px layouts, light/dark themes, sport/status
  filters, overview shortcuts, retry recovery, keyboard search, mobile navigation,
  cash/credit accounts, disabled features and all supported locales. Fixtures are
  intercepted only in `tmp/user-ui-refresh/verify.cjs`; they are not shipped by the
  application. Screenshots and the report are in `tmp/user-ui-refresh`.
- Pre-edit files are preserved in `.backups/user-ui-2026-10-09`. Root backup files
  map to their original `user` paths; locale files are in its `locales` subfolder.

- Sports-first homepage with NOVA typography, cobalt fallback branding, original
  cricket/football/tennis artwork, discovery cards, guidance and FAQ.
- Existing sports API and odds/socket adapters retained. Homepage API failures now
  show error/empty states instead of the previous mock-match fallback.
- Original casino catalogue/launch adapters, configured advertisement banners,
  wallet/profile/search controls, route guards and mobile bet-history drawer retained.
- Desktop sidebar, account workspace and utility rail; mobile navigation uses a
  labelled native modal dialog with Escape/backdrop dismissal and route-change cleanup.
- New visitors start in light mode. The header and preferences-panel toggle apply
  genuine light/dark palettes and remember the selection when storage is available.
  A versioned preference migrates the legacy app's automatically saved dark value
  to light once; explicit choices made with the new toggle remain persistent.
  Blocked storage still permits session-local switching. Toast appearance follows
  the selected mode.
- Configured whitelabel logo/name/accent and light/dark palettes remain authoritative.
  Legacy dark-only palettes no longer force light mode into dark colors.
- New wallet shortcuts respect `hideDW` and credit-player restrictions. Balances and
  exposure use existing authenticated account fields, never NOVA sample credits.
- Responsive breakpoints, keyboard focus styling and reduced-motion overrides added.
- NOVA interface and accessibility copy is available in the existing English,
  Hindi, Tamil and Telugu locale resources with parity checks in the test suite.
- Neutral sports/casino controls now use semantic light/dark text tokens; white text
  remains only where it is intentional on brand, live and image-overlay surfaces.
- League disclosure controls expose their expanded state and controlled region,
  the fallback logo has a single accessible name, and disabled sports also removes
  the mobile bet-slip destination and sports-specific hero artwork/copy.
- Cached profiles no longer count as authentication. Protected UI remains anonymous
  and hydrating until a present, unexpired token is accepted by `getMe`; missing,
  malformed, expired, revoked and rejected sessions clear cached auth.
- Production uses same-origin `/graphql`, a tracked safe production env, the NOVA
  pre-settings title and an explicit live-odds endpoint. The retired StakeX support
  address and accidental production fallback to the legacy API host are absent.
- GAP provider tracing is development-only and explicit; it is forced off in
  production and recursively redacts tokens, signatures and raw bodies.

## Local commands

From the project root:

```powershell
cd D:\MERN\LATEST_GW_CODE
npm run test:nova --workspace stakex-ui
npm run typecheck --workspace stakex-ui
npm run lint:nova --workspace stakex-ui
npm run lint --workspace stakex-ui -- --quiet
npm run build --workspace stakex-ui
npm test --workspace user-backend
npm run typecheck --workspace user-backend
npm run build --workspace user-backend
npm run dev:user
```

`npm run dev:user` starts the canonical integrated preview on
<http://127.0.0.1:5177/>. Restart any older dev process after changing env files;
Vite reads them only at process startup.
The development preview uses this project's existing API/environment configuration;
no production credentials or environment settings were changed for the redesign.

The regression suite uses Node's built-in runner and installed TypeScript/React.
It executes actual theme utilities, the whitelabel palette callback, theme-click
handlers and sports-loading effects, and server-renders the NOVA components with
isolated API/context adapters. It is not an end-to-end browser test.

Avoid running root `npm test` / `npm run test:all` against a non-disposable database:
some shared/integration suites intentionally write and clean database rows. The user
backend unit command above is the safe backend regression check used for this UI work.

## Verification

Completed on 2026-10-02:

- NOVA/theme/auth/token regression tests: 65/65 passed.
- User-backend unit tests: 55/55 passed, including production CORS/proxy mode,
  safe public-probe policy and provider-log redaction.
- User and user-backend TypeScript checks and production builds passed; Vite built
  2,188 modules. Full frontend ESLint completed with 0 errors (`--quiet`).
- After dependency security updates, admin tests passed 612/612 and CRM tests
  passed 147/147; both typechecks passed and the CRM production build passed.
- The final dependency audit has no high or critical findings. Four moderate,
  development-only findings remain in Drizzle Kit's legacy esbuild loader; npm's
  proposed force fix is a breaking downgrade, so it was not applied.
- A temporary server loaded the final production `/`, `/sports`, `/casino`,
  `/settings`, `/statements`, `/privacy`, `/terms`, favicon and hero artwork with
  HTTP 200; it was stopped after the check.
- The final player bundle contains no local API URLs, legacy API host, retired
  support email, fixed tenant ID or GMAG test route/chunk.
- The local GraphQL API on port 4003 returned `appSettings.meta.code = 200`.
  Read-only probes found 23 settings, 2 configured advertisements, 6 casino summary
  items, and 24 sports / 34 leagues. The provider currently returned 0 sports events
  and markets, so the honest empty state is expected rather than fabricated matches.

## Remaining release-only QA

Local browser checks cover rendered layouts, fixture-authenticated account pages,
native panels, saved themes and feature restrictions. Production release still
needs the operator to verify:

1. Actual configured logos/palettes and real-account login/password behavior.
2. Live event navigation, odds streaming and provider launches with production
   authorization, including the event route's existing FancyOdds operation.
3. Any consequential funding or bet transaction in an explicitly authorized test
   environment. This redesign did not submit payments or place real bets.

## Backup and rollback

This checkout did not contain Git metadata, so no branch or commit was created.
Original versions of the initially edited integration files are preserved at:

`D:\MERN\LATEST_GW_CODE\.backups\nova-ui-20261002-210607\user`

For rollback, first preserve any subsequent edits, then copy only the required
original files from that backup to the corresponding `user` paths. The locale-file
changes are an additive `translation.nova` block and can be removed independently.
New integration files are `src/components/nova`, `src/styles/nova.css`, `public/nova`,
the three `tests/*.cjs` files and this document. Restoring `src/main.tsx`, `Home.tsx`
and the original components removes their integration entry points; do not recursively
delete the project or restore unrelated files.

Production environment and reverse-proxy requirements are in
[`PRODUCTION.md`](./PRODUCTION.md).
