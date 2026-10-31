import type { CSSProperties, ReactNode } from 'react'
import { CircleDot, Crown, Dices, Flame, Gem, Rocket, Spade, Sparkles } from 'lucide-react'
import cricketImg from '../../assets/images/cricket.png'
import footballImg from '../../assets/images/football.png'
import tennisImg from '../../assets/images/tennis.png'
import basketballImg from '../../assets/images/basketball.png'
import horseImg from '../../assets/images/horse-racing.png'
import type { SampleGameIcon, SampleSport } from './sampleData'
import SectionHeader from '../nova/exchange-home/SectionHeader'

const SPORT_ICON: Record<SampleSport | 'horse' | 'tabletennis', string> = {
  cricket: cricketImg,
  football: footballImg,
  tennis: tennisImg,
  basketball: basketballImg,
  horse: horseImg,
  tabletennis: tennisImg,
}

const GAME_ICON: Record<SampleGameIcon, typeof Spade> = { roulette: CircleDot, cards: Spade, crown: Crown, rocket: Rocket, gem: Gem, sparkles: Sparkles, dice: Dices, flame: Flame }

/** The player panel's section bar (its livery comes from nova-exchange-home.css). */
export function SectionBar({ icon, title, count, action }: { icon: ReactNode; title: string; count?: number; action?: string }) {
  return <SectionHeader icon={icon} title={title} count={count}>
    {action && <a href="#preview" className="nova-ex-section-all" onClick={event => event.preventDefault()}>{action}</a>}
  </SectionHeader>
}

/** IND for India, ALC for C. Alcaraz, RM for Real Madrid: one name gives three letters, several give initials. */
const initials = (name: string) => {
  const words = name.split(' ').filter(word => word && !word.endsWith('.'))
  return (words.length === 1 ? words[0].slice(0, 3) : words.map(word => word[0]).join('').slice(0, 3)).toUpperCase()
}

export function TeamBadge({ name, hue, size = 'md' }: { name: string; hue: number; size?: 'md' | 'lg' }) {
  // eslint-disable-next-line no-restricted-syntax -- a CSS variable carrying the team's colour (the rule's stated exception)
  return <span className={`hd-team-badge is-${size}`} style={{ '--hue': hue } as CSSProperties} aria-hidden="true">{initials(name)}</span>
}

/** One back or lay price; a preview selection toggles on click. */
export function OddsButton({ side, price, size, selected, onSelect, label }: { side: 'back' | 'lay'; price: number; size?: string; selected?: boolean; onSelect?: () => void; label: string }) {
  return <button type="button" className={`hd-odds is-${side}${selected ? ' is-selected' : ''}`} aria-pressed={selected} aria-label={`${side === 'back' ? 'Back' : 'Lay'} ${label} at ${price.toFixed(2)}`} onClick={onSelect}>
    <strong>{price.toFixed(2)}</strong>
    {size && <small>{size}</small>}
  </button>
}

/** Game artwork drawn from the game's hue and icon (the previews ship no game images). */
export function GameArt({ icon, hue, name }: { icon: SampleGameIcon; hue: number; name: string }) {
  const Icon = GAME_ICON[icon]
  // eslint-disable-next-line no-restricted-syntax -- a CSS variable carrying the game's colour (the rule's stated exception)
  return <span className="hd-game-art" style={{ '--hue': hue } as CSSProperties} aria-hidden="true">
    <Icon className="hd-game-art-icon" />
    <span className="hd-game-art-name">{name}</span>
  </span>
}

export function SportIcon({ sport, onDark }: { sport: keyof typeof SPORT_ICON; onDark?: boolean }) {
  return <img className={onDark ? 'hd-sport-icon is-on-dark' : 'hd-sport-icon sport-img'} src={SPORT_ICON[sport]} alt="" />
}
