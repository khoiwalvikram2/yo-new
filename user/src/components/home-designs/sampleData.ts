/**
 * Sample data for the home page design previews (/home-designs, development builds only). It exists so the owner
 * can judge layouts before real data is wired in; nothing on the live home page imports it.
 */
export type SampleSport = 'cricket' | 'football' | 'tennis' | 'basketball'
/** [back, lay] for one runner. */
export type SampleOdds = [number, number]
export type SampleMatch = {
  id: string
  sport: SampleSport
  league: string
  home: string
  away: string
  /** Team colours as hues, for the initials badges. */
  hues: [number, number]
  time: string
  live?: { score: string; detail: string; homeChance: number }
  /** Home, (draw,) away. */
  odds: SampleOdds[]
  matched: string
}

export const SAMPLE_MATCHES: SampleMatch[] = [
  { id: 'm1', sport: 'cricket', league: 'T20 World Series', home: 'India', away: 'Australia', hues: [214, 48], time: 'Live', live: { score: '168/4 (17.2)', detail: 'IND need 32 off 16 balls', homeChance: 62 }, odds: [[1.62, 1.64], [2.48, 2.52]], matched: '₹1.84 Cr' },
  { id: 'm2', sport: 'football', league: 'Premier League', home: 'Arsenal', away: 'Chelsea', hues: [356, 226], time: 'Live', live: { score: '2 - 1', detail: "67' · Second half", homeChance: 71 }, odds: [[1.45, 1.47], [4.6, 4.8], [7.2, 7.6]], matched: '₹92.4 L' },
  { id: 'm3', sport: 'tennis', league: 'ATP Finals', home: 'C. Alcaraz', away: 'J. Sinner', hues: [8, 150], time: 'Live', live: { score: '6-4 3-5', detail: 'Set 2 · Sinner serving', homeChance: 47 }, odds: [[2.1, 2.14], [1.86, 1.9]], matched: '₹38.1 L' },
  { id: 'm4', sport: 'cricket', league: 'Big Bash League', home: 'Sydney Sixers', away: 'Perth Scorchers', hues: [322, 22], time: 'Today · 13:40', odds: [[1.92, 1.96], [2.02, 2.06]], matched: '₹21.7 L' },
  { id: 'm5', sport: 'football', league: 'La Liga', home: 'Real Madrid', away: 'Sevilla', hues: [44, 0], time: 'Today · 21:30', odds: [[1.38, 1.4], [5.1, 5.3], [8.4, 8.8]], matched: '₹46.2 L' },
  { id: 'm6', sport: 'basketball', league: 'NBA', home: 'LA Lakers', away: 'Boston Celtics', hues: [272, 140], time: 'Tomorrow · 06:00', odds: [[2.22, 2.26], [1.7, 1.72]], matched: '₹12.9 L' },
  { id: 'm7', sport: 'cricket', league: 'Ranji Trophy', home: 'Mumbai', away: 'Karnataka', hues: [204, 6], time: 'Tomorrow · 09:30', odds: [[1.84, 1.88], [3.9, 4.1], [2.6, 2.7]], matched: '₹6.3 L' },
  { id: 'm8', sport: 'football', league: 'Serie A', home: 'Inter', away: 'Napoli', hues: [220, 196], time: 'Sat · 00:15', odds: [[2.04, 2.08], [3.4, 3.5], [3.7, 3.85]], matched: '₹18.5 L' },
]

export const SAMPLE_SPORTS: Array<{ sport: SampleSport | 'horse' | 'tabletennis'; label: string; count: number; live: number }> = [
  { sport: 'cricket', label: 'Cricket', count: 46, live: 6 },
  { sport: 'football', label: 'Football', count: 128, live: 14 },
  { sport: 'tennis', label: 'Tennis', count: 72, live: 9 },
  { sport: 'basketball', label: 'Basketball', count: 31, live: 3 },
  { sport: 'horse', label: 'Horse Racing', count: 54, live: 2 },
]

export type SampleGameIcon = 'roulette' | 'cards' | 'crown' | 'rocket' | 'gem' | 'sparkles' | 'dice' | 'flame'
export type SampleGame = { id: string; name: string; provider: string; category: string; hue: number; icon: SampleGameIcon; tag?: 'LIVE' | 'HOT' | 'NEW'; players: number }

export const SAMPLE_GAMES: SampleGame[] = [
  { id: 'g1', name: 'Lightning Roulette', provider: 'Evolution', category: 'Roulette', hue: 352, icon: 'roulette', tag: 'LIVE', players: 1824 },
  { id: 'g2', name: 'Aviator', provider: 'Spribe', category: 'Crash', hue: 4, icon: 'rocket', tag: 'HOT', players: 3410 },
  { id: 'g3', name: 'Teen Patti Royale', provider: 'Ezugi', category: 'Indian Games', hue: 266, icon: 'crown', tag: 'LIVE', players: 962 },
  { id: 'g4', name: 'Infinite Blackjack', provider: 'Evolution', category: 'Blackjack', hue: 160, icon: 'cards', tag: 'LIVE', players: 1290 },
  { id: 'g5', name: 'Gates of Olympus', provider: 'Pragmatic Play', category: 'Slots', hue: 212, icon: 'sparkles', tag: 'HOT', players: 2156 },
  { id: 'g6', name: 'Crazy Time', provider: 'Evolution', category: 'Game Shows', hue: 318, icon: 'flame', tag: 'LIVE', players: 4021 },
  { id: 'g7', name: 'Sweet Bonanza', provider: 'Pragmatic Play', category: 'Slots', hue: 334, icon: 'gem', tag: 'NEW', players: 1488 },
  { id: 'g8', name: 'Andar Bahar', provider: 'Ezugi', category: 'Indian Games', hue: 28, icon: 'dice', tag: 'LIVE', players: 1102 },
]

export const SAMPLE_CASINO_CATEGORIES = ['All games', 'Live Roulette', 'Blackjack', 'Indian Games', 'Game Shows', 'Crash', 'Slots']
export const SAMPLE_PROVIDERS = ['Evolution', 'Pragmatic Play', 'Ezugi', 'Spribe', 'Play\'n GO', 'NetEnt', 'Red Tiger', 'Betgames']

export const SAMPLE_WINS = [
  { user: 'Ra***h', game: 'Aviator', amount: 42500, ago: '2m' },
  { user: 'Pr***a', game: 'Lightning Roulette', amount: 118000, ago: '4m' },
  { user: 'Am***t', game: 'Sweet Bonanza', amount: 26750, ago: '6m' },
  { user: 'Ka***n', game: 'Crazy Time', amount: 305000, ago: '9m' },
  { user: 'Ne***a', game: 'Teen Patti Royale', amount: 15400, ago: '11m' },
  { user: 'Vi***y', game: 'Gates of Olympus', amount: 88200, ago: '14m' },
]

export const SAMPLE_PROMOS = [
  { id: 'p1', kicker: 'Sports', title: 'Weekend cashback', copy: '10% back on net losses, every Saturday and Sunday.', cta: 'Claim offer' },
  { id: 'p2', kicker: 'Casino', title: 'Live casino drops', copy: 'Random cash drops on Evolution tables every hour.', cta: 'Join a table' },
  { id: 'p3', kicker: 'Refer', title: 'Bring a friend', copy: 'Earn a bonus on your friend’s first deposit.', cta: 'Invite now' },
]

export const SAMPLE_MARKET_STATS = [
  { label: 'Live events', value: '24', delta: '+6 in the last hour' },
  { label: 'Markets open', value: '312', delta: '41 closing soon' },
  { label: 'Matched today', value: '₹3.24 Cr', delta: '+18% vs yesterday' },
  { label: 'Players online', value: '8,412', delta: 'Peak 9,870 today' },
]

export const SAMPLE_LEAGUES = [
  { sport: 'cricket' as const, league: 'T20 World Series', count: 4 },
  { sport: 'cricket' as const, league: 'Big Bash League', count: 6 },
  { sport: 'football' as const, league: 'Premier League', count: 10 },
  { sport: 'football' as const, league: 'La Liga', count: 9 },
  { sport: 'tennis' as const, league: 'ATP Finals', count: 3 },
  { sport: 'basketball' as const, league: 'NBA', count: 12 },
]

export const SAMPLE_MOVERS = [
  { runner: 'India', market: 'IND v AUS · Match Odds', from: 1.78, to: 1.62 },
  { runner: 'Chelsea', market: 'ARS v CHE · Match Odds', from: 5.8, to: 7.2 },
  { runner: 'J. Sinner', market: 'Alcaraz v Sinner · Match Odds', from: 2.02, to: 1.86 },
  { runner: 'Sevilla', market: 'RMA v SEV · Match Odds', from: 7.6, to: 8.4 },
]

/** Three back and three lay levels around a runner's best prices, with sizes, for the exchange ladder. */
export function ladder([back, lay]: SampleOdds, seed: number) {
  const step = back < 2 ? 0.01 : back < 3 ? 0.02 : back < 4 ? 0.05 : 0.1
  const size = (level: number) => Math.round(((seed * 37 + level * 53) % 90 + 10) * 1000)
  return {
    back: [2, 1, 0].map(level => ({ price: +(back - level * step).toFixed(2), size: size(level) })),
    lay: [0, 1, 2].map(level => ({ price: +(lay + level * step).toFixed(2), size: size(level + 3) })),
  }
}

export const formatInr = (amount: number) => `₹${amount.toLocaleString('en-IN')}`
export const formatSize = (amount: number) => amount >= 100000 ? `${(amount / 100000).toFixed(1)}L` : `${Math.round(amount / 1000)}K`
