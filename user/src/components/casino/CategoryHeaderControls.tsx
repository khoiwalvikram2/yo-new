import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { scrollBehavior } from './lobbyScroll'

type Props = { isExpanded: boolean; onToggle: () => void; catId: string }

/** The right end of a category bar: See All / Show less, and while the row is collapsed its arrows. */
export default function CategoryHeaderControls({ isExpanded, onToggle, catId }: Props) {
  const { t } = useTranslation()
  const scroll = (direction: 1 | -1) => {
    const el = document.getElementById(`slider-${catId}`)
    if (el) el.scrollBy({ left: direction * Math.round(el.clientWidth * 0.8), behavior: scrollBehavior() })
  }
  return <>
    <button type="button" className="nova-ex-section-all nova-lobby-toggle" aria-expanded={isExpanded} aria-controls={`cat-body-${catId}`} onClick={onToggle}>
      {isExpanded ? t('casinoLobby.showLess', { defaultValue: 'Show less' }) : t('exchangeHome.seeAll', { defaultValue: 'See All' })}
    </button>
    {!isExpanded && <span className="nova-ex-section-arrows">
      <button type="button" aria-label={t('nova.scrollLeft')} aria-controls={`slider-${catId}`} onClick={() => scroll(-1)}><ChevronLeft aria-hidden="true" /></button>
      <button type="button" aria-label={t('nova.scrollRight')} aria-controls={`slider-${catId}`} onClick={() => scroll(1)}><ChevronRight aria-hidden="true" /></button>
    </span>}
  </>
}
