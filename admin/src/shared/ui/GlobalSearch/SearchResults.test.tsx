/**
 * The Pages group (decision 10) must render above the entity groups and stay visible and
 * selectable while the entity search is loading, has failed, or has returned nothing — only the
 * entity portion is replaced by LoadingState / the error block / EmptyState. Entity offsets must
 * shift by the Pages count so keyboard selection still lines up with the flat `allResults` list
 * built by useGlobalSearch (T50). EmptyState only appears when Pages and entities are both empty.
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen } from '@testing-library/react'
import type { CategorizedResults, SearchResult } from '@/hooks/useGlobalSearch'
import { SearchResults, agentsSchemeOf, seeAllPath } from './SearchResults'

function pageResult(id: string, label: string): SearchResult {
  return { type: 'page', id, label, subtitle: 'Section', route: `/${id}`, icon: 'fa-file-lines' }
}

function playerResult(id: string, label: string): SearchResult {
  return { type: 'player', id, label, route: `/players/${id}`, icon: 'fa-user' }
}

function baseResults(overrides: Partial<CategorizedResults> = {}): CategorizedResults {
  return {
    pages: [],
    players: [],
    agents: [],
    whitelabels: [],
    casinoGames: [],
    sports: [],
    vipMembers: [],
    matkas: [],
    referralCodes: [],
    bets: [],
    bonuses: [],
    ...overrides,
  }
}

describe('SearchResults Pages group', () => {
  test('renders Pages above the loading skeleton and keeps Pages rows selectable', () => {
    const pages = [pageResult('p1', 'Players'), pageResult('p2', 'Agents')]
    render(
      <SearchResults
        results={baseResults({ pages })}
        allResults={pages}
        selectedIndex={1}
        loading={true}
        error={null}
        query="pl"
        onSelect={() => {}}
      />
    )
    const options = screen.getAllByRole('option')
    assert.equal(options.length, 2)
    assert.equal(options[0].textContent?.includes('Players'), true)
    assert.equal(options[1].textContent?.includes('Agents'), true)
    assert.equal(options[1].getAttribute('aria-selected'), 'true')
  })

  test('renders Pages above the "Search failed" block and keeps Pages rows selectable', () => {
    const pages = [pageResult('p1', 'Players')]
    render(
      <SearchResults
        results={baseResults({ pages })}
        allResults={pages}
        selectedIndex={0}
        loading={false}
        error="Network error"
        query="pl"
        onSelect={() => {}}
      />
    )
    const options = screen.getAllByRole('option')
    assert.equal(options.length, 1)
    assert.equal(options[0].getAttribute('aria-selected'), 'true')
    assert.equal(screen.getByText('Search failed').textContent, 'Search failed')
  })

  test('renders only Pages, with no EmptyState, when entity results are empty', () => {
    const pages = [pageResult('p1', 'Players')]
    render(
      <SearchResults
        results={baseResults({ pages })}
        allResults={pages}
        selectedIndex={0}
        loading={false}
        error={null}
        query="pl"
        onSelect={() => {}}
      />
    )
    assert.equal(screen.getAllByRole('option').length, 1)
    assert.equal(screen.queryByText('No results found'), null)
  })

  test('shifts entity offsets by the Pages count so selectedIndex still lines up', () => {
    const pages = [pageResult('p1', 'Players')]
    const players = [playerResult('u1', 'Alice'), playerResult('u2', 'Bob')]
    render(
      <SearchResults
        results={baseResults({ pages, players })}
        allResults={[...pages, ...players]}
        selectedIndex={2}
        loading={false}
        error={null}
        query="a"
        onSelect={() => {}}
      />
    )
    const options = screen.getAllByRole('option')
    assert.equal(options.length, 3)
    assert.equal(options[0].textContent?.includes('Players'), true)
    assert.equal(options[1].textContent?.includes('Alice'), true)
    assert.equal(options[2].textContent?.includes('Bob'), true)
    assert.equal(options[0].getAttribute('aria-selected'), 'false')
    assert.equal(options[1].getAttribute('aria-selected'), 'false')
    assert.equal(options[2].getAttribute('aria-selected'), 'true')
  })

  test('renders EmptyState only when Pages and entities are both empty', () => {
    render(
      <SearchResults
        results={baseResults()}
        allResults={[]}
        selectedIndex={0}
        loading={false}
        error={null}
        query="zz"
        onSelect={() => {}}
      />
    )
    assert.equal(screen.queryAllByRole('option').length, 0)
    assert.equal(screen.getByText('No results found').textContent, 'No results found')
  })
})

describe('SearchResults See all', () => {
  function entity(type: SearchResult['type'], id: string, label: string): SearchResult {
    return { type, id, label, route: `/${type}/${id}`, icon: type }
  }

  test('offers See all only where a list page takes the typed term', () => {
    const results = baseResults({
      players: [entity('player', 'u1', 'Alice')],
      vipMembers: [entity('vipMember', 'v1', 'Alice VIP')],
      referralCodes: [entity('referralCode', 'r1', 'ALICE10')],
      bets: [entity('bet', 'bet-search-alice', 'Search bets: "alice"')],
      bonuses: [entity('bonus', 'b1', 'Alice welcome')],
    })
    const seen: string[] = []
    render(
      <SearchResults
        results={results}
        allResults={Object.values(results).flat()}
        selectedIndex={0}
        loading={false}
        error={null}
        query="alice"
        onSelect={() => {}}
        onSeeAll={(category) => { seen.push(category) }}
      />
    )
    const seeAll = screen.getAllByRole('button', { name: /^See all / }).map((button) => button.getAttribute('aria-label'))
    // /vip opens the tier list, a referral code is matched exactly (one row at most) and the Bets row is
    // itself the bet-list search, so none of those three offers a See all that would drop or ignore the term.
    assert.deepEqual(seeAll, ['See all Players', 'See all Bonuses'])
    screen.getByRole('button', { name: 'See all Bonuses' }).click()
    assert.deepEqual(seen, ['bonuses'])
  })

  /* B005: the agents list shows one scheme at a time, so See all Agents names the scheme of the matches. */
  test('See all Agents carries the scheme the matches share, or the one most of them have', () => {
    const agent = (id: string, schemeType?: string): SearchResult => ({ ...entity('agent', id, id), metadata: schemeType ? { schemeType } : undefined })
    assert.equal(agentsSchemeOf([agent('a1', 'SHARING'), agent('a2', 'SHARING')]), 'SHARING')
    assert.equal(agentsSchemeOf([agent('a1', 'COMMISSION'), agent('a2', 'CREDIT'), agent('a3', 'CREDIT')]), 'CREDIT')
    assert.equal(agentsSchemeOf([agent('a1', 'SHARING'), agent('a2', 'CREDIT')]), 'SHARING', 'a tie goes to the first match')
    assert.equal(agentsSchemeOf([agent('a1'), agent('a2', 'PLAYER'), agent('a3', 'CREDIT')]), 'CREDIT', 'no or unknown schemes are not counted')
    assert.equal(agentsSchemeOf([agent('a1')]), null)

    const agents = [agent('a1', 'SHARING')]
    assert.equal(seeAllPath('agents', ' vfy sh ', { agents }), '/agents?search=vfy%20sh&type=SHARING')
    assert.equal(seeAllPath('agents', 'vfy', { agents: [agent('a1')] }), '/agents?search=vfy', 'no scheme recorded: the term alone, as before')
    assert.equal(seeAllPath('agents', '', { agents }), '/agents?type=SHARING')
    // Only the agents list is by scheme; the others keep the term alone.
    assert.equal(seeAllPath('players', 'a & b', { agents }), '/players/search?search=a%20%26%20b')
    assert.equal(seeAllPath('bonuses', 'WEDNESDAY 10%'), '/bonuses?search=WEDNESDAY%2010%25')
    assert.equal(seeAllPath('vipMembers', 'alice'), null, 'no See all where no list takes the term')
  })
})

/* B006: the Bets group is only the generic "Search bets: <term>" shortcut. Listed above the Bonuses, it was the default
   selection over a matching campaign. It now comes after every real match, and the offsets follow that order. */
describe('SearchResults order', () => {
  test('the bets shortcut is the last group, and selection lines up with the flat order', () => {
    const bonus: SearchResult = { type: 'bonus', id: '6', label: 'WEDNESDAY 10%', route: '/bonuses/6', icon: 'fa-gift' }
    const bet: SearchResult = { type: 'bet', id: 'bet-search-w', label: 'Search bets: "WEDNESDAY 10%"', route: '/bets?search=w', icon: 'fa-receipt' }
    const referral: SearchResult = { type: 'referralCode', id: 'r1', label: 'WEDNES10', route: '/referrals', icon: 'fa-link' }
    render(
      <SearchResults
        results={baseResults({ referralCodes: [referral], bets: [bet], bonuses: [bonus] })}
        allResults={[referral, bonus, bet]}
        selectedIndex={1}
        loading={false}
        error={null}
        query="WEDNES"
        onSelect={() => {}}
      />
    )
    const groups = screen.getAllByRole('region').map((group) => group.getAttribute('aria-label'))
    assert.deepEqual(groups, ['Referrals', 'Bonuses', 'Bets'])
    const options = screen.getAllByRole('option')
    assert.deepEqual(options.map((option) => option.getAttribute('aria-selected')), ['false', 'true', 'false'])
    assert.ok(options[1].textContent?.includes('WEDNESDAY 10%') && !options[1].textContent?.includes('Search bets'))
  })
})
