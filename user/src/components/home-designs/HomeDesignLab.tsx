import { useSearchParams } from 'react-router-dom'
import { Eye, LayoutTemplate } from 'lucide-react'
import ConceptCasino from './ConceptCasino'
import ConceptExchange from './ConceptExchange'
import ConceptMatchday from './ConceptMatchday'
// The section bars (and their light-theme livery) live with the exchange home.
import '../nova/exchange-home/nova-exchange-home.css'
import './home-designs.css'

const CONCEPTS = [
  { key: 'a', name: 'Matchday', tagline: 'Sports first: a live match spotlight leads', Concept: ConceptMatchday },
  { key: 'b', name: 'Casino Royale', tagline: 'Casino first: a jackpot hero and a bento of games', Concept: ConceptCasino },
  { key: 'c', name: 'Exchange Pro', tagline: 'For traders: ladders, a live bet slip and movers', Concept: ConceptExchange },
]

/**
 * Three home page design concepts on sample data, side by side behind a switch (?design=a|b|c keeps the choice in
 * the link). Development builds only (see main.tsx), so players never meet the sample odds.
 */
export default function HomeDesignLab() {
  const [params, setParams] = useSearchParams()
  const active = CONCEPTS.find(concept => concept.key === params.get('design')) ?? CONCEPTS[0]
  const { Concept } = active

  return <div className="hd-lab">
    <header className="hd-lab-bar">
      <div className="hd-lab-title">
        <span className="hd-lab-mark" aria-hidden="true"><LayoutTemplate /></span>
        <div>
          <h1>Home page designs</h1>
          <p><Eye aria-hidden="true" />Design preview with sample data. Pick one and it gets built on the real home with live data.</p>
        </div>
      </div>
      <div className="hd-lab-switch" role="group" aria-label="Design concepts">
        {CONCEPTS.map((concept, index) => <button
          key={concept.key}
          type="button"
          aria-pressed={concept.key === active.key}
          className={concept.key === active.key ? 'is-active' : ''}
          onClick={() => setParams({ design: concept.key }, { replace: true })}
        >
          <b aria-hidden="true">{String.fromCharCode(65 + index)}</b>
          <span><strong>{concept.name}</strong><small>{concept.tagline}</small></span>
        </button>)}
      </div>
    </header>
    <Concept key={active.key} />
  </div>
}
