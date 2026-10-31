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
import { SearchResults } from './SearchResults'

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
