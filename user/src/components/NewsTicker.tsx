import { Megaphone } from 'lucide-react'
import { useMemo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useParsedSettings } from '../hooks/useAppSettings'

/**
 * The admin's News Ticker (Admin > Maintenance > News Ticker) scrolling under the header row: one item per line
 * of that text, and nothing at all while it is empty. The track holds the items twice so the loop is seamless;
 * the second copy is hidden from assistive tech. Hover or keyboard focus stops it, and with reduced motion it
 * stands still and scrolls by hand instead.
 */
export default function NewsTicker() {
  const { t } = useTranslation()
  const { newsTicker } = useParsedSettings()
  const items = useMemo(() => (newsTicker ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean), [newsTicker])
  if (items.length === 0) return null

  // Roughly an even reading speed whatever the length, and never a pass quicker than 20s.
  const seconds = Math.max(20, Math.round(items.join(' ').length * 0.18))
  const copy = (hidden: boolean) => <ul className="nova-news-items" aria-hidden={hidden || undefined}>
    {items.map((item, index) => <li key={index}>{item}</li>)}
  </ul>
  const label = t('nova.news', { defaultValue: 'News' })

  return <section className="nova-news-ticker" aria-label={label} data-ui-radius="square">
    <span className="nova-news-label" aria-hidden="true" data-ui-radius="square"><Megaphone />{label}</span>
    <div className="nova-news-viewport" tabIndex={0}>
      {/* eslint-disable-next-line no-restricted-syntax -- a CSS variable carrying the scroll duration (the rule's stated exception) */}
      <div className="nova-news-track" style={{ '--news-duration': `${seconds}s` } as CSSProperties}>
        {copy(false)}
        {copy(true)}
      </div>
    </div>
  </section>
}
