import './live-pulse.css'

const PULSE_PATH = 'M0 6.5H13l2.5-4 3 9 3.5-11 3 10 2-4H44'

/**
 * Heart-monitor trace for live badges: a bright beam keeps running along a faint trace. Decorative; the LIVE
 * text carries the meaning. Standalone (no exchange imports) so the auth modal and event header can use it.
 */
export function LivePulse() {
  return <svg className="nova-ex-live-pulse" viewBox="0 0 44 12" aria-hidden="true" focusable="false">
    <path d={PULSE_PATH} />
    <path className="is-beam" d={PULSE_PATH} pathLength={100} />
  </svg>
}
