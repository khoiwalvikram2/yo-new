import { useState, type CSSProperties } from 'react'
import { ChevronRight, Clock, Gift, Radio, Trophy } from 'lucide-react'
import { SAMPLE_MATCHES, SAMPLE_PROMOS, SAMPLE_SPORTS, type SampleMatch } from './sampleData'
import { OddsButton, SectionBar, SportIcon, TeamBadge } from './shared'

const runnerNames = (match: SampleMatch) => match.odds.length === 3 ? [match.home, 'Draw', match.away] : [match.home, match.away]

/**
 * A · Matchday (sports first): one featured live match as a stadium spotlight with its score, a win-chance bar and
 * the back/lay prices; then the in-play strip, the sports, the next matches and the promotions.
 */
export default function ConceptMatchday() {
  const [picked, setPicked] = useState<string | null>(null)
  const featured = SAMPLE_MATCHES[0]
  const live = SAMPLE_MATCHES.filter(match => match.live)
  const upcoming = SAMPLE_MATCHES.filter(match => !match.live)
  const pick = (key: string) => setPicked(current => current === key ? null : key)

  return <div className="hd-concept hd-matchday">
    <section className="hd-spotlight" aria-label="Featured match">
      <div className="hd-spotlight-top">
        <span className="hd-live-pill"><i aria-hidden="true" />Live</span>
        <SportIcon sport={featured.sport} onDark />
        <span className="hd-spotlight-league">{featured.league}</span>
        <span className="hd-spotlight-matched">Matched {featured.matched}</span>
      </div>
      <div className="hd-spotlight-teams">
        <div className="hd-spotlight-team"><TeamBadge name={featured.home} hue={featured.hues[0]} size="lg" /><strong>{featured.home}</strong></div>
        <div className="hd-spotlight-score">
          <strong>{featured.live?.score}</strong>
          <small>{featured.live?.detail}</small>
        </div>
        <div className="hd-spotlight-team is-away"><TeamBadge name={featured.away} hue={featured.hues[1]} size="lg" /><strong>{featured.away}</strong></div>
      </div>
      <div className="hd-chance" role="img" aria-label={`Win chance: ${featured.home} ${featured.live?.homeChance}%, ${featured.away} ${100 - (featured.live?.homeChance ?? 50)}%`}>
        <span>{featured.live?.homeChance}%</span>
        {/* eslint-disable-next-line no-restricted-syntax -- a CSS variable carrying the win chance (the rule's stated exception) */}
        <i style={{ '--chance': `${featured.live?.homeChance}%` } as CSSProperties} />
        <span>{100 - (featured.live?.homeChance ?? 50)}%</span>
      </div>
      <div className="hd-spotlight-odds">
        {runnerNames(featured).map((runner, index) => <div key={runner} className="hd-spotlight-runner">
          <span>{runner}</span>
          <div className="hd-odds-pair">
            <OddsButton side="back" price={featured.odds[index][0]} label={runner} selected={picked === `f-${index}-b`} onSelect={() => pick(`f-${index}-b`)} />
            <OddsButton side="lay" price={featured.odds[index][1]} label={runner} selected={picked === `f-${index}-l`} onSelect={() => pick(`f-${index}-l`)} />
          </div>
        </div>)}
      </div>
    </section>

    <section aria-label="In-play now">
      <SectionBar icon={<Radio className="nova-ex-strip-icon" aria-hidden="true" />} title="In-play now" count={live.length} action="See all" />
      <div className="hd-inplay-strip">
        {live.map(match => <article key={match.id} className="hd-inplay-card">
          <header><SportIcon sport={match.sport} /><span>{match.league}</span><span className="hd-live-dot" aria-label="Live" /></header>
          <div className="hd-inplay-teams">
            <span><TeamBadge name={match.home} hue={match.hues[0]} />{match.home}</span>
            <span><TeamBadge name={match.away} hue={match.hues[1]} />{match.away}</span>
          </div>
          <p className="hd-inplay-score"><strong>{match.live?.score}</strong><small>{match.live?.detail}</small></p>
          <div className="hd-inplay-odds">
            {match.odds.map((odds, index) => <OddsButton key={index} side="back" price={odds[0]} label={runnerNames(match)[index]} selected={picked === `${match.id}-${index}`} onSelect={() => pick(`${match.id}-${index}`)} />)}
          </div>
        </article>)}
      </div>
    </section>

    <nav className="hd-sport-tiles" aria-label="Sports">
      {SAMPLE_SPORTS.map(sport => <a key={sport.sport} href="#preview" className="hd-sport-tile" onClick={event => event.preventDefault()}>
        <span className="hd-sport-tile-icon"><SportIcon sport={sport.sport} onDark /></span>
        <strong>{sport.label}</strong>
        <small>{sport.count} matches{sport.live > 0 && <em> · {sport.live} live</em>}</small>
        <ChevronRight className="hd-sport-tile-go" aria-hidden="true" />
      </a>)}
    </nav>

    <section aria-label="Top matches">
      <SectionBar icon={<Trophy className="nova-ex-strip-icon" aria-hidden="true" />} title="Top matches" count={upcoming.length} action="See all" />
      <div className="hd-match-list">
        {upcoming.map(match => <article key={match.id} className="hd-match-row">
          <span className="hd-match-when"><Clock aria-hidden="true" />{match.time}</span>
          <span className="hd-match-teams">
            <strong>{match.home} <em>v</em> {match.away}</strong>
            <small><SportIcon sport={match.sport} />{match.league} · Matched {match.matched}</small>
          </span>
          <span className={`hd-match-odds ways-${match.odds.length}`}>
            {match.odds.map((odds, index) => <span key={index} className="hd-odds-pair">
              <OddsButton side="back" price={odds[0]} label={runnerNames(match)[index]} selected={picked === `${match.id}-${index}-b`} onSelect={() => pick(`${match.id}-${index}-b`)} />
              <OddsButton side="lay" price={odds[1]} label={runnerNames(match)[index]} selected={picked === `${match.id}-${index}-l`} onSelect={() => pick(`${match.id}-${index}-l`)} />
            </span>)}
          </span>
        </article>)}
      </div>
    </section>

    <section aria-label="Promotions">
      <SectionBar icon={<Gift className="nova-ex-strip-icon" aria-hidden="true" />} title="Promotions" />
      <div className="hd-promos">
        {SAMPLE_PROMOS.map((promo, index) => <article key={promo.id} className={`hd-promo is-${index + 1}`}>
          <small>{promo.kicker}</small>
          <h3>{promo.title}</h3>
          <p>{promo.copy}</p>
          <button type="button">{promo.cta}<ChevronRight aria-hidden="true" /></button>
        </article>)}
      </div>
    </section>
  </div>
}
