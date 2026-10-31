import { useEffect, useState } from 'react'
import { Building2, ChevronRight, Flame, Play, Trophy, Users } from 'lucide-react'
import { SAMPLE_CASINO_CATEGORIES, SAMPLE_GAMES, SAMPLE_PROVIDERS, SAMPLE_WINS, formatInr } from './sampleData'
import { GameArt, SectionBar } from './shared'

const JACKPOT_START = 24567890

/** The jackpot climbs a little every few hundred milliseconds; with reduced motion it holds still. */
function useJackpot() {
  const [amount, setAmount] = useState(JACKPOT_START)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => setAmount(value => value + 37 + (value % 91)), 400)
    return () => window.clearInterval(id)
  }, [])
  return amount
}

/**
 * B · Casino Royale (casino first): a jackpot hero with a live counter and three quick picks, category pills,
 * a bento grid of trending games (two large tiles), a running strip of recent big wins and the providers.
 */
export default function ConceptCasino() {
  const jackpot = useJackpot()
  const [category, setCategory] = useState(SAMPLE_CASINO_CATEGORIES[0])
  const quick = SAMPLE_GAMES.filter(game => game.tag === 'LIVE').slice(0, 3)
  const wins = [...SAMPLE_WINS, ...SAMPLE_WINS]

  return <div className="hd-concept hd-casino">
    <section className="hd-jackpot" aria-label="Mega jackpot">
      <div className="hd-jackpot-copy">
        <small><Trophy aria-hidden="true" />Mega jackpot</small>
        <strong className="hd-jackpot-amount" aria-live="off">{formatInr(jackpot)}</strong>
        <p>Every spin on a featured slot adds to the pot. One player takes it all.</p>
        <div className="hd-jackpot-actions">
          <button type="button" className="hd-cta">Play featured slots<ChevronRight aria-hidden="true" /></button>
          <span><Users aria-hidden="true" />8,412 playing now</span>
        </div>
      </div>
      <ul className="hd-jackpot-picks" aria-label="Live tables">
        {quick.map(game => <li key={game.id}>
          <GameArt icon={game.icon} hue={game.hue} name={game.name} />
          <span><strong>{game.name}</strong><small>{game.provider} · {game.players.toLocaleString('en-IN')} seated</small></span>
          <button type="button" aria-label={`Play ${game.name}`}><Play aria-hidden="true" /></button>
        </li>)}
      </ul>
    </section>

    <div className="hd-pills" role="group" aria-label="Game categories">
      {SAMPLE_CASINO_CATEGORIES.map(name => <button key={name} type="button" className={name === category ? 'is-active' : ''} aria-pressed={name === category} onClick={() => setCategory(name)}>{name}</button>)}
    </div>

    <section aria-label="Trending now">
      <SectionBar icon={<Flame className="nova-ex-strip-icon" aria-hidden="true" />} title="Trending now" count={SAMPLE_GAMES.length} action="See all" />
      <div className="hd-bento">
        {SAMPLE_GAMES.map((game, index) => <article key={game.id} className={`hd-bento-tile${index === 0 ? ' is-large' : index === 1 ? ' is-wide' : ''}`}>
          <GameArt icon={game.icon} hue={game.hue} name={game.name} />
          {game.tag && <span className={`hd-game-tag is-${game.tag.toLowerCase()}`}>{game.tag === 'LIVE' && <i aria-hidden="true" />}{game.tag}</span>}
          <span className="hd-bento-meta">
            <strong>{game.name}</strong>
            <small>{game.provider} · <Users aria-hidden="true" />{game.players.toLocaleString('en-IN')}</small>
          </span>
          <button type="button" className="hd-bento-play" aria-label={`Play ${game.name}`}><Play aria-hidden="true" /><span>Play</span></button>
        </article>)}
      </div>
    </section>

    <section className="hd-wins" aria-label="Recent big wins">
      <span className="hd-wins-label"><Trophy aria-hidden="true" />Big wins</span>
      <div className="hd-wins-viewport" tabIndex={0}>
        <ul className="hd-wins-track">
          {wins.map((win, index) => <li key={index} aria-hidden={index >= SAMPLE_WINS.length || undefined}>
            <span className="hd-wins-avatar" aria-hidden="true">{win.user[0]}</span>
            <span><strong>{win.user}</strong> won <b>{formatInr(win.amount)}</b> on {win.game}</span>
            <small>{win.ago} ago</small>
          </li>)}
        </ul>
      </div>
    </section>

    <section aria-label="Providers">
      <SectionBar icon={<Building2 className="nova-ex-strip-icon" aria-hidden="true" />} title="Top providers" count={SAMPLE_PROVIDERS.length} />
      <ul className="hd-providers">
        {SAMPLE_PROVIDERS.map(name => <li key={name}><button type="button">{name}</button></li>)}
      </ul>
    </section>
  </div>
}
